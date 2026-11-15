import {
  CELLS,
  COAST_LINE,
  PITCH,
  ROAD_WIDTH,
  cellCenter,
  cellOf,
  isTown,
  lakeRadius,
  lineCoord,
  type CityLayout,
  type Zone,
} from './layout';

// The shape of the land: one deterministic height function for the whole world, plus the
// ground colour at any point. No three.js here — chunks, the far terrain, the water shader's
// depth map and the maps all sample these functions.
//
// Height is built in layers (all in metres):
//   smooth  — big rolling hills (hundreds of metres across). Zero in towns and by the coast,
//             tall in the northern forest, gentle on farmland, a rim of high hills at the
//             world's edge. Roads follow this layer, so they climb gently over the hills.
//   detail  — smaller bumps, faded out near roads and towns so those stay smooth.
//   lake    — a bowl carved below the water level in the northern hills.
//   beach   — south of the coastal road: sand sloping into the sea.

/** The sea and the lake share one water level. */
export const WATER_Y = -0.5;
/** Southern edge of the coastal road; the beach starts here. */
export const COAST_Z = lineCoord(COAST_LINE) + ROAD_WIDTH / 2;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Integer hash → [0, 1). */
function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1]: random values at integer points, eased in between. */
function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uz);
}

/** Fractal noise: `octaves` layers, each twice the frequency and half the strength. ≈ [0, 1]. */
function fbm(x: number, z: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x, z, seed + o * 17) * amp;
    norm += amp;
    x *= 2.03;
    z *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}

export type Rgb = [number, number, number];

export class Terrain {
  /** Distance (in cells, Chebyshev) from every cell to the nearest town cell. */
  private readonly townCells: Uint8Array;
  private readonly seed: number;

  constructor(private readonly layout: CityLayout) {
    this.seed = layout.seed;
    // Multi-source breadth-first search from all town cells.
    const n = CELLS;
    const dist = new Uint8Array(n * n).fill(255);
    const queue: number[] = [];
    layout.zones.forEach((z, i) => {
      if (isTown(z)) {
        dist[i] = 0;
        queue.push(i);
      }
    });
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      const bx = i % n;
      const bz = (i - bx) / n;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = bx + dx;
          const z = bz + dz;
          if (x < 0 || z < 0 || x >= n || z >= n) continue;
          const j = z * n + x;
          if (dist[j] > dist[i] + 1) {
            dist[j] = dist[i] + 1;
            queue.push(j);
          }
        }
      }
    }
    this.townCells = dist;
  }

  zoneAt(x: number, z: number): Zone {
    const bx = Math.min(CELLS - 1, Math.max(0, cellOf(x)));
    const bz = Math.min(CELLS - 1, Math.max(0, cellOf(z)));
    return this.layout.zones[bz * CELLS + bx];
  }

  /** Metres from (x, z) to the nearest town cell (0 inside one; large if none nearby). */
  townDistance(x: number, z: number): number {
    const bx = cellOf(x);
    const bz = cellOf(z);
    const cbx = Math.min(CELLS - 1, Math.max(0, bx));
    const cbz = Math.min(CELLS - 1, Math.max(0, bz));
    const cells = this.townCells[cbz * CELLS + cbx];
    if (cells > 5) return 1000;
    let best = 1000;
    const r = Math.min(5, cells + 1);
    for (let z0 = bz - r; z0 <= bz + r; z0++) {
      for (let x0 = bx - r; x0 <= bx + r; x0++) {
        if (x0 < 0 || z0 < 0 || x0 >= CELLS || z0 >= CELLS) continue;
        if (!isTown(this.layout.zones[z0 * CELLS + x0])) continue;
        const dx = Math.max(0, Math.abs(x - cellCenter(x0)) - PITCH / 2);
        const dz = Math.max(0, Math.abs(z - cellCenter(z0)) - PITCH / 2);
        best = Math.min(best, Math.hypot(dx, dz));
      }
    }
    return best;
  }

  /** Metres from (x, z) to the centre line of the nearest road (capped at ~200). */
  roadDistance(x: number, z: number): number {
    const roads = this.layout.roads;
    const ix = cellOf(x);
    const iz = cellOf(z);
    let best = 200;
    // Horizontal segments on the lines just north and south (and one more each way).
    for (let k = iz - 1; k <= iz + 2; k++) {
      const lz = lineCoord(k);
      const dz = Math.abs(z - lz);
      if (dz >= best) continue;
      for (let i = ix - 1; i <= ix + 1; i++) {
        if (!roads.hasH(i, k)) continue;
        const x0 = lineCoord(i);
        const dx = x < x0 ? x0 - x : x > x0 + PITCH ? x - x0 - PITCH : 0;
        best = Math.min(best, Math.hypot(dx, dz));
      }
    }
    for (let i = ix - 1; i <= ix + 2; i++) {
      const lx = lineCoord(i);
      const dx = Math.abs(x - lx);
      if (dx >= best) continue;
      for (let k = iz - 1; k <= iz + 1; k++) {
        if (!roads.hasV(i, k)) continue;
        const z0 = lineCoord(k);
        const dz = z < z0 ? z0 - z : z > z0 + PITCH ? z - z0 - PITCH : 0;
        best = Math.min(best, Math.hypot(dx, dz));
      }
    }
    return best;
  }

  /** 0 in the south … 1 in the northern forest hills. */
  private forestWeight(x: number, z: number): number {
    return smoothstep(-450, -950, z + 120 * Math.sin(x / 500));
  }

  /** The big, smooth hills. Roads sit on this layer. */
  smoothHeight(x: number, z: number): number {
    const forest = this.forestWeight(x, z);
    let a = (6 + 45 * forest) * Math.max(0, fbm(x / 750, z / 750, 3, this.seed + 1) * 1.6 - 0.3);
    // A rim of high hills around the world's edge (not on the sea side).
    const edge = Math.max(Math.abs(x), -z);
    a += smoothstep(1900, 2250, edge) * 70 * (0.6 + 0.4 * fbm(x / 300, z / 300, 2, this.seed + 3));
    a *= smoothstep(40, 300, this.townDistance(x, z)); // towns are flat
    a *= 1 - smoothstep(1250, 1480, z); // so is the coast
    a *= smoothstep(1.0, 2.6, lakeRadius(x, z)); // and the lake shore
    return a;
  }

  /** Height of the ground at (x, z), in metres. */
  heightAt(x: number, z: number): number {
    let h = this.smoothHeight(x, z);

    // Smaller bumps, smoothed away near roads and towns.
    const forest = this.forestWeight(x, z);
    const detailMask =
      smoothstep(9, 32, this.roadDistance(x, z)) * smoothstep(15, 60, this.townDistance(x, z)) * (1 - smoothstep(1300, 1450, z));
    if (detailMask > 0) h += (fbm(x / 110, z / 110, 3, this.seed + 2) - 0.5) * 2 * (1.2 + 6 * forest) * detailMask;

    // The lake: a bowl below the water level.
    const lr = lakeRadius(x, z);
    if (lr < 1.3) {
      const bed = WATER_Y - 0.8 - 6 * Math.max(0, 1 - lr);
      h = lerp(h, bed, smoothstep(1.3, 0.85, lr));
    }

    // Away from the lake and the sea, dips never reach the water level (no stray ponds:
    // the water surface covers the whole map and would show through).
    if (lr > 1.3 && z < COAST_Z) h = Math.max(h, WATER_Y + 0.35);

    // The beach: sand from the coastal road down into the sea. The waterline wanders.
    const d = z - COAST_Z;
    if (d > 0) {
      const shore = 70 + 25 * Math.sin(x / 260) + 10 * Math.sin(x / 93 + 2);
      const sand = d < shore ? 0.25 - (0.25 - WATER_Y) * (d / shore) : WATER_Y - 0.045 * (d - shore);
      h = Math.max(sand, -16);
    }
    return h;
  }

  /** True if (x, z) is at least `margin` m from roads and towns and above the water. */
  isClear(x: number, z: number, margin: number): boolean {
    return (
      this.roadDistance(x, z) > margin &&
      this.townDistance(x, z) > margin * 0.5 &&
      this.heightAt(x, z) > WATER_Y + 0.4 &&
      z < COAST_Z - 5
    );
  }

  /**
   * Ground colour (linear RGB) at a point with height `h`; `slope` is 1 − normal.y
   * (0 = flat, larger = steeper).
   */
  colorAt(x: number, z: number, h: number, slope: number): Rgb {
    // Under water: sand fading to dark mud with depth.
    if (h < WATER_Y - 0.05) {
      const t = Math.min(1, (WATER_Y - h) / 2.5);
      return [lerp(0.3, 0.06, t), lerp(0.26, 0.09, t), lerp(0.17, 0.08, t)];
    }
    const lr = lakeRadius(x, z);
    if (z > COAST_Z - 1 || (lr < 1.35 && h < WATER_Y + 0.8)) {
      // Sand: darker where it's wet near the water.
      const wet = 1 - smoothstep(WATER_Y + 0.05, WATER_Y + 0.5, h);
      const n = 0.92 + 0.16 * valueNoise(x / 3, z / 3, 7);
      return [lerp(0.46, 0.3, wet) * n, lerp(0.37, 0.24, wet) * n, lerp(0.22, 0.14, wet) * n];
    }

    const forest = this.forestWeight(x, z);
    const n1 = fbm(x / 60, z / 60, 2, this.seed + 9);
    // Meadow grass, varying between lush and dry.
    let r = lerp(0.1, 0.22, n1);
    let g = lerp(0.2, 0.22, n1);
    let b = lerp(0.05, 0.08, n1);
    // Forest floor: darker, mossy.
    r = lerp(r, 0.06, forest * 0.8);
    g = lerp(g, 0.12, forest * 0.8);
    b = lerp(b, 0.04, forest * 0.8);

    // Farmland: a patchwork of fields (wheat, young crops, ploughed earth, pasture).
    if (this.zoneAt(x, z) === 'farm' && this.roadDistance(x, z) > ROAD_WIDTH / 2 + 2) {
      const fx = Math.floor((x + 1000) / 58);
      const fz = Math.floor((z + 1000) / 42);
      const pick = hash2(fx, fz, this.seed + 11);
      const crops: Rgb[] = [
        [0.45, 0.35, 0.1],
        [0.14, 0.27, 0.05],
        [0.2, 0.12, 0.06],
        [0.3, 0.32, 0.12],
        [0.12, 0.22, 0.06],
      ];
      const c = crops[Math.floor(pick * crops.length)];
      // Crop rows: faint stripes.
      const rows = 0.9 + 0.1 * Math.sin((pick > 0.5 ? x : z) * 2.2);
      const field = (1 - forest) * smoothstep(40, 80, this.townDistance(x, z));
      r = lerp(r, c[0] * rows, field);
      g = lerp(g, c[1] * rows, field);
      b = lerp(b, c[2] * rows, field);
    }

    // Steep slopes show rock.
    const rock = smoothstep(0.25, 0.5, slope);
    return [lerp(r, 0.24, rock), lerp(g, 0.23, rock), lerp(b, 0.21, rock)];
  }
}
