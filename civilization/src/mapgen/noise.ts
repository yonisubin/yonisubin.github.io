// Hand-written 3D value noise + fractal sum. The map wraps east–west, so 2D map positions are
// sampled on a cylinder (column → angle), which makes the noise seamless at the seam.

function hash3(seed: number, x: number, y: number, z: number): number {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Value noise in [0, 1). */
export function noise3(seed: number, x: number, y: number, z: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const fx = smooth(x - x0), fy = smooth(y - y0), fz = smooth(z - z0);
  const c = (dx: number, dy: number, dz: number) => hash3(seed, x0 + dx, y0 + dy, z0 + dz);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), fx);
  const x10 = lerp(c(0, 1, 0), c(1, 1, 0), fx);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), fx);
  const x11 = lerp(c(0, 1, 1), c(1, 1, 1), fx);
  return lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz);
}

/** Fractal (fBm) noise in roughly [0, 1). */
export function fbm(seed: number, x: number, y: number, z: number, octaves = 4): number {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += noise3(seed + o * 1013, x * f, y * f, z * f) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

/**
 * Seamless map noise: tile (col, row) on a map `w` wide, with `scale` ≈ features per map width.
 * The column becomes an angle around a cylinder whose circumference matches the map width.
 */
export function mapNoise(seed: number, w: number, col: number, row: number, scale: number, octaves = 4): number {
  const a = (col / w) * Math.PI * 2;
  const r = scale / (Math.PI * 2);
  return fbm(seed, Math.cos(a) * r + 100, (row / w) * scale + 100, Math.sin(a) * r + 100, octaves);
}
