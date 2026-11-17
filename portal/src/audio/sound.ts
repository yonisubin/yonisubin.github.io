// Small synthesised sound set (Web Audio, no files): portal open per colour, fizzle, passing
// through, footsteps and landing. Original sounds made from oscillators and filtered noise.

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;

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
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let x = 1;
    for (let i = 0; i < len; i++) {
      x = (x * 16807) % 2147483647;
      d[i] = (x / 2147483647) * 2 - 1;
    }
  }

  private ready(): AudioContext | null {
    return this.muted || !this.ctx || this.ctx.state !== 'running' ? null : this.ctx;
  }

  private tone(freq0: number, freq1: number, dur: number, type: OscillatorType, vol: number): void {
    const ctx = this.ready();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq0, t);
    o.frequency.exponentialRampToValueAtTime(freq1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(dur: number, freq: number, q: number, vol: number): void {
    const ctx = this.ready();
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

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

  footstep(): void {
    this.burst(0.06, 900, 3, 0.12);
  }

  land(speed: number): void {
    this.burst(0.15, 220, 1.5, Math.min(0.5, 0.08 + speed * 0.02));
  }
}
