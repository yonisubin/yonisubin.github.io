// The overseer's synthesised voice (Web Audio, not browser TTS). Text is cut into syllables; each
// syllable is a buzzy glottal tone at a pitch snapped to a musical scale (pitch quantisation, the
// voice's sung-robot quality) shaped by two band-pass "formant" filters chosen by its vowel, with a
// short noise burst for a leading consonant. Commas and full stops become pauses, the pitch drifts
// down through a sentence and rises at a question. It babbles in time with the subtitle rather than
// saying the words, which is the point: an institutional machine imitating speech.
import { SHELL } from '../core/shellConfig';
import type { Sound } from '../audio/sound';

export interface Syllable {
  /** Seconds from the start of the line. */
  start: number;
  dur: number;
  pitch: number;
  /** Formant centre frequencies (Hz). */
  f1: number;
  f2: number;
  consonant: boolean;
}

export interface Utterance {
  syllables: Syllable[];
  duration: number;
}

const FORMANTS: Record<string, [number, number]> = {
  a: [780, 1240],
  e: [520, 1880],
  i: [310, 2280],
  o: [520, 900],
  u: [350, 780],
  y: [320, 2050],
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/** Plan the syllables of a line (pure: no audio). Its duration is how long the subtitle shows. */
export function planUtterance(text: string, pitchShift = 0): Utterance {
  const D = SHELL.dialogue;
  const syllables: Syllable[] = [];
  let t = 0;
  // Sentences keep their own pitch contour.
  const sentences = text.match(/[^.!?]+[.!?]*/g) ?? [text];
  for (const sentence of sentences) {
    const question = sentence.trim().endsWith('?');
    const exclaim = sentence.trim().endsWith('!');
    const tokens = sentence.match(/[A-Za-z0-9']+|[,;:—–-]/g) ?? [];
    const words = tokens.filter((w) => /\w/.test(w));
    let wi = 0;
    for (const tok of tokens) {
      if (!/\w/.test(tok)) {
        t += D.commaPause;
        continue;
      }
      const groups = tok.toLowerCase().match(/[^aeiouy]*[aeiouy]+|[^aeiouy]+$/g) ?? [tok.toLowerCase()];
      const vowelGroups = groups.filter((g) => /[aeiouy]/.test(g));
      const parts = vowelGroups.length ? vowelGroups : [tok.toLowerCase() + 'u'];
      // Digits read as one syllable each.
      const progress = words.length > 1 ? wi / (words.length - 1) : 0;
      parts.forEach((g, si) => {
        const h = hash(tok + si);
        const vowel = g.match(/[aeiouy]/)?.[0] ?? 'u';
        const [f1, f2] = FORMANTS[vowel];
        // Contour: start a little high, drift down by ~3 scale steps; questions rise at the end.
        let step = 3 + (h % 3) - Math.round(progress * 3);
        if (question && wi === words.length - 1) step += 3 + si;
        if (exclaim) step += 1;
        const scale = SHELL.dialogue.scale;
        const idx = Math.max(0, Math.min(scale.length - 1, step));
        const pitch = D.basePitch * Math.pow(2, (scale[idx] + pitchShift) / 12);
        const dur = D.syllableSeconds * (0.75 + ((h >> 8) % 100) / 200) * (g.length > 3 ? 1.2 : 1);
        syllables.push({ start: t, dur, pitch, f1, f2, consonant: /^[^aeiouy]/.test(g) });
        t += dur;
      });
      t += 0.03; // a breath between words
      wi++;
    }
    t += D.sentencePause;
  }
  return { syllables, duration: Math.max(0.4, t - D.sentencePause) };
}

export class Voice {
  private live: AudioScheduledSourceNode[] = [];
  /** Syllables actually sent to the audio graph (tests). */
  readonly stats = { syllables: 0, lines: 0 };

  constructor(private readonly sound: Sound | null) {}

  speak(u: Utterance): void {
    this.stats.lines++;
    const s = this.sound;
    const ctx = s?.ctx;
    const out = s?.out('voice');
    if (!s || !ctx || !out || ctx.state !== 'running' || s.muted) return;
    this.live = []; // the previous line has finished (or was stopped) by now
    const t0 = ctx.currentTime + 0.03;
    for (const syl of u.syllables) {
      const t = t0 + syl.start;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(syl.pitch * 1.02, t);
      o.frequency.exponentialRampToValueAtTime(syl.pitch, t + syl.dur * 0.3);
      // Two parallel formant filters (vowel colour).
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(0.22, t + 0.015);
      env.gain.setValueAtTime(0.22, t + syl.dur * 0.7);
      env.gain.linearRampToValueAtTime(0.0001, t + syl.dur);
      for (const [f, q, g] of [
        [syl.f1, 6, 1],
        [syl.f2, 9, 0.6],
      ] as const) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = f;
        bp.Q.value = q;
        const fg = ctx.createGain();
        fg.gain.value = g;
        o.connect(bp).connect(fg).connect(env);
      }
      env.connect(out);
      o.start(t);
      o.stop(t + syl.dur + 0.02);
      this.live.push(o);
      if (syl.consonant && s.noise) {
        const n = ctx.createBufferSource();
        n.buffer = s.noise;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 2800;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.08, t);
        ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
        n.connect(hp).connect(ng).connect(out);
        n.start(t, Math.random() * 0.5);
        n.stop(t + 0.05);
        this.live.push(n);
      }
      this.stats.syllables++;
    }
  }

  stop(): void {
    const ctx = this.sound?.ctx;
    for (const n of this.live) {
      try {
        n.stop(ctx ? ctx.currentTime + 0.01 : 0);
      } catch {
        /* already stopped */
      }
    }
    this.live = [];
  }
}
