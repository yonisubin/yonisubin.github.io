// Hex grid maths. The map is stored in "odd-r" offset coordinates (rows of pointy-top hexes,
// odd rows shifted half a hex right) as a flat array: index = row * width + col. Columns wrap
// east–west (the world is a cylinder); rows don't (the poles are edges).
//
// Directions (also the bit order of river edges): 0 E, 1 NE, 2 NW, 3 W, 4 SW, 5 SE. Row 0 is
// north (top of the screen), so "N" means row − 1.

export interface MapDims {
  w: number;
  h: number;
}

// Axial (q, r) neighbour offsets for directions 0..5.
const AXIAL_DIRS: readonly [number, number][] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

export const colOf = (m: MapDims, i: number) => i % m.w;
export const rowOf = (m: MapDims, i: number) => Math.floor(i / m.w);

/** Offset → axial q. */
export function axialQ(col: number, row: number): number {
  return col - (row - (row & 1)) / 2;
}

/** Index of (col, row), wrapping col; -1 if the row is off the map. */
export function idx(m: MapDims, col: number, row: number): number {
  if (row < 0 || row >= m.h) return -1;
  const c = ((col % m.w) + m.w) % m.w;
  return row * m.w + c;
}

/** Neighbour of tile i in direction d (0..5), or -1 past a pole. */
export function neighbor(m: MapDims, i: number, d: number): number {
  const col = i % m.w;
  const row = (i - col) / m.w;
  const [dq, dr] = AXIAL_DIRS[((d % 6) + 6) % 6];
  const nr = row + dr;
  if (nr < 0 || nr >= m.h) return -1;
  const q = axialQ(col, row) + dq;
  const nc = q + (nr - (nr & 1)) / 2;
  return idx(m, nc, nr);
}

export function neighbors(m: MapDims, i: number): number[] {
  const out: number[] = [];
  for (let d = 0; d < 6; d++) {
    const n = neighbor(m, i, d);
    if (n >= 0) out.push(n);
  }
  return out;
}

/** Direction from a to its neighbour b, or -1 if not adjacent. */
export function dirTo(m: MapDims, a: number, b: number): number {
  for (let d = 0; d < 6; d++) if (neighbor(m, a, d) === b) return d;
  return -1;
}

/** Hex distance, taking the east–west wrap into account. */
export function distance(m: MapDims, a: number, b: number): number {
  const ac = a % m.w, ar = (a - ac) / m.w;
  const bc = b % m.w, br = (b - bc) / m.w;
  let best = Infinity;
  for (const shift of [-m.w, 0, m.w]) {
    const q1 = axialQ(ac, ar), q2 = axialQ(bc + shift, br);
    const dq = q1 - q2, dr = ar - br;
    const d = (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
    if (d < best) best = d;
  }
  return best;
}

/** All tiles within `radius` of i (including i), nearest first. */
export function within(m: MapDims, i: number, radius: number): number[] {
  const seen = new Set<number>([i]);
  const out = [i];
  let frontier = [i];
  for (let r = 0; r < radius; r++) {
    const next: number[] = [];
    for (const t of frontier)
      for (const n of neighbors(m, t))
        if (!seen.has(n)) {
          seen.add(n);
          out.push(n);
          next.push(n);
        }
    frontier = next;
  }
  return out;
}

/** Tiles at exactly distance `radius`. */
export function ring(m: MapDims, i: number, radius: number): number[] {
  return within(m, i, radius).filter((t) => distance(m, i, t) === radius);
}

/** Pixel centre of a tile for hexes of circumradius `size` (pointy-top). Not wrapped. */
export function tileCenter(m: MapDims, i: number, size: number): { x: number; y: number } {
  const col = i % m.w;
  const row = (i - col) / m.w;
  return { x: size * Math.sqrt(3) * (col + 0.5 * (row & 1)) + (size * Math.sqrt(3)) / 2, y: size * 1.5 * row + size };
}

/** Screen angle (radians, y down) of the corner between edge d and edge d+1. */
export function cornerAngle(d: number): number {
  return ((-30 - 60 * d) * Math.PI) / 180;
}
