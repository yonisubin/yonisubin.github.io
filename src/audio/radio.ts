// The car radio: three stations of endlessly generated music, played only in cars and boats.
//
// Each station is a tempo, a key, a chord progression and a set of simple synth voices
// (bass, chords, a wandering lead, kick / snare / hi-hat). A scheduler wakes every 50 ms
// and books the notes for the next 0.2 s with exact AudioContext times (the standard
// "lookahead" pattern: timers are jittery, the audio clock isn't). The melody walks up and
// down the scale, mostly by steps, landing on chord notes on the beat, so it never repeats
// exactly but always fits the chords.
//
// Notes are numbers of semitones above A1 (55 Hz): f = 55 · 2^(n / 12).

import type { Sound } from './sound';

interface Station {
  name: string;
  bpm: number;
  /** Swing: how late the off-beat eighths are (0 = straight, 0.33 = triplet feel). */
  swing: number;
  key: number; // semitones above A1
  scale: number[];
  /** Chords as scale degrees (0-based), one per bar. */
  progression: number[];
  /** Chord voice: oscillator type, length of each stab (beats), how often (beats). */
  chord: { type: OscillatorType; length: number; every: number; sevenths: boolean };
  lead: { type: OscillatorType; density: number; octave: number; decay: number };
  drums: { kick: number[]; snare: number[]; hat: number };
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];

export const STATIONS: Station[] = [
  {
    name: 'Neon 101 — synth pop',
    bpm: 118,
    swing: 0,
    key: 7, // E
    scale: MINOR,
    progression: [0, 5, 2, 6], // i – VI – III – VII
    chord: { type: 'sawtooth', length: 0.45, every: 0.5, sevenths: false },
    lead: { type: 'square', density: 0.55, octave: 3, decay: 0.25 },
    drums: { kick: [0, 2], snare: [1, 3], hat: 0.5 },
  },
  {
    name: 'Chill 88 — lo-fi',
    bpm: 78,
    swing: 0.28,
    key: 5, // D
    scale: DORIAN,
    progression: [0, 3, 6, 2], // i7 – IV7 – VII7 – III7 (soft jazzy sevenths)
    chord: { type: 'triangle', length: 1.8, every: 2, sevenths: true },
    lead: { type: 'sine', density: 0.35, octave: 3, decay: 0.6 },
    drums: { kick: [0, 2.5], snare: [1, 3], hat: 0.5 },
  },
  {
    name: 'Route 66 — country',
    bpm: 104,
    swing: 0.12,
    key: 10, // G
    scale: MAJOR,
    progression: [0, 3, 4, 0], // I – IV – V – I
    chord: { type: 'triangle', length: 0.2, every: 0.5, sevenths: false },
    lead: { type: 'triangle', density: 0.6, octave: 3, decay: 0.18 },
    drums: { kick: [0, 2], snare: [1, 3], hat: 1 },
  },
];

export class Radio {
  /** Index into STATIONS, or -1 for off. */
  station: number;
  private on = false;
  private timer = 0;
  private nextTime = 0; // AudioContext time of the next eighth note
  private eighth = 0; // eighth-note counter
  private leadNote = 0; // current melody scale step
  /** Notes booked so far (for tests). */
  booked = 0;

  constructor(private readonly s: Sound) {
    this.station = s.settings.station;
  }

  get name(): string {
    return this.station < 0 ? 'Radio off' : STATIONS[this.station].name;
  }

  /** Next station (… → off → first). */
  cycle(): string {
    this.station = this.station + 1 >= STATIONS.length ? -1 : this.station + 1;
    this.s.settings.station = this.station;
    this.s.save();
    this.eighth = 0;
    return this.name;
  }

  /** Play while `playing` (in a car or boat), with the station on. Call every frame. */
  update(playing: boolean): void {
    const want = playing && this.station >= 0 && !!this.s.ctx;
    if (want === this.on) return;
    this.on = want;
    window.clearInterval(this.timer);
    if (!want) return;
    this.nextTime = this.s.ctx!.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 50);
  }

  private schedule(): void {
    const ctx = this.s.ctx;
    if (!ctx || this.station < 0) return;
    const st = STATIONS[this.station];
    const beat = 60 / st.bpm;
    // After a stall (a hidden tab throttles timers), skip the missed notes, don't burst them.
    if (this.nextTime < ctx.currentTime) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + 0.2) {
      const e = this.eighth;
      const offBeat = e % 2 === 1;
      const t = this.nextTime + (offBeat ? st.swing * beat * 0.5 : 0);
      this.playEighth(st, e, t, beat);
      this.nextTime += beat / 2;
      this.eighth++;
    }
  }

  /** Everything that happens on one eighth note. */
  private playEighth(st: Station, e: number, t: number, beat: number): void {
    const beatInBar = (e % 8) / 2; // 0, 0.5, 1 … 3.5
    const bar = Math.floor(e / 8);
    const degree = st.progression[bar % st.progression.length];
    const chordSteps = [degree, degree + 2, degree + 4, ...(st.chord.sevenths ? [degree + 6] : [])];
    const note = (step: number, octave: number) =>
      st.key + octave * 12 + st.scale[((step % 7) + 7) % 7] + 12 * Math.floor(step / 7);
    // Drums.
    if (st.drums.kick.includes(beatInBar)) this.kick(t);
    if (st.drums.snare.includes(beatInBar)) this.snare(t);
    if ((beatInBar / st.drums.hat) % 1 === 0) this.hat(t, beatInBar % 1 === 0 ? 0.5 : 0.3);
    // Bass: chord root on beats 1 and 3, the fifth on the "and" of 4 sometimes.
    if (beatInBar === 0 || beatInBar === 2) this.tone('triangle', note(degree, 1), t, beat * 0.9, 0.28, 0.6);
    else if (beatInBar === 3.5 && Math.random() < 0.5) this.tone('triangle', note(degree + 4, 1), t, beat * 0.4, 0.2, 0.3);
    // Chords.
    if ((beatInBar / st.chord.every) % 1 === 0) {
      for (const step of chordSteps) this.tone(st.chord.type, note(step, 2), t, beat * st.chord.length, 0.045, beat * st.chord.length, 1600);
    }
    // Lead: a random walk on the scale, pulled to chord notes on the beat.
    if (Math.random() < st.lead.density) {
      const r = Math.random();
      this.leadNote += r < 0.35 ? 1 : r < 0.7 ? -1 : r < 0.85 ? 2 : -2;
      this.leadNote = Math.max(-3, Math.min(9, this.leadNote));
      if (beatInBar % 1 === 0 && !chordSteps.some((c) => (c - this.leadNote) % 7 === 0)) {
        // Snap to the nearest chord tone.
        let best = this.leadNote;
        for (let d = 1; d <= 3; d++) {
          if (chordSteps.some((c) => (((c - (this.leadNote + d)) % 7) + 7) % 7 === 0)) { best = this.leadNote + d; break; }
          if (chordSteps.some((c) => (((c - (this.leadNote - d)) % 7) + 7) % 7 === 0)) { best = this.leadNote - d; break; }
        }
        this.leadNote = best;
      }
      this.tone(st.lead.type, note(this.leadNote, st.lead.octave), t, beat * 0.5, 0.07, st.lead.decay, 3000);
    }
  }

  private get out(): AudioNode {
    return this.s.music;
  }

  /** One note: oscillator → low-pass → decaying gain. */
  private tone(type: OscillatorType, n: number, t: number, length: number, peak: number, decay: number, cutoff = 900): void {
    const ctx = this.s.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = 55 * 2 ** (n / 12);
    const lp = this.s.filter('lowpass', cutoff);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.05, Math.min(length, decay)));
    o.connect(lp).connect(g).connect(this.out);
    o.start(t);
    o.stop(t + length + 0.05);
    o.onended = () => {
      o.disconnect();
      lp.disconnect();
      g.disconnect();
    };
    this.booked++;
  }

  private kick(t: number): void {
    const ctx = this.s.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.3);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }

  private snare(t: number): void {
    this.noiseHit(t, 'bandpass', 1800, 0.25, 0.14);
  }

  private hat(t: number, level: number): void {
    this.noiseHit(t, 'highpass', 7000, 0.08 * level, 0.04);
  }

  private noiseHit(t: number, type: BiquadFilterType, f: number, peak: number, decay: number): void {
    const n = this.s.noise();
    const fl = this.s.filter(type, f);
    const g = this.s.ctx!.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    n.connect(fl).connect(g).connect(this.out);
    n.start(t);
    n.stop(t + decay + 0.02);
    n.onended = () => {
      n.disconnect();
      fl.disconnect();
      g.disconnect();
    };
  }
}
