// All of Hexborne's sound is synthesised with Web Audio (no audio files): short effects for
// actions and events, and quiet generative music whose scale and tempo follow the player's era.
// Settings live in localStorage: `civ:mute` (effects off) and `civ:music` ("1" = music on).

export type Sfx = 'click' | 'step' | 'melee' | 'shot' | 'found' | 'build' | 'turn' | 'tech' | 'good' | 'bad' | 'victory' | 'defeat';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let musicBus: GainNode | null = null;

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage may be unavailable */
  }
};

export const sfxOn = () => read('civ:mute') !== '1';
export const musicOn = () => read('civ:music') === '1';

export function setSfx(on: boolean): void {
  write('civ:mute', on ? '0' : '1');
}

export function setMusic(on: boolean, era = 0): void {
  write('civ:music', on ? '1' : '0');
  if (on) startMusic(era);
  else stopMusic();
}

/** The audio context, created on first use (browsers allow it only after a click or key). */
function audio(): AudioContext | null {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
  } catch {
    return null;
  }
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  musicBus = ctx.createGain();
  musicBus.gain.value = 0.18;
  musicBus.connect(master);
  return ctx;
}

/** One enveloped oscillator note. */
function tone(freq: number, at: number, dur: number, type: OscillatorType = 'sine', vol = 0.3, bus: AudioNode | null = master, glide?: number): void {
  const c = ctx!;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (glide) o.frequency.exponentialRampToValueAtTime(glide, at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + Math.min(0.02, dur / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(bus!);
  o.start(at);
  o.stop(at + dur + 0.05);
}

/** A burst of filtered noise (impacts, footsteps, shots). */
function noise(at: number, dur: number, freq: number, vol = 0.3, q = 1): void {
  const c = ctx!;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(master!);
  src.start(at);
}

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export function play(name: Sfx): void {
  if (!sfxOn()) return;
  const c = audio();
  if (!c) return;
  const t = c.currentTime + 0.01;
  switch (name) {
    case 'click':
      tone(880, t, 0.05, 'triangle', 0.12);
      break;
    case 'step':
      noise(t, 0.06, 500, 0.25, 2);
      noise(t + 0.11, 0.06, 420, 0.2, 2);
      break;
    case 'melee':
      noise(t, 0.12, 2400, 0.4, 3);
      tone(180, t, 0.18, 'sawtooth', 0.15, master, 90);
      noise(t + 0.14, 0.1, 1800, 0.3, 3);
      break;
    case 'shot':
      tone(1200, t, 0.18, 'triangle', 0.12, master, 300);
      noise(t + 0.16, 0.08, 900, 0.3, 1);
      break;
    case 'found':
      [60, 64, 67, 72].forEach((n, i) => tone(midi(n), t + i * 0.09, 0.5, 'triangle', 0.18));
      break;
    case 'build':
      noise(t, 0.05, 1500, 0.3, 4);
      noise(t + 0.15, 0.05, 1500, 0.3, 4);
      break;
    case 'turn':
      tone(midi(67), t, 0.25, 'sine', 0.15);
      tone(midi(74), t + 0.12, 0.35, 'sine', 0.12);
      break;
    case 'tech':
      [67, 71, 74, 79].forEach((n, i) => tone(midi(n), t + i * 0.07, 0.6, 'sine', 0.14));
      break;
    case 'good':
      tone(midi(76), t, 0.2, 'sine', 0.14);
      tone(midi(81), t + 0.1, 0.3, 'sine', 0.12);
      break;
    case 'bad':
      tone(midi(57), t, 0.3, 'square', 0.08);
      tone(midi(53), t + 0.18, 0.4, 'square', 0.08);
      break;
    case 'victory':
      [60, 64, 67, 72, 76, 79, 84].forEach((n, i) => tone(midi(n), t + i * 0.12, 0.9, 'triangle', 0.16));
      break;
    case 'defeat':
      [62, 60, 57, 53].forEach((n, i) => tone(midi(n), t + i * 0.3, 0.9, 'sine', 0.14));
      break;
  }
}

// ---- Music ----
// A slow pad chord plus a sparse melody from the era's scale, scheduled a bar ahead.

const SCALES = [
  [0, 2, 3, 7, 9], // ancient: a minor-ish pentatonic
  [0, 2, 4, 7, 9],
  [0, 2, 3, 5, 7, 8, 10], // medieval: aeolian
  [0, 2, 4, 5, 7, 9, 11], // renaissance: major
  [0, 2, 4, 5, 7, 9, 10], // industrial: mixolydian
  [0, 2, 3, 5, 7, 9, 10], // modern: dorian
  [0, 2, 4, 6, 7, 9, 11], // atomic: lydian
  [0, 3, 5, 7, 10], // information
];
const CHORDS = [
  [0, 4, 7],
  [5, 9, 12],
  [7, 11, 14],
  [-3, 0, 4],
];

let timer: number | null = null;
let era = 0;
let bar = 0;

export function setMusicEra(e: number): void {
  era = Math.max(0, Math.min(7, e));
}

export function startMusic(e = era): void {
  era = e;
  if (timer !== null || !audio()) return;
  bar = 0;
  const step = () => {
    const c = ctx!;
    const beat = 60 / (54 + era * 6);
    const t = c.currentTime + 0.1;
    const root = 48 + [0, 2, 5, 3, 7, 0, 4, 2][era];
    const chord = CHORDS[bar % CHORDS.length];
    for (const n of chord) tone(midi(root + n), t, beat * 4, 'sine', 0.12, musicBus);
    tone(midi(root - 12 + chord[0]), t, beat * 4, 'triangle', 0.1, musicBus);
    const scale = SCALES[era];
    for (let b = 0; b < 4; b++) {
      // A deterministic but wandering melody: one note on most beats.
      const k = (bar * 7 + b * 3 + era) % 11;
      if (k > 7) continue;
      const deg = scale[(bar * 2 + b * (k + 1)) % scale.length];
      tone(midi(root + 12 + deg), t + b * beat, beat * 1.4, 'triangle', 0.08, musicBus);
    }
    bar++;
    timer = window.setTimeout(step, beat * 4 * 1000);
  };
  step();
}

export function stopMusic(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}
