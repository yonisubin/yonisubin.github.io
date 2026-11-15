import {
  BLOCK_SIZE,
  CELLS,
  COAST_LINE,
  CURB_HEIGHT,
  PITCH,
  ROAD_WIDTH,
  cellCenter,
  cellOf,
  isTown,
  lakeRadius,
  lineCoord,
  type Block,
  type CityLayout,
  type Zone,
} from './layout';
import { fbm, hash2, lerp, smoothstep, valueNoise } from './noise';

// The shape of the land: one deterministic height function for the whole world, plus the
// ground colour at any point. No three.js here — chunks, the far terrain, the water shader's
// depth map and the maps all sample these functions.
//
// Height is built in layers (all in metres):
//   smooth  — big rolling hills (hundreds of metres across): town hills (3–37 m, gentler
//             downtown) blending into countryside hills (rolling farmland, tall in the
//             northern forest, a rim of high hills at the world's edge); flat by the coast
//             and the lake. Roads follow this layer, so streets climb and dip with the hills.
//             Town blocks are draped over it too.
//
// The layout is a grid bent by the road warp (warp.ts): questions about zones, roads, towns
// and blocks convert a world point back to the grid first (toGrid).
//   detail  — smaller bumps, faded out near roads and towns so those stay smooth.
//   lake    — a bowl carved below the water level in the northern hills.
//   beach   — south of the coastal road: sand sloping into the sea.

/** The sea and the lake share one water level. */
export const WATER_Y = -0.5;
/** Southern edge of the coastal road; the beach starts here. */
export const COAST_Z = lineCoord(COAST_LINE) + ROAD_WIDTH / 2;

export type Rgb = [number, number, number];

/** A block's slab plane: height at the centre and slope (m per m) along X and Z. */
export interface BlockPlane {
  h: number;
  gx: number;
  gz: number;
}

/** Height range (m) of the town hills, in the suburbs and villages and downtown. */
const TOWN_HILLS = 34;
const TOWN_HILLS_DOWNTOWN = 22;

export class Terrain {
  /** Distance (in cells, Chebyshev) from every cell to the nearest town cell. */
  private readonly townCells: Uint8Array;
  private readonly seed: number;

  constructor(private readonly layout: CityLayout) {
    this.seed = layout.seed;
    this.townCells = layout.townCells;
  }

  /**
   * World → grid. The layout lives on a perfect grid and the warp (warp.ts) bends it; every
   * question about zones, roads, towns and blocks is answered on the grid. Returns a copy.
   */
  private toGrid(x: number, z: number): { x: number; z: number } {
    const g = this.layout.warp.inverse(x, z);
    return { x: g.x, z: g.z };
  }

  /** A layout (grid) point in the world, through the road warp. A fresh object. */
  toWorld(gx: number, gz: number): { x: number; z: number } {
    const w = this.layout.warp.forward(gx, gz);
    return { x: w.x, z: w.z };
  }

  /** How much the road warp turns things at a grid point (rad, add to a grid yaw). */
  warpAngle(gx: number, gz: number): number {
    return this.layout.warp.angle(gx, gz);
  }

  /** Zone at a world point. */
  zoneAt(x: number, z: number): Zone {
    const g = this.toGrid(x, z);
    return this.zoneAtGrid(g.x, g.z);
  }

  private zoneAtGrid(x: number, z: number): Zone {
    const bx = Math.min(CELLS - 1, Math.max(0, cellOf(x)));
    const bz = Math.min(CELLS - 1, Math.max(0, cellOf(z)));
    return this.layout.zones[bz * CELLS + bx];
  }

  /** Metres from a world point to the nearest town cell (0 inside one; large if none nearby). */
  townDistance(x: number, z: number): number {
    const g = this.toGrid(x, z);
    return this.townDistanceGrid(g.x, g.z);
  }

  /** Metres from a world point to the centre line of the nearest road (capped at ~200). */
  roadDistance(x: number, z: number): number {
    const g = this.toGrid(x, z);
    return this.roadDistanceGrid(g.x, g.z);
  }

  private townDistanceGrid(x: number, z: number): number {
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

  private roadDistanceGrid(x: number, z: number): number {
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

  /** The big, smooth hills at a world point. Roads and town blocks sit on this layer. */
  smoothHeight(x: number, z: number): number {
    const g = this.toGrid(x, z);
    return this.smoothCore(x, z, this.townDistanceGrid(g.x, g.z));
  }

  /**
   * Road level at a world point whose grid point is already known (traffic knows both),
   * which skips the warp inversion smoothHeight() has to do.
   */
  roadHeight(wx: number, wz: number, gx: number, gz: number): number {
    return this.smoothCore(wx, wz, this.townDistanceGrid(gx, gz));
  }

  /** The smooth layer, given the distance to town (the hills are defined in world space). */
  private smoothCore(x: number, z: number, townDist: number): number {
    // Countryside: rolling farmland, tall hills in the northern forest, a rim at the edge.
    const forest = this.forestWeight(x, z);
    let rural = (14 + 37 * forest) * Math.max(0, fbm(x / 750, z / 750, 3, this.seed + 1) * 1.6 - 0.3);
    const edge = Math.max(Math.abs(x), -z);
    rural += smoothstep(1900, 2250, edge) * 70 * (0.6 + 0.4 * fbm(x / 300, z / 300, 2, this.seed + 3));
    // Towns: rolling hills and valleys (~520 m across), never below 3 m so no valley
    // floor reaches the water level. Gentler downtown so the tower blocks stay walkable.
    const outer = smoothstep(250, 700, Math.hypot(x, z));
    const town = 3 + (TOWN_HILLS_DOWNTOWN + (TOWN_HILLS - TOWN_HILLS_DOWNTOWN) * outer) * fbm(x / 520 + 3.1, z / 520 - 1.7, 3, this.seed + 5);
    // Blend from town hills to countryside hills over a few hundred metres outside town.
    let a = lerp(town, Math.max(rural, 3 * (1 - smoothstep(300, 600, townDist))), smoothstep(40, 300, townDist));
    a *= 1 - smoothstep(1250, 1480, z); // the coast is flat
    a *= smoothstep(1.0, 2.6, lakeRadius(x, z)); // and so is the lake shore
    return a;
  }

  /**
   * The plane a town block's slab sits on: height at the block centre and its slope along
   * X and Z, fitted through the smooth layer at the slab's four corners. Hills are hundreds
   * of metres across, so over 64 m the ground is nearly a plane and the sidewalk meets the
   * roads around it with roughly the usual curb.
   */
  blockSurface(b: Block): BlockPlane {
    let p = this.planes.get(b);
    if (!p) {
      const r = BLOCK_SIZE / 2;
      const at = (gx: number, gz: number) => {
        const w = this.layout.warp.forward(gx, gz);
        return this.smoothHeight(w.x, w.z);
      };
      const h00 = at(b.cx - r, b.cz - r);
      const h10 = at(b.cx + r, b.cz - r);
      const h01 = at(b.cx - r, b.cz + r);
      const h11 = at(b.cx + r, b.cz + r);
      // Least-squares plane through four corners of a square: mean height, average slopes.
      p = {
        h: (h00 + h10 + h01 + h11) / 4,
        gx: (h10 + h11 - h00 - h01) / (4 * r),
        gz: (h01 + h11 - h00 - h10) / (4 * r),
      };
      this.planes.set(b, p);
    }
    return p;
  }
  private readonly planes = new Map<Block, BlockPlane>();

  /**
   * Road-level height under a block at (x, z); the sidewalk top is CURB_HEIGHT above. Blocks
   * are draped over the same smooth layer as the roads, so the curb is the same height all
   * the way round however the hill curves.
   */
  blockHeight(_b: Block, x: number, z: number): number {
    return this.smoothHeight(x, z);
  }

  /** The block whose slab covers the world point (x, z), if any. */
  blockUnder(x: number, z: number): Block | null {
    const g = this.toGrid(x, z);
    const b = this.layout.blockAt(cellOf(g.x), cellOf(g.z));
    if (!b || Math.abs(g.x - b.cx) > BLOCK_SIZE / 2 || Math.abs(g.z - b.cz) > BLOCK_SIZE / 2) return null;
    return b;
  }

  /** Where you'd stand at (x, z): a block's sidewalk top, or else the ground / road. */
  surfaceAt(x: number, z: number): number {
    const b = this.blockUnder(x, z);
    return b ? this.blockHeight(b, x, z) + CURB_HEIGHT : this.heightAt(x, z);
  }

  /** Height of the ground at (x, z), in metres. */
  heightAt(x: number, z: number): number {
    const g = this.toGrid(x, z);
    const townDist = this.townDistanceGrid(g.x, g.z);
    let h = this.smoothCore(x, z, townDist);

    // Smaller bumps, smoothed away near roads and towns.
    const forest = this.forestWeight(x, z);
    const detailMask =
      smoothstep(9, 32, this.roadDistanceGrid(g.x, g.z)) * smoothstep(15, 60, townDist) * (1 - smoothstep(1300, 1450, z));
    if (detailMask > 0) h += (fbm(x / 110, z / 110, 3, this.seed + 2) - 0.5) * 2 * (2.5 + 5 * forest) * detailMask;

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
    const gp = this.toGrid(x, z);
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
    if (this.zoneAtGrid(gp.x, gp.z) === 'farm' && this.roadDistanceGrid(gp.x, gp.z) > ROAD_WIDTH / 2 + 2) {
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
      const field = (1 - forest) * smoothstep(40, 80, this.townDistanceGrid(gp.x, gp.z));
      r = lerp(r, c[0] * rows, field);
      g = lerp(g, c[1] * rows, field);
      b = lerp(b, c[2] * rows, field);
    }

    // Steep slopes show rock.
    const rock = smoothstep(0.25, 0.5, slope);
    return [lerp(r, 0.24, rock), lerp(g, 0.23, rock), lerp(b, 0.21, rock)];
  }
}
