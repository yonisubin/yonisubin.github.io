// The dialogue manager: every spoken line goes through here. Lines wait in a queue ordered by
// priority (then arrival); only one plays at a time, with a short gap between lines, so they never
// overlap. A line at or above `interruptPriority` cuts off a lower one (it stops first, then the new
// one starts). Stale low-priority lines (idle nags that waited too long) are dropped. While a line
// plays, music and effects are ducked. Subtitles (on by default) show the line; closed captions show
// `sfx` events that carry a caption.
//
// Time comes from update(dt) (the shell's frame loop); tests can call advance(seconds).
import type { EventBus } from '../core/events';
import type { LevelData } from '../levels/level';
import { SHELL } from '../core/shellConfig';
import type { Sound } from '../audio/sound';
import { LINES, OVERSEER, poolIds } from './lines';
import { planUtterance, Voice } from './voice';

export type Tone = 'helpful' | 'passive' | 'hostile';

export interface QueuedLine {
  id: string;
  text: string;
  speaker: string;
  priority: number;
  queuedAt: number;
  seq: number;
}

export interface PlayedLine {
  id: string;
  text: string;
  priority: number;
  start: number;
  end: number;
  interrupted: boolean;
}

export interface SubtitleView {
  speaker: string;
  text: string;
}

export class DialogueManager {
  readonly voice: Voice;
  /** Seconds since the manager started (its own clock). */
  time = 0;
  queue: QueuedLine[] = [];
  current: (QueuedLine & { start: number; voiceEnd: number; end: number }) | null = null;
  /** No line may start before this (gap after the previous one). */
  private freeAt = 0;
  private seq = 0;
  readonly history: PlayedLine[] = [];
  tone: Tone = 'helpful';
  subtitles = true;
  captions = false;
  /** Lines and pools already spoken once (milestones). */
  private spoken = new Set<string>();
  private lastPick = new Map<string, string>();
  onSubtitle: (s: SubtitleView | null) => void = () => undefined;
  onCaption: (text: string) => void = () => undefined;

  constructor(private readonly sound: Sound | null) {
    this.voice = new Voice(sound);
  }

  /** Queue a line by id, or a random line from a pool (tone variant first). Returns the queued id. */
  say(idOrPool: string, opts: { priority?: number; once?: boolean } = {}): string | null {
    const id = this.resolve(idOrPool);
    if (!id) return null;
    if (opts.once) {
      if (this.spoken.has(idOrPool)) return null;
      this.spoken.add(idOrPool);
    }
    const line = LINES[id];
    this.enqueue({ id, text: line.text, speaker: line.speaker ?? OVERSEER, priority: opts.priority ?? line.priority ?? 2 });
    return id;
  }

  /** Queue arbitrary text (puzzle-maker chambers, tests). */
  sayText(text: string, priority = 2, speaker = OVERSEER, id = 'text'): void {
    this.enqueue({ id, text, speaker, priority });
  }

  private resolve(idOrPool: string): string | null {
    if (LINES[idOrPool]) return idOrPool;
    for (const pool of [`${idOrPool}.${this.tone}`, idOrPool]) {
      const ids = poolIds(pool);
      if (!ids.length) continue;
      // Random, but never the same line twice in a row.
      const prev = this.lastPick.get(pool);
      const options = ids.length > 1 ? ids.filter((i) => i !== prev) : ids;
      const pick = options[Math.floor(Math.random() * options.length)];
      this.lastPick.set(pool, pick);
      return pick;
    }
    return null;
  }

  private enqueue(l: Omit<QueuedLine, 'queuedAt' | 'seq'>): void {
    const q: QueuedLine = { ...l, queuedAt: this.time, seq: this.seq++ };
    const D = SHELL.dialogue;
    if (this.current && q.priority >= D.interruptPriority && q.priority > this.current.priority) {
      this.finishCurrent(true);
      this.freeAt = this.time; // start right away: the old line has stopped, so nothing overlaps
    }
    this.queue.push(q);
    this.queue.sort((a, b) => b.priority - a.priority || a.seq - b.seq);
    this.pump();
  }

  private finishCurrent(interrupted: boolean): void {
    const c = this.current;
    if (!c) return;
    if (interrupted) this.voice.stop();
    this.history.push({ id: c.id, text: c.text, priority: c.priority, start: c.start, end: Math.min(this.time, c.end), interrupted });
    this.current = null;
    this.freeAt = this.time + SHELL.dialogue.gap;
    this.onSubtitle(null);
    if (!this.queue.length) this.sound?.duck(false, SHELL.dialogue.duck, SHELL.dialogue.duckSeconds);
  }

  private pump(): void {
    const D = SHELL.dialogue;
    if (this.current || this.time < this.freeAt) return;
    // Drop stale nags.
    this.queue = this.queue.filter((q) => q.priority >= D.keepPriority || this.time - q.queuedAt <= D.staleAfter);
    const next = this.queue.shift();
    if (!next) return;
    const u = planUtterance(next.text);
    this.current = { ...next, start: this.time, voiceEnd: this.time + u.duration, end: this.time + u.duration + D.linger };
    this.voice.speak(u);
    this.sound?.duck(true, D.duck, D.duckSeconds);
    if (this.subtitles) this.onSubtitle({ speaker: next.speaker, text: next.text });
  }

  update(dt: number): void {
    this.time += dt;
    if (this.current && this.time >= this.current.end) this.finishCurrent(false);
    this.pump();
  }

  /** Run the clock forward in small steps (tests). */
  advance(seconds: number, step = 0.05): void {
    for (let t = 0; t < seconds; t += step) this.update(Math.min(step, seconds - t));
  }

  /** Stop everything (quit to menu, load). */
  clear(): void {
    this.queue = [];
    if (this.current) this.finishCurrent(true);
    this.freeAt = this.time;
  }

  get speaking(): boolean {
    return !!this.current;
  }

  setSubtitles(on: boolean): void {
    this.subtitles = on;
    if (!on) this.onSubtitle(null);
    else if (this.current) this.onSubtitle({ speaker: this.current.speaker, text: this.current.text });
  }

  /** The tone (term) follows the chamber number: Orientation, Midterms, Expulsion (character.md). */
  setToneFor(level: LevelData | null): void {
    const n = level?.info?.number;
    if (level?.info?.theme === 'industrial') this.tone = 'hostile';
    else if (n === undefined) this.tone = 'helpful';
    else this.tone = n <= 8 ? 'helpful' : n <= 18 ? 'passive' : 'hostile';
  }

  /** Hook into the bus. `level()` gives the chamber playing (for its dialogue hooks). */
  connect(events: EventBus, level: () => LevelData | null): () => void {
    const hooks = (event: string): string[] => level()?.dialogue?.filter((d) => d.event === event).flatMap((d) => d.lines) ?? [];
    const play = (event: string, pool: string | null, priority?: number) => {
      const ids = hooks(event);
      if (ids.length) for (const id of ids) this.say(id, { priority });
      else if (pool) this.say(pool, { priority });
    };
    let deaths = 0;
    const offs = [
      events.on('chamberStart', () => {
        this.clear();
        this.setToneFor(level());
        play('chamberStart', 'chamberStart');
      }),
      events.on('idle', () => play('idle', 'idle', 1)),
      events.on('death', ({ cause }) => {
        deaths++;
        const own = hooks('death');
        if (own.length) return void own.forEach((id) => this.say(id));
        // Alternate cause-specific and general quips so repeats feel less canned.
        if (deaths % 2 === 1 && poolIds(`death.${cause}`).length) this.say(`death.${cause}`);
        else this.say('death');
      }),
      events.on('outOfBounds', () => play('outOfBounds', 'outOfBounds', 3)),
      events.on('exitReached', () => play('exitReached', 'exitReached')),
      events.on('checkpoint', () => play('checkpoint', 'checkpoint', 1)),
      events.on('fizzled', ({ what }) => {
        if (what === 'portals' || what === 'object') this.say('fizzled', { priority: 1 });
      }),
      events.on('trigger', ({ name }) => play(name, null)),
      events.on('portalPlaced', ({ ok }) => {
        if (ok) this.say('milestone.firstPortal', { once: true });
      }),
      events.on('teleport', ({ speed }) => {
        this.say('milestone.firstTeleport', { once: true });
        if (speed > 12) this.say('milestone.firstFling', { once: true });
      }),
      events.on('sfx', ({ caption }) => {
        if (caption && this.captions) this.onCaption(caption);
      }),
    ];
    return () => offs.forEach((f) => f());
  }
}
