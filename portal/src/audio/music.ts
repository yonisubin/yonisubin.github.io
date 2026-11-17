// Original adaptive music, synthesised live (Web Audio). A lookahead scheduler places notes a little
// ahead of the audio clock on the music bus.
//
//   menu      slow pads, a sparse bell line
//   chamber   the calm test-chamber theme (D dorian pads + a plucked arpeggio), plus a TENSION layer
//             (pulsing filtered bass and ticking hats) whose level follows setTension() and decays
//   elevator  a light lounge loop (ii–V–I in F with a tremolo electric-piano voice and brushes)
//   stingers  short phrases on milestones (checkpoint, chamber complete, death, story)
import { SHELL } from '../core/shellConfig';
import type { Sound } from './sound';

export type MusicMode = 'off' | 'menu' | 'chamber' | 'elevator';
export type Stinger = 'checkpoint' | 'complete' | 'death' | 'milestone' | 'finale';

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// Chamber progression (MIDI notes): Dm9 – Bbmaj7 – Gm9 – Asus4, two bars each.
const CHAMBER_CHORDS = [
  [50, 57, 60, 64, 65],
  [46, 53, 57, 62, 65],
  [43, 50, 58, 62, 69],
  [45, 52, 57, 62, 64],
];
// Elevator: Gm7 – C9 – Fmaj7 – D7(b9), one bar each.
const ELEVATOR_CHORDS = [
  [43, 58, 62, 65],
  [48, 58, 62, 64],
  [41, 57, 60, 64],
  [50, 54, 60, 63],
];
const ELEVATOR_TUNE = [74, 72, 70, 69, 70, 72, 74, -1, 76, 74, 72, 70, 69, -1, 65, -1];
const ARP = [0, 2, 1, 3, 2, 4, 3, 1];

export class Music {
  mode: MusicMode = 'off';
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0;
  private step = 0;
  private tensionGain: GainNode | null = null;
  private layerGain: GainNode | null = null;
  tension = 0;
  private tensionTarget = 0;
  private tensionUntil = 0;
  readonly stats = { notes: 0, stingers: 0, lastStinger: '' as Stinger | '' };

  constructor(private readonly sound: Sound) {}

  private get ctx(): AudioContext | null {
    return this.sound.ctx && this.sound.ctx.state === 'running' ? this.sound.ctx : null;
  }

  private ensureNodes(): boolean {
    const ctx = this.sound.ctx;
    const out = this.sound.out('music');
    if (!ctx || !out) return false;
    if (!this.layerGain) {
      this.layerGain = ctx.createGain();
      this.layerGain.gain.value = 1;
      this.layerGain.connect(out);
      this.tensionGain = ctx.createGain();
      this.tensionGain.gain.value = 0;
      this.tensionGain.connect(out);
    }
    return true;
  }

  play(mode: MusicMode): void {
    if (mode === this.mode) return;
    const ctx = this.sound.ctx;
    // Fade the old mode out quickly; the new one starts on the next tick.
    if (this.layerGain && ctx) {
      const t = ctx.currentTime;
      this.layerGain.gain.cancelScheduledValues(t);
      this.layerGain.gain.setValueAtTime(this.layerGain.gain.value, t);
      this.layerGain.gain.linearRampToValueAtTime(0.0001, t + 0.4);
      this.layerGain.disconnect();
      this.layerGain = null;
      this.tensionGain?.disconnect();
      this.tensionGain = null;
    }
    this.mode = mode;
    this.step = 0;
    this.nextTime = 0;
    if (mode === 'off') {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      return;
    }
    if (!this.timer) this.timer = setInterval(() => this.tick(), SHELL.music.tick * 1000);
    this.tick();
  }

  /** 0..1: how much of the tension layer plays. It holds for a while, then decays to 0. */
  setTension(level: number): void {
    this.tensionTarget = Math.max(this.tensionTarget, Math.min(1, level));
    this.tensionUntil = performance.now() / 1000 + SHELL.music.tensionHold;
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx || this.mode === 'off' || !this.ensureNodes()) return;
    // Tension envelope.
    const now = performance.now() / 1000;
    if (now > this.tensionUntil) this.tensionTarget = 0;
    const k = Math.min(1, SHELL.music.tensionFade * SHELL.music.tick);
    this.tension += (this.tensionTarget - this.tension) * k * 4;
    if (this.tension < 0.01 && this.tensionTarget === 0) this.tension = 0;
    this.tensionGain!.gain.setTargetAtTime(this.mode === 'chamber' ? this.tension * 0.5 : 0, ctx.currentTime, 0.3);

    const bpm = this.mode === 'elevator' ? SHELL.music.elevatorBpm : SHELL.music.bpm;
    const sixteenth = 60 / bpm / 4;
    if (this.nextTime < ctx.currentTime) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + SHELL.music.lookahead) {
      if (this.mode === 'elevator') this.elevatorStep(this.step, this.nextTime, sixteenth);
      else this.chamberStep(this.step, this.nextTime, sixteenth, this.mode === 'menu');
      this.step++;
      this.nextTime += sixteenth;
    }
  }

  /** One synth voice: oscillator → (lowpass) → envelope → destination. */
  private note(freq: number, t: number, dur: number, vol: number, type: OscillatorType, dest: AudioNode, attack = 0.01, cutoff = 0, tremolo = 0): void {
    const ctx = this.sound.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.setTargetAtTime(0.0001, t + Math.max(attack, dur * 0.6), dur * 0.25);
    let node: AudioNode = o;
    if (cutoff > 0) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = cutoff;
      node = node.connect(f);
    }
    if (tremolo > 0) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = tremolo;
      const depth = ctx.createGain();
      depth.gain.value = vol * 0.4;
      lfo.connect(depth).connect(g.gain);
      lfo.start(t);
      lfo.stop(t + dur * 1.6);
    }
    node.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur * 1.6 + 0.1);
    this.stats.notes++;
  }

  private hat(t: number, vol: number, dest: AudioNode, len = 0.04): void {
    const ctx = this.sound.ctx!;
    if (!this.sound.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.sound.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + len + 0.02);
    this.stats.notes++;
  }

  private chamberStep(step: number, t: number, s16: number, menu: boolean): void {
    const out = this.layerGain!;
    const bar = Math.floor(step / 16);
    const chord = CHAMBER_CHORDS[Math.floor(bar / 2) % CHAMBER_CHORDS.length];
    const inBar = step % 16;
    // Pads: whole chord at the start of every two bars, slow attack.
    if (inBar === 0 && bar % 2 === 0) for (const m of chord) this.note(mtof(m), t, s16 * 32, 0.035, 'triangle', out, 1.2, 1400);
    if (menu) {
      // Sparse bell line on the menu.
      if (inBar % 6 === 0 && (step * 7) % 5 !== 0) this.note(mtof(chord[1 + (step % 4)] + 12), t, s16 * 6, 0.03, 'sine', out, 0.005);
    } else if (inBar % 2 === 0) {
      // Plucked arpeggio on 8th notes.
      const m = chord[ARP[(inBar / 2) % ARP.length] % chord.length] + 12;
      this.note(mtof(m), t, s16 * 3, 0.03, 'sine', out, 0.004, 0);
    }
    // Tension layer: pulsing bass on every 16th, hats on the off-beats (its own gain).
    if (!menu) {
      const tg = this.tensionGain!;
      this.note(mtof(chord[0] - 12), t, s16 * 0.9, 0.12, 'sawtooth', tg, 0.005, 300 + (inBar % 4) * 120);
      if (inBar % 4 === 2) this.hat(t, 0.08, tg);
      if (inBar === 12) this.hat(t, 0.06, tg, 0.12);
    }
  }

  private elevatorStep(step: number, t: number, s16: number): void {
    const out = this.layerGain!;
    const bar = Math.floor(step / 16);
    const inBar = step % 16;
    const chord = ELEVATOR_CHORDS[bar % ELEVATOR_CHORDS.length];
    // Comping on beats 1 and the "and" of 2 (a gentle bossa feel).
    if (inBar === 0 || inBar === 6) for (const m of chord.slice(1)) this.note(mtof(m), t, s16 * 5, 0.03, 'sine', out, 0.01, 0, 5);
    if (inBar === 0 || inBar === 10) this.note(mtof(chord[0]), t, s16 * 4, 0.08, 'triangle', out, 0.01, 600);
    if (inBar % 2 === 0) this.hat(t, inBar % 4 === 0 ? 0.03 : 0.05, out, 0.06);
    // Melody: one note every 8th of the tune per bar pair.
    if (inBar % 4 === 0) {
      const m = ELEVATOR_TUNE[(bar * 4 + inBar / 4) % ELEVATOR_TUNE.length];
      if (m > 0) this.note(mtof(m), t, s16 * 3.5, 0.05, 'triangle', out, 0.01, 2200);
    }
  }

  /** A short phrase over whatever plays. */
  stinger(kind: Stinger): void {
    this.stats.stingers++;
    this.stats.lastStinger = kind;
    const ctx = this.ctx;
    const out = this.sound.out('music');
    if (!ctx || !out) return;
    const t = ctx.currentTime + 0.02;
    const seq: Record<Stinger, [number, number][]> = {
      checkpoint: [[69, 0], [74, 0.12]],
      milestone: [[62, 0], [66, 0.1], [69, 0.2], [74, 0.3]],
      complete: [[62, 0], [66, 0.12], [69, 0.24], [74, 0.36], [78, 0.48], [81, 0.6]],
      death: [[62, 0], [61, 0.18], [57, 0.4]],
      finale: [[50, 0], [57, 0.3], [62, 0.6], [65, 0.9], [69, 1.2], [74, 1.5]],
    };
    for (const [m, dt] of seq[kind]) {
      this.note(mtof(m), t + dt, 0.6, 0.06, kind === 'death' ? 'sawtooth' : 'triangle', out, 0.01, kind === 'death' ? 900 : 3000);
    }
  }
}
