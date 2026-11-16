import * as THREE from 'three';
import type { SimEntity } from '../sim/entity';
import type { Interactable } from '../player/onFoot';
import type { CharacterLibrary } from '../player/characterLibrary';
import type { Navigator } from '../game/route';
import type { SceneUI, SceneLine } from '../ui/scene';
import type { Phone, PhoneEntry } from '../ui/phone';
import type { Spot } from './places';
import { StoryCast } from './cast';
import { StoryWorld } from './world';
import { makeStep, type Step, type StoryCtx } from './steps';
import type { CharId, ChoiceOption, Line, MissionSpec, PhoneSpec, PlaceId, PropSpec, CharacterSpec, StoryState } from './types';

// Runs the story: which missions are on offer (the giver gets a ★; walk up and press E),
// the mission you're on (its steps in order, the objective on the HUD and the route line),
// failure (death, busted, a step's own fail) and retry (talk to the giver again), phone
// messages after missions, and the world changing as the story moves on.
//
// Progress is just: missions done + flags set by your choices + the phone log. That's what
// gets saved; a mission in progress isn't (you start it again from its giver).

const TALK_RADIUS = 2.8; // m
const PROLOGUE = ['p1', 'p2', 'p3'];

export interface StorySave {
  done: string[];
  flags: Record<string, string | boolean>;
  phone: PhoneEntry[];
}

/** What the director needs from the game (filled in by main.ts). */
export interface StoryDeps extends Omit<StoryCtx, 'place' | 'playScene' | 'phone' | 'state' | 'setFlags' | 'crashes' | 'goonsDown' | 'cars'> {
  library: CharacterLibrary | null;
  places: Record<PlaceId, Spot>;
  characters: CharacterSpec[];
  missions: MissionSpec[];
  props: PropSpec[];
  navigator: Navigator;
  sceneUI: SceneUI;
  phoneUI: Phone;
  notify(text: string, seconds?: number): void;
  /** Another activity (a side mission or a job shift) that rules out starting a story mission, or null. */
  busy(): string | null;
  /** The story moved on (prices, anything outside the story that depends on it). */
  onChange(state: StoryState): void;
}

interface Running {
  spec: MissionSpec;
  index: number;
  step: Step;
}

export class StoryDirector implements SimEntity {
  readonly done = new Set<string>();
  readonly flags: Record<string, string | boolean> = {};
  readonly cast: StoryCast;
  readonly world: StoryWorld;
  readonly interactables: Interactable[] = [];
  private current: Running | null = null;
  private readonly ctx: StoryCtx;
  private readonly hudLine: HTMLDivElement;
  /** Phone messages waiting for their delay (game seconds). */
  private readonly pending: { at: number; message: PhoneSpec }[] = [];
  private time = 0;
  /** A mission that failed with no giver to retry it from: restarts by itself. */
  private restartIn = -1;
  private restartId = '';
  private routeTarget = new THREE.Vector3(Infinity, 0, 0);
  private routeTimer = 0;
  /** For tests: what happened lately. */
  readonly log: string[] = [];

  constructor(private readonly deps: StoryDeps) {
    this.cast = new StoryCast(deps.scene, deps.library, deps.places, deps.characters);
    this.world = new StoryWorld(deps.scene, deps.terrain, deps.places, deps.props);
    this.ctx = {
      ...deps,
      place: (id) => deps.places[id],
      playScene: (lines, withChar, choices) => this.playScene(lines, withChar as CharId | undefined, choices),
      phone: (m) => this.queuePhone(m),
      state: () => this.state,
      setFlags: (f) => {
        Object.assign(this.flags, f);
        this.refresh();
      },
      crashes: 0,
      goonsDown: 0,
      cars: new Map(),
    };
    for (const c of deps.characters) {
      this.interactables.push({
        label: () => this.offerFrom(c.id)?.title ?? 'talk',
        position: () => this.cast.position(c.id) ?? new THREE.Vector3(0, -1000, 0),
        radius: TALK_RADIUS,
        available: () => this.offerFrom(c.id) !== null && !this.current && !deps.sceneUI.active,
        activate: () => {
          const m = this.offerFrom(c.id);
          if (!m) return;
          const busy = deps.busy();
          if (busy) {
            deps.notify(`Finish ${busy} first`, 2.5);
            return;
          }
          this.start(m.id);
        },
      });
    }
    this.hudLine = document.createElement('div');
    this.hudLine.style.cssText = [
      'position:fixed',
      'left:50%',
      'top:max(10px, env(safe-area-inset-top))',
      'transform:translateX(-50%)',
      'z-index:20',
      'padding:6px 14px',
      'border-radius:10px',
      'background:rgba(0,0,0,0.6)',
      'color:#fff',
      'font:600 15px/1.35 system-ui,sans-serif',
      'text-align:center',
      'pointer-events:none',
      'display:none',
      'max-width:min(520px, 72vw)',
    ].join(';');
    document.body.appendChild(this.hudLine);
    this.refresh();
  }

  // ---------------------------------------------------------------- state

  get state(): StoryState {
    return { done: this.done, flags: this.flags };
  }

  /** The mission running now, if any. */
  get active(): MissionSpec | null {
    return this.current?.spec ?? null;
  }

  /** Missions you can start now (their requirements met, not done). */
  available(): MissionSpec[] {
    const s = this.state;
    return this.deps.missions.filter((m) => !this.done.has(m.id) && m.requires.every((r) => this.done.has(r)) && (!m.when || m.when(s)));
  }

  /** The mission this character is offering (first available one they give). */
  offerFrom(id: CharId): MissionSpec | null {
    if (!this.cast.present(id)) return null;
    return this.available().find((m) => m.giver === id) ?? null;
  }

  /** Re-place the cast, signs and stars after anything changes. */
  private refresh(): void {
    const offering = new Set<CharId>();
    if (!this.current) for (const m of this.available()) if (m.giver) offering.add(m.giver);
    this.cast.refresh(this.state, offering);
    this.world.refresh(this.state);
    this.deps.onChange(this.state);
  }

  // ---------------------------------------------------------------- running missions

  start(id: string): boolean {
    const spec = this.deps.missions.find((m) => m.id === id);
    if (!spec || this.current) return false;
    this.ctx.cars.clear();
    this.current = { spec, index: -1, step: null as unknown as Step };
    this.log.push(`start ${id}`);
    this.deps.notify(`${spec.act} · ${spec.title}`, 2.5);
    this.refresh(); // takes the ★ away while you're busy
    this.next();
    return true;
  }

  private next(): void {
    const run = this.current!;
    run.index++;
    if (run.index >= run.spec.steps.length) {
      this.complete();
      return;
    }
    run.step = makeStep(run.spec.steps[run.index]);
    this.ctx.crashes = 0;
    this.ctx.goonsDown = 0;
    this.routeTarget.set(Infinity, 0, 0);
    run.step.start(this.ctx);
  }

  private complete(): void {
    const spec = this.current!.spec;
    this.cleanupRoute();
    this.current = null;
    this.done.add(spec.id);
    this.log.push(`done ${spec.id}`);
    if (spec.reward) this.deps.pay(spec.reward);
    this.deps.notify(`Mission complete — ${spec.title}${spec.reward ? ` · +$${spec.reward}` : ''}`, 3.5);
    for (const m of spec.after ?? []) this.queuePhone(m);
    this.refresh();
  }

  /** The mission failed: clean up, and offer it again from its giver (or restart it). */
  fail(reason: string): void {
    const run = this.current;
    if (!run) return;
    run.step.end(this.ctx);
    for (const { car } of this.ctx.cars.values()) car.pinned = false;
    this.ctx.cars.clear();
    this.deps.peds?.dismissGoons();
    this.cleanupRoute();
    this.current = null;
    this.log.push(`fail ${run.spec.id}: ${reason}`);
    const giver = run.spec.giver ? this.deps.characters.find((c) => c.id === run.spec.giver)?.name : null;
    this.deps.notify(`Mission failed — ${reason}.${giver ? ` Talk to ${giver} to try again.` : ''}`, 4);
    if (!run.spec.giver) {
      this.restartIn = 4;
      this.restartId = run.spec.id;
    }
    this.refresh();
  }

  private cleanupRoute(): void {
    if (this.deps.navigator.owner === 'story') this.deps.navigator.clear();
  }

  // ---------------------------------------------------------------- the prologue

  /** A brand-new game: start the story at the bus stop. */
  startPrologue(): void {
    if (!this.done.has('p1') && !this.current) this.start('p1');
  }

  /** Skip the prologue: its missions count as done (and pay as if done). */
  skipPrologue(): void {
    if (this.current && PROLOGUE.includes(this.current.spec.id)) {
      this.current.step.end(this.ctx);
      this.cleanupRoute();
      this.current = null;
    }
    for (const id of PROLOGUE) {
      if (this.done.has(id)) continue;
      this.done.add(id);
      const spec = this.deps.missions.find((m) => m.id === id);
      if (spec?.reward) this.deps.pay(spec.reward);
    }
    this.deps.notify('Prologue skipped — Rico has work for you (★ on the map)', 3.5);
    this.refresh();
  }

  get inPrologue(): boolean {
    return !PROLOGUE.every((id) => this.done.has(id));
  }

  // ---------------------------------------------------------------- scenes and the phone

  private speaker(who: CharId | 'you'): { name: string; color: string } {
    if (who === 'you') return { name: 'You', color: '#e8e8e8' };
    const c = this.deps.characters.find((x) => x.id === who)!;
    return { name: c.name, color: c.color };
  }

  private playScene(lines: Line[], withChar: CharId | undefined, choices: ChoiceOption[] | undefined): Promise<number | null> {
    const scene: SceneLine[] = lines.map((l) => ({
      ...this.speaker(l.who),
      // A character only animates if they're standing here (phone lines are just voice).
      model: l.who !== 'you' ? this.cast.model(l.who) : null,
      text: l.text,
    }));
    const focus = withChar ? this.cast.position(withChar) : null;
    const facing = withChar ? this.cast.facing(withChar) : 0;
    return this.deps.sceneUI.play(scene, choices?.map((c) => c.label) ?? [], focus, facing);
  }

  private queuePhone(m: PhoneSpec): void {
    if (m.when && !m.when(this.state)) return;
    this.pending.push({ at: this.time + (m.delay ?? 0), message: m });
  }

  // ---------------------------------------------------------------- hooks from the game

  /** A hard knock while in a vehicle (counted by steps with a crash limit). */
  noteCrash(): void {
    this.ctx.crashes++;
  }

  noteGoonDown(): void {
    this.ctx.goonsDown++;
  }

  /** You were knocked out or busted: the mission fails. */
  playerDown(reason: string): void {
    if (this.current) this.fail(reason);
  }

  // ---------------------------------------------------------------- per step / per frame

  fixedUpdate(dt: number): void {
    this.time += dt;
    // Phone messages whose time has come.
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (this.pending[i].at > this.time) continue;
      const m = this.pending.splice(i, 1)[0].message;
      const who = this.speaker(m.from);
      this.deps.phoneUI.receive({ from: m.from, name: who.name, color: who.color, call: !!m.call, lines: m.lines });
    }
    if (this.restartIn > 0) {
      this.restartIn -= dt;
      if (this.restartIn <= 0 && !this.current) this.start(this.restartId);
    }
    const run = this.current;
    if (!run) return;
    const r = run.step.update(dt, this.ctx);
    if (r === 'done') {
      run.step.end(this.ctx);
      this.next();
    } else if (r !== 'running') {
      this.fail(r.fail);
    }
  }

  afterStep(): void {}

  render(frameDt: number): void {
    const player = this.deps.playerPos();
    this.cast.render(frameDt, player);
    const run = this.current;
    if (!run || this.deps.sceneUI.active) {
      this.hudLine.style.display = 'none';
      return;
    }
    const text = run.step.text(this.ctx);
    const t = run.step.timeLeft();
    const clock = t === null ? '' : ` · ${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    if (text) {
      this.hudLine.textContent = `★ ${run.spec.title} — ${text}${clock}`;
      this.hudLine.style.display = '';
    } else {
      this.hudLine.style.display = 'none';
    }
    // The route line to the step's target (re-routed when the target moves a lot; moving
    // targets like cars are only refreshed every couple of seconds).
    this.routeTimer -= frameDt;
    const target = run.step.target(this.ctx);
    if (!target) {
      if (this.deps.navigator.owner === 'story') this.deps.navigator.clear();
      this.routeTarget.set(Infinity, 0, 0);
    } else if (this.routeTimer <= 0 && Math.hypot(target.x - this.routeTarget.x, target.z - this.routeTarget.z) > 15) {
      this.routeTimer = 2;
      this.routeTarget.copy(target);
      this.deps.navigator.setWaypoint(target.x, target.z, 'story');
    }
  }

  /** Map markers: who has a ★, and where the current objective is. */
  markers(): { stars: THREE.Vector3[]; objective: THREE.Vector3 | null } {
    return { stars: this.cast.starred(), objective: this.current?.step.target(this.ctx) ?? null };
  }

  // ---------------------------------------------------------------- saving

  toJSON(): StorySave {
    return { done: [...this.done], flags: { ...this.flags }, phone: [...this.deps.phoneUI.log] };
  }

  load(data: StorySave): void {
    this.done.clear();
    for (const id of data.done) if (this.deps.missions.some((m) => m.id === id)) this.done.add(id);
    for (const k of Object.keys(this.flags)) delete this.flags[k];
    Object.assign(this.flags, data.flags);
    this.deps.phoneUI.load(data.phone);
    this.refresh();
  }

  /** Tests: the running step (to teleport to its target) and a way to finish a scene. */
  get debugStep(): { mission: string; index: number; kind: string; target: THREE.Vector3 | null } | null {
    const run = this.current;
    if (!run) return null;
    return { mission: run.spec.id, index: run.index, kind: run.spec.steps[run.index].kind, target: run.step.target(this.ctx) };
  }

  get debugCtx(): StoryCtx {
    return this.ctx;
  }
}
