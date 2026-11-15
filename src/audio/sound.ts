// Sound, all synthesised with the Web Audio API (no audio files, no libraries).
//
// One AudioContext, started on the first click / tap / key press (browsers only allow audio
// after a user gesture). Everything goes through a master gain (mute: N or the 🔊 button,
// remembered in localStorage) split into an effects bus and a music bus (the car radio).
//
// The building blocks:
//   noise        one shared 2 s buffer of white noise; filtered, it becomes wind, waves,
//                tyre screech, gunshots, rotor wash, footsteps…
//   Loop         a continuous sound with a few parameters set every frame (engine pitch,
//                rotor rate, wind strength…), faded in and out with its gain
//   one-shots    short envelopes of noise / oscillators, built per sound and thrown away
//                when they end (they disconnect themselves, so nothing piles up)
//   positional   sounds in the world (sirens, other cars, gunfire, crashes) go through a
//                PannerNode at their position; the listener follows the camera
//
// Gains are kept modest: this is background texture under the game, not the main event.

import * as THREE from 'three';

const STORAGE_KEY = 'opencity.audio';

interface Settings {
  muted: boolean;
  station: number; // car radio: -1 = off
}

function loadSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Settings> | null;
    // Station: −1 (off) … 2; anything else (an old or edited value) falls back to the first.
    const station = typeof s?.station === 'number' && Number.isInteger(s.station) && s.station >= -1 && s.station <= 2 ? s.station : 0;
    return { muted: !!s?.muted, station };
  } catch {
    return { muted: false, station: 0 };
  }
}

export class Sound {
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfx!: GainNode;
  music!: GainNode;
  private noiseBuffer!: AudioBuffer;
  readonly settings = loadSettings();
  /** One-shot nodes alive right now (for tests: should stay small). */
  live = 0;
  private readonly listeners: (() => void)[] = [];

  constructor() {
    const start = () => this.start();
    for (const type of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(type, start, { capture: true, passive: true });
    // Silence while the tab or app is in the background (the game loop stops there).
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.visibilityState === 'hidden') void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  /** Called when the audio context starts (to build loops). */
  onStart(listener: () => void): void {
    if (this.ctx) listener();
    else this.listeners.push(listener);
  }

  /** Create / resume the context (needs a user gesture). */
  start(): void {
    if (this.ctx) {
      // 'suspended', or iOS's 'interrupted' after a call: resume on the next tap.
      if (this.ctx.state !== 'running' && document.visibilityState === 'visible') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.settings.muted ? 0 : 0.8;
    // A gentle compressor keeps a pile-up of crashes and gunfire from clipping.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.gain.value = 0.35;
    this.music.connect(this.master);
    // 2 s of white noise, shared by everything.
    this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    for (const l of this.listeners) l();
    this.listeners.length = 0;
  }

  get muted(): boolean {
    return this.settings.muted;
  }

  toggleMute(): void {
    this.settings.muted = !this.settings.muted;
    this.save();
    if (this.ctx) this.master.gain.setTargetAtTime(this.settings.muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // ignore
    }
  }

  /** The listener (your ears) follows the camera. Call every frame. */
  setListener(camera: THREE.Camera): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    const p = camera.position;
    const f = camera.getWorldDirection(this.tmp);
    const t = ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(p.x, t, 0.02);
      l.positionY.setTargetAtTime(p.y, t, 0.02);
      l.positionZ.setTargetAtTime(p.z, t, 0.02);
      l.forwardX.setTargetAtTime(f.x, t, 0.02);
      l.forwardY.setTargetAtTime(f.y, t, 0.02);
      l.forwardZ.setTargetAtTime(f.z, t, 0.02);
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(f.x, f.y, f.z, 0, 1, 0);
    }
  }
  private readonly tmp = new THREE.Vector3();

  // ---------------------------------------------------------------- building blocks

  /** A looping noise source. */
  noise(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.loopStart = Math.random();
    return src;
  }

  filter(type: BiquadFilterType, frequency: number, q = 1): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = q;
    return f;
  }

  gain(value = 0): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = value;
    return g;
  }

  /** A panner for a sound at a world position (inverse distance roll-off). */
  panner(ref = 8, max = 400): PannerNode {
    const p = this.ctx!.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.maxDistance = max;
    p.rolloffFactor = 1.2;
    return p;
  }

  static place(p: PannerNode, at: THREE.Vector3, t: number): void {
    if (p.positionX) {
      p.positionX.setTargetAtTime(at.x, t, 0.03);
      p.positionY.setTargetAtTime(at.y, t, 0.03);
      p.positionZ.setTargetAtTime(at.z, t, 0.03);
    } else {
      p.setPosition(at.x, at.y, at.z);
    }
  }

  /**
   * Play a short sound: `build` connects its sources into `out` and returns them and how
   * long they last; afterwards everything is stopped and disconnected.
   */
  private oneShot(at: THREE.Vector3 | null, volume: number, build: (out: AudioNode, t: number) => { sources: AudioScheduledSourceNode[]; length: number }, ref = 8): void {
    const ctx = this.ctx;
    if (!ctx || this.settings.muted || this.live > 60) return;
    const t = ctx.currentTime;
    const out = this.gain(volume);
    let tail: AudioNode = out;
    if (at) {
      const p = this.panner(ref);
      Sound.place(p, at, t);
      if (p.positionX) {
        p.positionX.value = at.x;
        p.positionY.value = at.y;
        p.positionZ.value = at.z;
      }
      out.connect(p);
      tail = p;
    }
    tail.connect(this.sfx);
    const { sources, length } = build(out, t);
    this.live++;
    let left = sources.length;
    for (const s of sources) {
      s.stop(t + length);
      s.onended = () => {
        s.disconnect();
        if (--left === 0) {
          out.disconnect();
          if (tail !== out) tail.disconnect();
          this.live--;
        }
      };
    }
  }

  /** An envelope on a gain: quick attack, exponential decay over `decay` s. */
  private env(g: GainNode, t: number, peak: number, decay: number, attack = 0.003): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  // ---------------------------------------------------------------- one-shot effects

  /** Gunshot: a sharp noise crack plus a low thump; the rifle is louder and longer. */
  gunshot(at: THREE.Vector3, rifle = false): void {
    this.oneShot(at, rifle ? 1.1 : 0.85, (out, t) => {
      const n = this.noise();
      const hp = this.filter('highpass', 900);
      const g = this.gain();
      this.env(g, t, 1, rifle ? 0.22 : 0.14);
      n.connect(hp).connect(g).connect(out);
      const thump = this.ctx!.createOscillator();
      thump.frequency.setValueAtTime(rifle ? 140 : 180, t);
      thump.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      const tg = this.gain();
      this.env(tg, t, 0.9, 0.12);
      thump.connect(tg).connect(out);
      n.start(t);
      thump.start(t);
      return { sources: [n, thump], length: 0.4 };
    }, 15);
  }

  /** A punch or bat hit: a short low thud (a bat adds a woody knock). */
  hit(at: THREE.Vector3, bat = false): void {
    this.oneShot(at, 0.7, (out, t) => {
      const o = this.ctx!.createOscillator();
      o.frequency.setValueAtTime(bat ? 220 : 120, t);
      o.frequency.exponentialRampToValueAtTime(50, t + 0.1);
      const g = this.gain();
      this.env(g, t, 1, 0.1);
      o.connect(g).connect(out);
      const n = this.noise();
      const bp = this.filter('bandpass', bat ? 1200 : 600, 1.5);
      const ng = this.gain();
      this.env(ng, t, 0.6, 0.06);
      n.connect(bp).connect(ng).connect(out);
      o.start(t);
      n.start(t);
      return { sources: [o, n], length: 0.2 };
    });
  }

  /** A swing that missed. */
  swoosh(at: THREE.Vector3): void {
    this.oneShot(at, 0.25, (out, t) => {
      const n = this.noise();
      const bp = this.filter('bandpass', 500, 2);
      bp.frequency.exponentialRampToValueAtTime(2500, t + 0.15);
      const g = this.gain();
      this.env(g, t, 1, 0.15, 0.04);
      n.connect(bp).connect(g).connect(out);
      n.start(t);
      return { sources: [n], length: 0.25 };
    });
  }

  /** Someone knocked down: a short falling "oof" (a voiced vowel-ish tone). */
  oof(at: THREE.Vector3): void {
    this.oneShot(at, 0.45, (out, t) => {
      const o = this.ctx!.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(190 + Math.random() * 60, t);
      o.frequency.exponentialRampToValueAtTime(90, t + 0.25);
      const formant = this.filter('bandpass', 700, 3);
      const g = this.gain();
      this.env(g, t, 1, 0.25, 0.02);
      o.connect(formant).connect(g).connect(out);
      o.start(t);
      return { sources: [o], length: 0.35 };
    });
  }

  /** A crash: a burst of low noise and a metallic clang, scaled by `strength` (0…1). */
  crash(at: THREE.Vector3 | null, strength: number): void {
    const s = Math.max(0.15, Math.min(1, strength));
    this.oneShot(at, 0.5 + s * 0.8, (out, t) => {
      const n = this.noise();
      const lp = this.filter('lowpass', 900 + s * 1500);
      const g = this.gain();
      this.env(g, t, 1, 0.3 + s * 0.5);
      n.connect(lp).connect(g).connect(out);
      const clang = this.ctx!.createOscillator();
      clang.type = 'square';
      clang.frequency.value = 160 + Math.random() * 80;
      const cf = this.filter('bandpass', 1400, 6);
      const cg = this.gain();
      this.env(cg, t, 0.35 * s, 0.25);
      clang.connect(cf).connect(cg).connect(out);
      n.start(t);
      clang.start(t);
      return { sources: [n, clang], length: 1 };
    }, 12);
  }

  /** A footstep (or a splash when swimming). Not positional: they're your feet. */
  step(running: boolean, water: boolean): void {
    this.oneShot(null, water ? 0.18 : running ? 0.12 : 0.08, (out, t) => {
      const n = this.noise();
      const f = water ? this.filter('bandpass', 900, 0.8) : this.filter('lowpass', running ? 1300 : 900);
      const g = this.gain();
      this.env(g, t, 1, water ? 0.25 : 0.06, water ? 0.03 : 0.002);
      n.connect(f).connect(g).connect(out);
      n.start(t);
      return { sources: [n], length: water ? 0.35 : 0.12 };
    });
  }

  /** A bird: a quick whistled chirp or two (daytime ambience). */
  chirp(at: THREE.Vector3): void {
    this.oneShot(at, 0.12, (out, t) => {
      const sources: OscillatorNode[] = [];
      const notes = 1 + Math.floor(Math.random() * 3);
      const f0 = 2600 + Math.random() * 1600;
      for (let k = 0; k < notes; k++) {
        const o = this.ctx!.createOscillator();
        const s = t + k * 0.11;
        o.frequency.setValueAtTime(f0, s);
        o.frequency.exponentialRampToValueAtTime(f0 * (1.25 + Math.random() * 0.4), s + 0.07);
        const g = this.gain();
        this.env(g, s, 1, 0.07, 0.01);
        o.connect(g).connect(out);
        o.start(s);
        sources.push(o);
      }
      return { sources, length: notes * 0.11 + 0.15 };
    }, 20);
  }

  /** A cricket: a burst of fast high pulses (night ambience). */
  cricket(at: THREE.Vector3): void {
    this.oneShot(at, 0.05, (out, t) => {
      const o = this.ctx!.createOscillator();
      o.frequency.value = 4300 + Math.random() * 500;
      const am = this.ctx!.createOscillator();
      am.type = 'square';
      am.frequency.value = 28;
      const depth = this.gain(0.5);
      const g = this.gain(0.5);
      am.connect(depth).connect(g.gain);
      const env = this.gain();
      this.env(env, t, 1, 0.45, 0.05);
      o.connect(g).connect(env).connect(out);
      o.start(t);
      am.start(t);
      return { sources: [o, am], length: 0.6 };
    }, 15);
  }

  /** A short UI blip (money, job done): two rising sine notes. */
  chime(): void {
    this.oneShot(null, 0.18, (out, t) => {
      const sources: OscillatorNode[] = [];
      for (const [k, f] of [880, 1320].entries()) {
        const o = this.ctx!.createOscillator();
        o.frequency.value = f;
        const g = this.gain();
        this.env(g, t + k * 0.09, 1, 0.25);
        o.connect(g).connect(out);
        o.start(t + k * 0.09);
        sources.push(o);
      }
      return { sources, length: 0.5 };
    });
  }
}

// ---------------------------------------------------------------- continuous sounds

/**
 * An engine: two detuned sawtooth oscillators an octave apart plus a little filtered
 * noise, through a low-pass that opens with load. `set(rpm01, load, volume)` each frame.
 * Optionally positional (other cars).
 */
export class EngineVoice {
  private readonly a: OscillatorNode;
  private readonly b: OscillatorNode;
  private readonly lp: BiquadFilterNode;
  private readonly out: GainNode;
  readonly panner: PannerNode | null;

  constructor(
    private readonly s: Sound,
    private readonly base: number,
    positional: boolean,
  ) {
    const ctx = s.ctx!;
    this.a = ctx.createOscillator();
    this.b = ctx.createOscillator();
    this.a.type = this.b.type = 'sawtooth';
    this.b.detune.value = 9;
    this.lp = s.filter('lowpass', 500, 2);
    const mix = s.gain(0.5);
    this.a.connect(mix);
    this.b.connect(mix);
    const n = s.noise();
    const nf = s.filter('bandpass', 300, 1);
    const ng = s.gain(0.15);
    n.connect(nf).connect(ng).connect(this.lp);
    mix.connect(this.lp);
    this.out = s.gain(0);
    this.lp.connect(this.out);
    this.panner = positional ? s.panner(6, 250) : null;
    if (this.panner) this.out.connect(this.panner).connect(s.sfx);
    else this.out.connect(s.sfx);
    this.a.start();
    this.b.start();
    n.start();
  }

  /** rpm 0 (idle) … 1 (red line); load 0 … 1 (throttle); volume 0 … 1. */
  set(rpm: number, load: number, volume: number, at?: THREE.Vector3): void {
    const t = this.s.ctx!.currentTime;
    const f = this.base * (1 + rpm * 2.6);
    this.a.frequency.setTargetAtTime(f, t, 0.05);
    this.b.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    this.lp.frequency.setTargetAtTime(350 + rpm * 900 + load * 900, t, 0.08);
    this.out.gain.setTargetAtTime(volume * (0.06 + load * 0.05), t, 0.1);
    if (this.panner && at) Sound.place(this.panner, at, t);
  }
}

/** A noise loop through a filter, its level (and filter) set every frame: wind, waves, screech. */
export class NoiseVoice {
  readonly filter: BiquadFilterNode;
  readonly out: GainNode;

  constructor(
    private readonly s: Sound,
    type: BiquadFilterType,
    frequency: number,
    q = 1,
    bus: AudioNode = s.sfx,
  ) {
    const n = s.noise();
    this.filter = s.filter(type, frequency, q);
    this.out = s.gain(0);
    n.connect(this.filter).connect(this.out).connect(bus);
    n.start();
  }

  set(volume: number, frequency?: number, rate = 0.15): void {
    const t = this.s.ctx!.currentTime;
    this.out.gain.setTargetAtTime(volume, t, rate);
    if (frequency !== undefined) this.filter.frequency.setTargetAtTime(frequency, t, 0.1);
  }
}

/**
 * Helicopter rotor: low noise chopped by a square-wave LFO at the blade-pass rate
 * (two blades × rotor speed), so it goes "wop-wop-wop", plus a turbine whine.
 */
export class RotorVoice {
  private readonly lfo: OscillatorNode;
  private readonly chop: GainNode;
  private readonly whine: OscillatorNode;
  private readonly whineGain: GainNode;
  private readonly out: GainNode;
  readonly panner: PannerNode | null;

  constructor(
    private readonly s: Sound,
    positional: boolean,
  ) {
    const ctx = s.ctx!;
    const n = s.noise();
    const lp = s.filter('lowpass', 380, 1);
    this.chop = s.gain(0.5);
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'square';
    const depth = s.gain(0.5);
    this.lfo.connect(depth).connect(this.chop.gain);
    this.whine = ctx.createOscillator();
    this.whine.type = 'triangle';
    this.whineGain = s.gain(0);
    this.out = s.gain(0);
    n.connect(lp).connect(this.chop).connect(this.out);
    this.whine.connect(this.whineGain).connect(this.out);
    this.panner = positional ? s.panner(15, 600) : null;
    if (this.panner) this.out.connect(this.panner).connect(s.sfx);
    else this.out.connect(s.sfx);
    n.start();
    this.lfo.start();
    this.whine.start();
  }

  /** rotor 0 … 1 (spin-up), volume 0 … 1. */
  set(rotor: number, volume: number, at?: THREE.Vector3): void {
    const t = this.s.ctx!.currentTime;
    this.lfo.frequency.setTargetAtTime(Math.max(0.5, rotor * 9), t, 0.1);
    this.whine.frequency.setTargetAtTime(600 + rotor * 1800, t, 0.2);
    this.whineGain.gain.setTargetAtTime(rotor * 0.04, t, 0.2);
    this.out.gain.setTargetAtTime(volume * rotor * 0.5, t, 0.15);
    if (this.panner && at) Sound.place(this.panner, at, t);
  }
}

/** A police siren: a wail (slow up-and-down sweep), positional. */
export class SirenVoice {
  private readonly osc: OscillatorNode;
  private readonly out: GainNode;
  readonly panner: PannerNode;

  constructor(private readonly s: Sound) {
    const ctx = s.ctx!;
    this.osc = ctx.createOscillator();
    this.osc.type = 'square';
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.35 + Math.random() * 0.1;
    const depth = s.gain(330);
    lfo.connect(depth).connect(this.osc.frequency);
    this.osc.frequency.value = 960;
    const lp = s.filter('lowpass', 2200);
    this.out = s.gain(0);
    this.panner = s.panner(20, 700);
    this.osc.connect(lp).connect(this.out).connect(this.panner).connect(s.sfx);
    this.osc.start();
    lfo.start();
  }

  set(volume: number, at: THREE.Vector3): void {
    const t = this.s.ctx!.currentTime;
    this.out.gain.setTargetAtTime(volume * 0.07, t, 0.2);
    Sound.place(this.panner, at, t);
  }
}
