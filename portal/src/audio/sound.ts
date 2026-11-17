// Synthesised sound (Web Audio, no files): portal open per colour, fizzle, passing through,
// footsteps by surface, landing, and a catalogue of named effects for the simulation's `sfx` events
// (buttons, doors, carry hum, pellets, turrets, elevator, alarm, dissolve...), with a fallback blip
// for names it doesn't know. Every sound is original, made from oscillators and filtered noise.
//
// Routing: effects → effectsDuck → effects volume ─┐
//          music  → musicDuck   → music volume   ──┼→ master volume → speakers
//          voice                → voice volume   ──┘
// The duck gains dip while the overseer speaks (dialogue manager).

export type Bus = 'effects' | 'music' | 'voice';
export interface Volumes {
  master: number;
  music: number;
  effects: number;
  voice: number;
}

type Recipe = (s: Sound) => void;

/** Normalise an sfx name: "door_open", "door-open", "DoorOpen" → "dooropen". */
const norm = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

export class Sound {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses: Partial<Record<Bus, GainNode>> = {};
  private ducks: Partial<Record<'effects' | 'music', GainNode>> = {};
  noise: AudioBuffer | null = null;
  muted = false;
  /** Set by the audio director when `footstep` events carry the surface. */
  eventFootsteps = false;
  volumes: Volumes = { master: 0.8, music: 0.6, effects: 0.8, voice: 0.9 };
  private ducked = false;
  private hum: { stop(): void } | null = null;
  private roomTone: { stop(): void } | null = null;
  /** What has played (tests and the debug overlay). Counted even when audio is locked. */
  readonly stats = { sfx: 0, fallback: 0, last: '', footsteps: {} as Record<string, number> };
  /** Called whenever the context is created (music and voice hook in here). */
  onUnlock: (() => void) | null = null;

  /** Call from a user gesture (browsers only start audio after one). */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    for (const b of ['effects', 'music', 'voice'] as const) {
      const g = ctx.createGain();
      g.connect(this.master);
      this.buses[b] = g;
    }
    for (const b of ['effects', 'music'] as const) {
      const d = ctx.createGain();
      d.connect(this.buses[b]!);
      this.ducks[b] = d;
    }
    this.applyVolumes();
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let x = 1;
    for (let i = 0; i < len; i++) {
      x = (x * 16807) % 2147483647;
      d[i] = (x / 2147483647) * 2 - 1;
    }
    this.onUnlock?.();
  }

  /** The node a bus's sounds connect to (null while audio is locked). */
  out(bus: Bus): AudioNode | null {
    if (!this.ctx) return null;
    return bus === 'voice' ? this.buses.voice! : this.ducks[bus]!;
  }

  setVolumes(v: Partial<Volumes>): void {
    Object.assign(this.volumes, v);
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volumes.master, t, 0.02);
    for (const b of ['effects', 'music', 'voice'] as const) this.buses[b]!.gain.setTargetAtTime(this.volumes[b], t, 0.02);
  }

  /** Lower music and effects while someone speaks. */
  duck(on: boolean, factor: number, seconds: number): void {
    this.ducked = on;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const b of ['effects', 'music'] as const) this.ducks[b]!.gain.setTargetAtTime(on ? factor : 1, t, seconds / 3);
  }

  get isDucked(): boolean {
    return this.ducked;
  }

  private ready(): AudioContext | null {
    return this.muted || !this.ctx || this.ctx.state !== 'running' ? null : this.ctx;
  }

  // --- Building blocks ------------------------------------------------------------------------

  /** A pitched tone gliding freq0 → freq1. */
  tone(freq0: number, freq1: number, dur: number, type: OscillatorType, vol: number, delay = 0, bus: Bus = 'effects'): void {
    const ctx = this.ready();
    const out = this.out(bus);
    if (!ctx || !out) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, freq1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Band-passed noise burst. */
  burst(dur: number, freq: number, q: number, vol: number, delay = 0, bus: Bus = 'effects', type: BiquadFilterType = 'bandpass'): void {
    const ctx = this.ready();
    const out = this.out(bus);
    if (!ctx || !out || !this.noise) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  /** A sustained sound that runs until stop() (carry hum, room tone). */
  private loop(build: (ctx: AudioContext, out: AudioNode) => AudioScheduledSourceNode[], bus: Bus, vol: number): { stop(): void } | null {
    const ctx = this.ready();
    const out = this.out(bus);
    if (!ctx || !out) return null;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(vol, ctx.currentTime + 0.3);
    g.connect(out);
    const srcs = build(ctx, g);
    for (const s of srcs) s.start();
    return {
      stop: () => {
        const t = ctx.currentTime;
        g.gain.cancelScheduledValues(t);
        g.gain.setTargetAtTime(0.0001, t, 0.08);
        for (const s of srcs) s.stop(t + 0.4);
      },
    };
  }

  // --- The simulation's own calls (game.ts) ---------------------------------------------------

  portalOpen(which: 'a' | 'b'): void {
    if (which === 'a') this.tone(380, 920, 0.22, 'sine', 0.25);
    else this.tone(900, 360, 0.22, 'sine', 0.25);
    this.burst(0.18, 2400, 2, 0.12);
  }

  fizzle(): void {
    this.burst(0.25, 1400, 6, 0.3);
    this.tone(220, 110, 0.15, 'square', 0.06);
  }

  pass(speed: number): void {
    this.burst(0.3, 600 + Math.min(speed, 40) * 40, 1.2, 0.18);
  }

  /** Footstep by surface: soft thud on panels, a ringing clank on metal, a hard tick on glass. */
  footstep(surface?: string): void {
    // Once footsteps arrive as bus events (with a surface), the simulation's own bare calls are
    // dropped so each step sounds once.
    if (surface === undefined) {
      if (this.eventFootsteps) return;
      surface = 'panel';
    }
    this.stats.footsteps[surface] = (this.stats.footsteps[surface] ?? 0) + 1;
    switch (surface) {
      case 'metal':
        this.burst(0.07, 1800, 4, 0.12);
        this.tone(620 + Math.random() * 60, 580, 0.12, 'triangle', 0.03);
        break;
      case 'glass':
        this.burst(0.04, 3800, 6, 0.1);
        this.tone(2400, 2300, 0.05, 'sine', 0.02);
        break;
      case 'panel':
        this.burst(0.06, 900, 3, 0.12);
        break;
      default:
        this.burst(0.07, 520, 2, 0.12);
    }
  }

  land(speed: number): void {
    this.burst(0.15, 220, 1.5, Math.min(0.5, 0.08 + speed * 0.02));
  }

  // --- Named effects (sfx events) -------------------------------------------------------------

  /** Is there a dedicated sound for this name (else the fallback plays)? */
  static knows(name: string): boolean {
    return norm(name) in RECIPES;
  }

  static names(): string[] {
    return Object.keys(RECIPES);
  }

  /** Play a named effect; unknown names get a short neutral blip pitched from the name. */
  sfx(name: string): void {
    this.stats.sfx++;
    this.stats.last = name;
    const r = RECIPES[norm(name)];
    if (r) return r(this);
    this.stats.fallback++;
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const f = 300 + (h % 600);
    this.tone(f, f * 0.8, 0.09, 'triangle', 0.08);
  }

  startCarryHum(): void {
    this.stopCarryHum();
    this.hum = this.loop(
      (ctx, out) => {
        const a = ctx.createOscillator();
        a.type = 'sawtooth';
        a.frequency.value = 55;
        const b = ctx.createOscillator();
        b.type = 'sine';
        b.frequency.value = 110.7; // slight detune → slow beating
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 320;
        a.connect(f).connect(out);
        b.connect(out);
        return [a, b];
      },
      'effects',
      0.05,
    );
  }

  stopCarryHum(): void {
    this.hum?.stop();
    this.hum = null;
  }

  get carrying(): boolean {
    return !!this.hum;
  }

  /** Air handling and a faint mains hum under everything in a chamber. */
  startRoomTone(level: number): void {
    if (this.roomTone) return;
    this.roomTone = this.loop(
      (ctx, out) => {
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        src.loop = true;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 260;
        src.connect(lp).connect(out);
        const hum = ctx.createOscillator();
        hum.frequency.value = 50;
        const hg = ctx.createGain();
        hg.gain.value = 0.25;
        hum.connect(hg).connect(out);
        return [src, hum];
      },
      'effects',
      level,
    );
  }

  stopRoomTone(): void {
    this.roomTone?.stop();
    this.roomTone = null;
  }
}

/** Every named effect. Names are normalised (lowercase letters and digits only). */
const RECIPES: Record<string, Recipe> = {
  // Portals
  portalopena: (s) => s.portalOpen('a'),
  portalopenb: (s) => s.portalOpen('b'),
  portalclose: (s) => (s.tone(700, 160, 0.25, 'sine', 0.18), s.burst(0.2, 900, 2, 0.08)),
  fizzle: (s) => s.fizzle(),
  // Inputs
  buttonpress: (s) => (s.burst(0.08, 260, 2, 0.35), s.tone(180, 120, 0.12, 'square', 0.06)),
  buttonrelease: (s) => (s.burst(0.06, 420, 2, 0.2), s.tone(140, 200, 0.1, 'square', 0.04)),
  buttonclick: (s) => (s.burst(0.03, 3200, 4, 0.25), s.tone(1200, 1100, 0.04, 'square', 0.05)),
  pedestalpress: (s) => (s.burst(0.03, 3200, 4, 0.25), s.tone(880, 1320, 0.12, 'sine', 0.12)),
  timertick: (s) => s.tone(1600, 1600, 0.035, 'square', 0.05),
  timertock: (s) => s.tone(1200, 1200, 0.035, 'square', 0.05),
  timerend: (s) => (s.tone(900, 450, 0.3, 'square', 0.08)),
  catcherlatch: (s) => (s.tone(300, 900, 0.3, 'sawtooth', 0.08), s.burst(0.2, 1500, 3, 0.15)),
  receiverpowered: (s) => s.tone(220, 660, 0.5, 'triangle', 0.1),
  // Receivers
  dooropen: (s) => (s.tone(90, 160, 0.55, 'sawtooth', 0.06), s.burst(0.55, 420, 1.5, 0.1), s.burst(0.08, 200, 2, 0.25, 0.5)),
  doorclose: (s) => (s.tone(160, 80, 0.5, 'sawtooth', 0.06), s.burst(0.5, 380, 1.5, 0.1), s.burst(0.12, 140, 2, 0.35, 0.45)),
  doorservo: (s) => (s.tone(110, 150, 0.5, 'sawtooth', 0.05), s.burst(0.5, 500, 2, 0.08)),
  platformmove: (s) => (s.tone(70, 75, 0.8, 'sawtooth', 0.04), s.burst(0.8, 300, 1, 0.06)),
  platformstop: (s) => s.burst(0.15, 180, 2, 0.25),
  liftmove: (s) => (s.tone(60, 90, 1, 'sawtooth', 0.04), s.burst(1, 260, 1, 0.06)),
  panelmove: (s) => (s.burst(0.4, 700, 2, 0.12), s.burst(0.1, 160, 2, 0.3, 0.35)),
  indicatoron: (s) => s.tone(1400, 1400, 0.05, 'sine', 0.05),
  signon: (s) => (s.burst(0.05, 5000, 3, 0.08), s.tone(120, 120, 0.3, 'square', 0.02)),
  // Carrying
  pickup: (s) => (s.tone(240, 480, 0.15, 'sine', 0.12), s.startCarryHum()),
  carrystart: (s) => (s.tone(240, 480, 0.15, 'sine', 0.12), s.startCarryHum()),
  drop: (s) => (s.tone(480, 200, 0.15, 'sine', 0.1), s.stopCarryHum()),
  carrystop: (s) => (s.tone(480, 200, 0.15, 'sine', 0.1), s.stopCarryHum()),
  carryhum: (s) => s.startCarryHum(),
  carrydeny: (s) => s.tone(220, 200, 0.12, 'square', 0.06),
  impact: (s) => s.burst(0.12, 300, 1.5, 0.3),
  cubeimpact: (s) => s.burst(0.14, 240, 1.5, 0.35),
  // Pellets
  pelletlaunch: (s) => (s.tone(200, 1200, 0.3, 'sawtooth', 0.08), s.burst(0.2, 2000, 2, 0.12)),
  pelletwhine: (s) => s.tone(1300, 1450, 0.5, 'sine', 0.05),
  pelletbounce: (s) => (s.tone(900, 1500, 0.08, 'sine', 0.12), s.burst(0.05, 3000, 3, 0.1)),
  pelletexpire: (s) => (s.tone(1400, 200, 0.35, 'sawtooth', 0.06), s.burst(0.3, 1200, 2, 0.15)),
  pelletcaught: (s) => (s.tone(400, 1200, 0.4, 'triangle', 0.12), s.burst(0.25, 1600, 3, 0.15)),
  // Hazards
  dissolve: (s) => (s.burst(0.7, 2600, 1.2, 0.18), s.tone(1800, 300, 0.7, 'sine', 0.06)),
  grillpass: (s) => (s.burst(0.3, 3400, 2, 0.12), s.tone(900, 700, 0.3, 'sine', 0.05)),
  splash: (s) => (s.burst(0.45, 700, 0.8, 0.35), s.burst(0.3, 2000, 1, 0.12, 0.05)),
  acid: (s) => s.burst(0.5, 1400, 0.7, 0.2),
  crusher: (s) => (s.burst(0.25, 90, 1.5, 0.6), s.tone(70, 40, 0.3, 'square', 0.12)),
  crushermove: (s) => (s.tone(60, 70, 0.6, 'sawtooth', 0.05), s.burst(0.6, 200, 1, 0.08)),
  alarm: (s) => {
    for (let i = 0; i < 3; i++) s.tone(660, 520, 0.35, 'square', 0.07, i * 0.45);
  },
  klaxon: (s) => {
    for (let i = 0; i < 2; i++) s.tone(330, 330, 0.5, 'sawtooth', 0.08, i * 0.7);
  },
  explosion: (s) => (s.burst(1.1, 140, 0.6, 0.7), s.burst(0.4, 900, 0.7, 0.3)),
  // Turrets (original barks are text + these chirps)
  turretdeploy: (s) => (s.tone(400, 800, 0.15, 'square', 0.05), s.tone(800, 1200, 0.1, 'square', 0.05, 0.16)),
  turretspot: (s) => (s.tone(1200, 1500, 0.08, 'sine', 0.1), s.tone(1500, 1500, 0.08, 'sine', 0.1, 0.1)),
  turretsearch: (s) => s.tone(700, 900, 0.25, 'sine', 0.05),
  turretfire: (s) => (s.burst(0.05, 2500, 1, 0.3), s.tone(180, 90, 0.05, 'square', 0.08)),
  turrettip: (s) => (s.tone(900, 300, 0.4, 'square', 0.06), s.burst(0.2, 600, 2, 0.2)),
  turretdie: (s) => (s.tone(600, 80, 0.8, 'sawtooth', 0.06)),
  turretretire: (s) => (s.tone(1000, 500, 0.3, 'sine', 0.06)),
  rocketfire: (s) => (s.burst(0.6, 600, 0.6, 0.35), s.tone(200, 60, 0.6, 'sawtooth', 0.08)),
  rocketlock: (s) => s.tone(1800, 1800, 0.1, 'square', 0.06),
  // Player
  damage: (s) => (s.burst(0.12, 400, 1.5, 0.35), s.tone(150, 90, 0.15, 'square', 0.08)),
  hurt: (s) => (s.burst(0.12, 400, 1.5, 0.35), s.tone(150, 90, 0.15, 'square', 0.08)),
  death: (s) => (s.tone(400, 50, 1.2, 'sawtooth', 0.1), s.burst(1, 300, 0.8, 0.2)),
  respawn: (s) => s.tone(200, 600, 0.4, 'sine', 0.1),
  land: (s) => s.land(6),
  // Progress
  checkpoint: (s) => (s.tone(660, 660, 0.12, 'sine', 0.1), s.tone(990, 990, 0.2, 'sine', 0.1, 0.12)),
  elevatorchime: (s) => (s.tone(784, 784, 0.6, 'sine', 0.12), s.tone(1046, 1046, 0.9, 'sine', 0.1, 0.25)),
  elevatormove: (s) => (s.tone(55, 60, 2, 'sawtooth', 0.04), s.burst(2, 180, 1, 0.08)),
  elevatorarrive: (s) => (s.burst(0.2, 150, 2, 0.4), s.tone(1046, 1046, 0.6, 'sine', 0.1, 0.1)),
  exitopen: (s) => (s.tone(523, 1046, 0.4, 'triangle', 0.1)),
  bosshit: (s) => (s.burst(0.5, 300, 0.7, 0.5), s.tone(300, 80, 0.6, 'sawtooth', 0.1)),
  componentdetach: (s) => (s.burst(0.3, 1200, 2, 0.3), s.tone(500, 900, 0.3, 'square', 0.06)),
  disposal: (s) => (s.burst(1, 500, 0.6, 0.3), s.tone(300, 60, 1, 'sawtooth', 0.08)),
  // UI
  uiclick: (s) => s.tone(1000, 1000, 0.03, 'sine', 0.06),
  uihover: (s) => s.tone(1500, 1500, 0.02, 'sine', 0.025),
  uiback: (s) => s.tone(700, 500, 0.06, 'sine', 0.06),
};
