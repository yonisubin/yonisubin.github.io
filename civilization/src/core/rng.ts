// Seeded PRNG (mulberry32). The state is a single 32-bit integer stored in GameState, so the
// game is deterministic and saves resume the same random sequence.

export interface RngHolder {
  rng: number;
}

/** Next float in [0, 1); advances holder.rng. */
export function rand(h: RngHolder): number {
  let t = (h.rng = (h.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Integer in [0, n). */
export function randInt(h: RngHolder, n: number): number {
  return Math.floor(rand(h) * n);
}

export function pick<T>(h: RngHolder, list: readonly T[]): T {
  return list[randInt(h, list.length)];
}

/** Pick by weight; weights must not all be zero. */
export function pickWeighted<T>(h: RngHolder, list: readonly T[], weight: (t: T) => number): T {
  let total = 0;
  for (const x of list) total += Math.max(0, weight(x));
  let r = rand(h) * total;
  for (const x of list) {
    r -= Math.max(0, weight(x));
    if (r < 0) return x;
  }
  return list[list.length - 1];
}

export function shuffle<T>(h: RngHolder, list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = randInt(h, i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** Hash a string seed (or number) to a 32-bit integer. */
export function hashSeed(seed: string | number): number {
  const s = String(seed);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}
