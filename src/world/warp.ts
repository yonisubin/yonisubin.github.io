import { fbm, lerp, smoothstep } from './noise';

// The road warp: what stops the world looking like graph paper.
//
// The layout (layout.ts) is generated on a perfect grid ("grid space"): straight roads, square
// blocks. Before anything is built, every point is pushed sideways by a smooth displacement
// field ("world space" = grid + displacement). Because the field is smooth and gentle, straight
// grid lines become gently winding roads, square blocks become slightly irregular ones, and
// everything built from the same grid data (roads, sidewalks, buildings, traffic lanes,
// pedestrians' paths, lamps…) bends together, so it all still fits.
//
// How far things move depends on where they are:
//   downtown ~2 m (small kinks: it stays recognisably a grid), suburbs and villages ~7 m,
//   countryside ~25 m (country roads meander between crossings).
// It fades to nothing near the coast (the coastal road and beach stay put), around the lake
// (roads mustn't wander into the water) and at the world's edge (inside the boundary walls).
//
// The field's slope stays well below 1 (≈ 0.3 at most), so the warp never folds space over
// itself and can be undone: inverse() finds the grid point for a world point by fixed-point
// iteration (g = w − D(g)), which converges quickly when the slope is small.

const WAVELENGTH = 400; // m, the scale of the bends (the noise adds a half-scale octave)
const DOWNTOWN = 2; // m of displacement downtown…
const TOWN = 7; // …in the suburbs and villages…
const COUNTRY = 25; // …and in the countryside
/** fbm() gives roughly 0.2…0.8; this maps that to about −1…1. */
const NOISE_GAIN = 3.2;

export interface WarpInputs {
  seed: number;
  /** Chebyshev distance in cells from each cell to the nearest town cell (0 in town). */
  townCells: Uint8Array;
  cells: number;
  pitch: number;
  /** Normalised distance from the lake's centre (1 on its shore). */
  lakeRadius(x: number, z: number): number;
  coastZ: number;
}

export class Warp {
  private readonly out = { x: 0, z: 0 };

  constructor(private readonly w: WarpInputs) {}

  /** Distance from town in cells, interpolated between cell centres (smooth). */
  private townCellsAt(gx: number, gz: number): number {
    const { cells, pitch, townCells } = this.w;
    const fx = gx / pitch + cells / 2 - 0.5;
    const fz = gz / pitch + cells / 2 - 0.5;
    const ix = Math.max(0, Math.min(cells - 2, Math.floor(fx)));
    const iz = Math.max(0, Math.min(cells - 2, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - ix));
    const tz = Math.max(0, Math.min(1, fz - iz));
    const at = (x: number, z: number) => Math.min(6, townCells[z * cells + x]);
    return lerp(lerp(at(ix, iz), at(ix + 1, iz), tx), lerp(at(ix, iz + 1), at(ix + 1, iz + 1), tx), tz);
  }

  /** Displacement size (m) at a grid point. */
  amplitude(gx: number, gz: number): number {
    const country = smoothstep(0.6, 3.2, this.townCellsAt(gx, gz));
    const downtown = 1 - smoothstep(330, 520, Math.max(Math.abs(gx), Math.abs(gz)));
    let a = lerp(lerp(TOWN, DOWNTOWN, downtown), COUNTRY, country);
    a *= 1 - smoothstep(this.w.coastZ - 380, this.w.coastZ - 140, gz); // the coast stays straight
    a *= smoothstep(1.15, 2.3, this.w.lakeRadius(gx, gz)); // keep roads out of the lake
    a *= 1 - smoothstep(1850, 1990, Math.max(Math.abs(gx), Math.abs(gz))); // and inside the walls
    return a;
  }

  /** Grid → world. Writes into (and returns) a shared scratch object: copy it if you keep it. */
  forward(gx: number, gz: number): { x: number; z: number } {
    const a = this.amplitude(gx, gz);
    const o = this.out;
    if (a < 0.01) {
      o.x = gx;
      o.z = gz;
      return o;
    }
    const s = this.w.seed;
    o.x = gx + a * NOISE_GAIN * (fbm(gx / WAVELENGTH + 11.3, gz / WAVELENGTH - 4.1, 2, s + 21) - 0.5);
    o.z = gz + a * NOISE_GAIN * (fbm(gx / WAVELENGTH - 7.7, gz / WAVELENGTH + 2.9, 2, s + 22) - 0.5);
    return o;
  }

  /** World → grid (undoes forward()). Scratch result, like forward(). */
  inverse(wx: number, wz: number): { x: number; z: number } {
    let gx = wx;
    let gz = wz;
    // g ← w − D(g): each pass shrinks the error by about the field's slope (≤ 0.3).
    for (let k = 0; k < 4; k++) {
      const f = this.forward(gx, gz);
      gx += wx - f.x;
      gz += wz - f.z;
    }
    const o = this.out;
    o.x = gx;
    o.z = gz;
    return o;
  }

  /**
   * How much the warp turns things at a grid point (rad, about +Y, the same sense as the
   * game's yaw): add it to a yaw measured in grid space to get the yaw in the world.
   */
  angle(gx: number, gz: number): number {
    const a = this.forward(gx + 1, gz);
    const ax = a.x;
    const az = a.z;
    const b = this.forward(gx - 1, gz);
    // The grid's +X axis after warping; yaw θ turns +X into (cos θ, −sin θ).
    return Math.atan2(-(az - b.z), ax - b.x);
  }
}
