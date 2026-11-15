import { Rng, hashSeed } from './rng';
import { smoothstep } from './noise';
import {
  CELL_BLOCKED,
  CELL_HOUSE,
  CELL_PARCEL,
  CELL_ROAD,
  NetworkBuilder,
  ROAD_SPECS,
  Raster,
  resample,
  smoothCurve,
  type RoadClass,
  type StreetNet,
} from './streets';
import { isTownZone, type Building, type Tree, type Zone } from './layout';

// Generating the streets outside downtown, the way American sprawl is laid out:
//
//   Arterials — four-lane roads on a rough half-mile super-grid (~470 m here). Mostly
//     straight, but they drift and bend irregularly. Out in the country they continue as
//     two-lane roads that wander much more, picking the gentlest ground.
//   Superblocks — the land between arterials. In the suburbs each one is a subdivision:
//     two to four entrances off the arterials, a curving collector road, local streets that
//     branch off it, wind about, loop back onto another street or end in a cul-de-sac.
//     Houses face the local streets; they back onto the arterials, never face them.
//   Corners and frontage — where arterials cross: strip malls with big parking lots, gas
//     stations, now and then a big-box store. Along the arterials: schools, churches, parks.
//   Beach town — a strip of shops facing the coastal road.
//   Villages — a main street with shops, a few side streets with houses, joined to the
//     country roads.
//
// Streets are grown with "walkers": a point that steps forward a few metres at a time,
// turning a little each step (a random walk on the turn rate, so curves are smooth and
// irregular, never periodic). A walker stops when it would cross a road or leave its area,
// joins a street that's close ahead (making loops), or ends in a cul-de-sac.

export interface Rect {
  x: number;
  z: number;
  /** Local +Z points away from the street (the rectangle's depth goes into the lot). */
  yaw: number;
  w: number;
  d: number;
}

export type ParcelKind = 'stripmall' | 'gas' | 'bigbox' | 'school' | 'park' | 'church' | 'shop' | 'village';

export interface Parcel extends Rect {
  kind: ParcelKind;
  buildings: Building[];
  /** Asphalt: parking lots, forecourts. */
  paved: Rect[];
  /** Parking areas to paint stall lines on (inside `paved`). */
  stalls: Rect[];
  /** Grass areas and sports fields. */
  grass: Rect[];
  fields: Rect[];
  ponds: { x: number; z: number; rx: number; rz: number; yaw: number }[];
  trees: Tree[];
  /** Gas-station canopy (flat roof on posts). */
  canopy: Rect | null;
  /** Church steeple. */
  steeple: { x: number; z: number; size: number; height: number } | null;
}

export interface StreetWorld {
  net: StreetNet;
  raster: Raster;
  parcels: Parcel[];
  houses: Building[];
  driveways: Rect[];
  trees: Tree[];
}

export interface StreetInputs {
  seed: number;
  /** Zone of the cell under a world point. */
  zoneAt(x: number, z: number): Zone;
  /** The smooth terrain height (roads follow it). */
  height(x: number, z: number): number;
  /** Lake or sea (with a margin). */
  water(x: number, z: number): boolean;
  half: number;
  /** Downtown is the square |x|, |z| ≤ downtownHalf, a grid with lines `downtownLines`. */
  downtownHalf: number;
  downtownLines: number[];
  coastZ: number;
  villages: { name: string; x: number; z: number }[];
}

/** Arterial lines (N–S at these x, E–W at these z), continuing downtown's edge lines outward. */
const SPACING = 470;
const EDGE = 1800;
const BULB = 11; // cul-de-sac radius, m
/** Parcels on an arterial start this far from its centre line (clear of its marked corridor). */
const FRONT = 14;


export function generateStreets(inp: StreetInputs): StreetWorld {
  const rng = new Rng(hashSeed(inp.seed, 901, 77));
  const builder = new NetworkBuilder();
  const raster = new Raster(inp.half);
  const out: Omit<StreetWorld, 'net'> = { raster, parcels: [], houses: [], driveways: [], trees: [] };

  // Water and downtown are off limits for anything generated here.
  for (let k = 0; k < raster.n; k++) {
    for (let i = 0; i < raster.n; i++) {
      const x = (i + 0.5) * raster.res - inp.half;
      const z = (k + 0.5) * raster.res - inp.half;
      const dt = inp.downtownHalf + 12;
      if (inp.water(x, z) || (Math.abs(x) < dt && Math.abs(z) < dt) || Math.max(Math.abs(x), Math.abs(z)) > EDGE + 60) {
        raster.data[k * raster.n + i] = CELL_BLOCKED;
      }
    }
  }

  // --- 1. Arterials and country roads on the super-grid --------------------------------
  const dh = inp.downtownHalf;
  const xs: number[] = [];
  const zs: number[] = [];
  for (let v = dh; v <= EDGE + 1; v += SPACING) {
    xs.push(-v, v);
    if (v < inp.coastZ - 100) zs.push(v);
    zs.push(-v);
  }
  xs.sort((a, b) => a - b);
  zs.push(inp.coastZ);
  zs.sort((a, b) => a - b);
  const zMin = zs[0];
  const zMax = inp.coastZ;
  // Each line's sideways drift, sampled every 8 m along it, so superblocks can find their edges.
  const nsLines = xs.map((x0) => superLine(inp, rng, 'ns', x0, zMin - 1, zMax + 1));
  const ewLines = zs.map((z0) =>
    z0 === inp.coastZ ? coastLine(z0, xs[0] - 1, xs[xs.length - 1] + 1) : superLine(inp, rng, 'ew', z0, xs[0] - 1, xs[xs.length - 1] + 1),
  );
  for (const line of [...nsLines, ...ewLines]) addLine(inp, builder, raster, line.pts);

  // Downtown's inner grid lines (its edges are the arterials at ±downtownHalf).
  for (const c of inp.downtownLines) {
    if (Math.abs(Math.abs(c) - dh) < 1) continue;
    builder.add('downtown', resample([c, -dh - 1, c, dh + 1], 26));
    builder.add('downtown', resample([-dh - 1, c, dh + 1, c], 26));
  }

  // --- 2. Villages ----------------------------------------------------------------------
  for (const v of inp.villages) village(inp, builder, raster, out, new Rng(hashSeed(inp.seed, Math.round(v.x), Math.round(v.z))), v);

  // --- 3. Superblocks --------------------------------------------------------------------
  for (let i = 0; i + 1 < xs.length; i++) {
    for (let j = 0; j + 1 < zs.length; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      const cz = (zs[j] + zs[j + 1]) / 2;
      if (Math.abs(cx) < dh && Math.abs(cz) < dh) continue; // downtown
      // How much of it is town?
      let town = 0;
      for (let a = 0; a < 6; a++) {
        for (let b = 0; b < 6; b++) {
          const x = xs[i] + ((a + 0.5) / 6) * (xs[i + 1] - xs[i]);
          const z = zs[j] + ((b + 0.5) / 6) * (zs[j + 1] - zs[j]);
          if (isTownZone(inp.zoneAt(x, z))) town++;
        }
      }
      if (town < 5) continue;
      const sb: Superblock = { west: nsLines[i], east: nsLines[i + 1], north: ewLines[j], south: ewLines[j + 1] };
      superblock(inp, builder, raster, out, new Rng(hashSeed(inp.seed, i * 31 + 7, j * 17 + 3)), sb);
    }
  }

  const net = builder.build(new Rng(hashSeed(inp.seed, 5, 5)));
  return { net, ...out };
}

// --- Lines on the super-grid --------------------------------------------------------------

/** A super-grid line: `pts` in the world, and its sideways position sampled along it. */
interface SuperLine {
  dir: 'ns' | 'ew';
  base: number;
  start: number;
  /** Lateral position (x for N–S lines, z for E–W) every 8 m from `start`. */
  lateral: Float32Array;
  pts: number[];
}

/** Where line `l` is across at `along` (x for an N–S line at a given z, and vice versa). */
function across(l: SuperLine, along: number): number {
  const f = (along - l.start) / 8;
  const i = Math.max(0, Math.min(l.lateral.length - 2, Math.floor(f)));
  const t = Math.max(0, Math.min(1, f - i));
  return l.lateral[i] + (l.lateral[i + 1] - l.lateral[i]) * t;
}

/**
 * An arterial / country road along a super-grid line. Control points every ~200 m are
 * pushed sideways by a random amount: a little in town (arterials are nearly straight), a
 * lot in the country, where the road picks the offset with the gentlest climb from the last
 * point, so it follows valleys and contours. None near downtown, whose edges these lines are.
 */
function superLine(inp: StreetInputs, rng: Rng, dir: 'ns' | 'ew', base: number, start: number, end: number): SuperLine {
  const ctrl: number[] = [];
  const pos = (along: number, lat: number): [number, number] => (dir === 'ns' ? [lat, along] : [along, lat]);
  const dh = inp.downtownHalf;
  let prevOff = 0;
  let prevH = 0;
  const n = Math.max(2, Math.round((end - start) / 170));
  for (let k = 0; k <= n; k++) {
    const along = start + ((end - start) * k) / n + (k > 0 && k < n ? rng.range(-35, 35) : 0);
    const [x, z] = pos(along, base);
    // Distance from downtown's square: no drift on its edges, fading in over 150 m.
    const dd = Math.max(Math.abs(x) - dh, Math.abs(z) - dh, 0);
    const calm = smoothstep(0, 150, dd);
    const country = !isTownZone(inp.zoneAt(x, z)) && inp.zoneAt(x, z) !== 'downtown';
    const amp = (country ? 115 : 20) * calm;
    let off = 0;
    if (amp > 0.5) {
      if (country && k > 0) {
        // Try a few offsets; prefer little climb from the previous point and little swerve.
        let best = Infinity;
        for (let c = -3; c <= 3; c++) {
          const o = (c / 3) * amp;
          const [cx, cz] = pos(along, base + o);
          const cost = Math.abs(inp.height(cx, cz) - prevH) * 2 + Math.abs(o - prevOff) * 0.08 + rng.range(0, 22);
          if (cost < best) {
            best = cost;
            off = o;
          }
        }
      } else off = rng.range(-amp, amp);
    }
    const [px, pz] = pos(along, base + off);
    prevOff = off;
    prevH = inp.height(px, pz);
    ctrl.push(px, pz);
  }
  const pts = smoothCurve(ctrl, 8);
  // Lateral table by `along`.
  const len = Math.ceil((end - start) / 8) + 1;
  const lateral = new Float32Array(len);
  let j = 0;
  for (let i = 0; i < len; i++) {
    const along = start + i * 8;
    while (j + 3 < pts.length && (dir === 'ns' ? pts[j + 3] : pts[j + 2]) < along) j += 2;
    const a0 = dir === 'ns' ? pts[j + 1] : pts[j];
    const a1 = dir === 'ns' ? pts[j + 3] ?? a0 : pts[j + 2] ?? a0;
    const l0 = dir === 'ns' ? pts[j] : pts[j + 1];
    const l1 = dir === 'ns' ? pts[j + 2] ?? l0 : pts[j + 3] ?? l0;
    const t = a1 !== a0 ? Math.max(0, Math.min(1, (along - a0) / (a1 - a0))) : 0;
    lateral[i] = l0 + (l1 - l0) * t;
  }
  return { dir, base, start, lateral, pts };
}

/** The coastal road: nearly straight, just above the beach. */
function coastLine(z0: number, start: number, end: number): SuperLine {
  const pts = resample([start, z0, end, z0], 8);
  const lateral = new Float32Array(Math.ceil((end - start) / 8) + 1).fill(z0);
  return { dir: 'ew', base: z0, start, lateral, pts };
}

/** Add a super-grid line to the network: cut at water, classed by what it runs through. */
function addLine(inp: StreetInputs, builder: NetworkBuilder, raster: Raster, pts: number[]): void {
  const n = pts.length / 2;
  const dh = inp.downtownHalf + 2;
  const cls: (RoadClass | null)[] = [];
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2];
    const z = pts[i * 2 + 1];
    if (inp.water(x, z)) cls.push(null);
    else if (Math.abs(x) <= dh && Math.abs(z) <= dh) cls.push('downtown');
    else {
      // Town if it runs through or right beside a town (the coastal road edges the beach town).
      const near = [[0, 0], [0, -40], [0, 40], [-40, 0], [40, 0]].some(([dx, dz]) => isTownZone(inp.zoneAt(x + dx, z + dz)));
      cls.push(near ? 'arterial' : 'rural');
    }
  }
  // Smooth the class along the line (a majority over ±10 points = ±80 m) so a road doesn't
  // flicker between arterial and country road at a ragged suburb edge.
  const smooth = cls.map((c, i) => {
    if (c === null || c === 'downtown') return c;
    let town = 0;
    let all = 0;
    for (let k = Math.max(0, i - 10); k <= Math.min(n - 1, i + 10); k++) {
      if (cls[k] === null || cls[k] === 'downtown') continue;
      all++;
      if (cls[k] === 'arterial') town++;
    }
    return town * 2 >= all ? 'arterial' : 'rural';
  });
  // Runs of the same class become separate polylines (they share their end points).
  let start = 0;
  for (let i = 1; i <= n; i++) {
    if (i < n && smooth[i] === smooth[start]) continue;
    const c = smooth[start];
    const end = Math.min(n - 1, i);
    if (c !== null) {
      const run = pts.slice(start * 2, end * 2 + 2);
      // Drop short scraps beside the lake.
      if (run.length >= 4 && (end - start) * 8 > 60) {
        builder.add(c, run);
        const spec = ROAD_SPECS[c];
        raster.markPolyline(run, spec.width / 2 + spec.sidewalk + 4, CELL_ROAD);
      }
    }
    start = smooth[i] === null || c === null ? i : end;
  }
}

// --- Walkers: growing curvy streets -------------------------------------------------------

interface WalkOpts {
  cls: RoadClass;
  step: number;
  /** Random change in turn rate per step (rad), and the most it may turn per step. */
  turnSd: number;
  maxTurn: number;
  minLen: number;
  maxLen: number;
  /** Keep this far from other streets (except where joining one). */
  spacing: number;
  region(x: number, z: number): boolean;
  /** May end by joining a street close ahead (making a loop). */
  join: boolean;
  /** Steady turn per step (rad): a "loop" street that curls round back to where it came from. */
  curl?: number;
}

interface Walk {
  line: number;
  pts: number[];
}

/**
 * Grow a street from (x, z) heading `heading` (rad, direction (cos h, sin h)). `parent` is
 * the line it starts on (attached there). Returns the added line, or null if it was too short.
 */
function walk(
  builder: NetworkBuilder,
  raster: Raster,
  rng: Rng,
  x: number,
  z: number,
  heading: number,
  opts: WalkOpts,
  parent: { line: number; seg: number; t: number } | null,
): Walk | null {
  const ctrl = [x, z];
  let h = heading;
  let rate = 0;
  let len = 0;
  const spec = ROAD_SPECS[opts.cls];
  const halfCorridor = spec.width / 2 + 1;
  let joined: { line: number; seg: number; t: number } | null = null;
  // Distance check against other streets; near the start the parent doesn't count.
  const tooClose = (px: number, pz: number, near: number): boolean => {
    const hit = builder.index.nearest(px, pz, opts.spacing, (owner) => near < opts.spacing + 10 && parent !== null && owner === parent.line);
    if (hit) return true;
    // Itself: not doubling back onto its own earlier points.
    const own = ctrl.length / 2;
    const skip = Math.ceil((opts.spacing * 1.2) / opts.step) + 1;
    for (let i = 0; i < own - skip; i++) {
      if (Math.hypot(ctrl[i * 2] - px, ctrl[i * 2 + 1] - pz) < opts.spacing * 0.9) return true;
    }
    return false;
  };

  while (len < opts.maxLen) {
    const px = ctrl[ctrl.length - 2];
    const pz = ctrl[ctrl.length - 1];
    // Join a street close ahead (not the one we started from, at first).
    if (opts.join && len > 45) {
      const hit = builder.index.nearest(px + Math.cos(h) * 16, pz + Math.sin(h) * 16, 32, (owner) => parent !== null && owner === parent.line && len < 120);
      if (hit) {
        const dx = hit.x - px;
        const dz = hit.z - pz;
        const d = Math.hypot(dx, dz);
        if (d > 3 && (dx * Math.cos(h) + dz * Math.sin(h)) / d > 0.4 && raster.segmentFree(px + (dx / d) * 2, pz + (dz / d) * 2, hit.x - (dx / d) * 9, hit.z - (dz / d) * 9, 2)) {
          ctrl.push(hit.x, hit.z);
          len += d;
          joined = { line: hit.edge, seg: hit.seg, t: hit.t };
          break;
        }
      }
    }
    // Smoothly varying turn rate: curves that tighten and relax, never a regular wave.
    rate = Math.max(-opts.maxTurn, Math.min(opts.maxTurn, rate * 0.8 + gauss(rng) * opts.turnSd));
    // A loop street runs out straight-ish for a while, then curls round.
    if (opts.curl && len > 45) rate = opts.curl + gauss(rng) * opts.turnSd * 0.3;
    let moved = false;
    for (const extra of [0, 0.22, -0.22, 0.45, -0.45, 0.7, -0.7]) {
      const nh = h + rate + extra;
      const nx = px + Math.cos(nh) * opts.step;
      const nz = pz + Math.sin(nh) * opts.step;
      if (!opts.region(nx, nz)) continue;
      // Leaving the road it started from, its own corridor is still marked: skip the raster
      // test for the first few metres.
      if (len > 16 && !raster.segmentFree(px + Math.cos(nh) * 2, pz + Math.sin(nh) * 2, nx, nz, halfCorridor)) continue;
      if (len > 16 && tooClose(nx, nz, len)) continue;
      ctrl.push(nx, nz);
      h = nh;
      if (extra !== 0) rate *= 0.3;
      len += opts.step;
      moved = true;
      break;
    }
    if (!moved) {
      // Boxed in: rather than a dead end, often loop back to a street within reach.
      if (opts.join && len > 60) {
        const hit = builder.index.nearest(px, pz, 62, (owner) => parent !== null && owner === parent.line && len < 140);
        if (hit) {
          const dx = hit.x - px;
          const dz = hit.z - pz;
          const d = Math.hypot(dx, dz);
          if (d > 6 && (dx * Math.cos(h) + dz * Math.sin(h)) / d > -0.1 && raster.segmentFree(px + (dx / d) * 3, pz + (dz / d) * 3, hit.x - (dx / d) * 9, hit.z - (dz / d) * 9, 2) && rng.chance(0.75)) {
            // A gentle turn toward it through a midpoint, so the join isn't a kink.
            ctrl.push(px + Math.cos(h) * Math.min(12, d / 2) * 0.6 + dx * 0.4, pz + Math.sin(h) * Math.min(12, d / 2) * 0.6 + dz * 0.4);
            ctrl.push(hit.x, hit.z);
            len += d;
            joined = { line: hit.edge, seg: hit.seg, t: hit.t };
          }
        }
      }
      break;
    }
  }
  if (len < opts.minLen) return null;
  // A dead end with room becomes a cul-de-sac.
  let bulb = 0;
  if (!joined) {
    const ex = ctrl[ctrl.length - 2];
    const ez = ctrl[ctrl.length - 1];
    // Room for the turning circle? Otherwise it's a plain dead end.
    let room = true;
    for (let a = 0; a < 8 && room; a++) {
      const r = BULB + spec.sidewalk + 2;
      if (raster.get(ex + Math.cos((a * Math.PI) / 4) * r, ez + Math.sin((a * Math.PI) / 4) * r) === CELL_BLOCKED) room = false;
    }
    bulb = room ? BULB : 0;
  }
  const pts = smoothCurve(ctrl, 5);
  const line = builder.add(opts.cls, pts, 0, bulb);
  if (parent) builder.attach(parent.line, parent.seg, parent.t);
  if (joined) builder.attach(joined.line, joined.seg, joined.t);
  raster.markPolyline(pts, spec.width / 2 + spec.sidewalk + 1, CELL_ROAD);
  if (bulb) raster.markDisk(pts[pts.length - 2], pts[pts.length - 1], bulb + spec.sidewalk + 1, CELL_ROAD);
  return { line, pts };
}

function gauss(rng: Rng): number {
  // Sum of three uniforms: close enough to a normal distribution, sd 1.
  return (rng.float() + rng.float() + rng.float() - 1.5) * 2;
}

/** Point, unit tangent and the right-hand normal at distance s along a polyline. */
function along(pts: number[], s: number): { x: number; z: number; tx: number; tz: number; nx: number; nz: number } {
  let acc = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const dx = pts[i + 2] - pts[i];
    const dz = pts[i + 3] - pts[i + 1];
    const l = Math.hypot(dx, dz);
    if (acc + l >= s || i + 4 >= pts.length) {
      const t = l > 0 ? Math.max(0, Math.min(1, (s - acc) / l)) : 0;
      const tx = dx / (l || 1);
      const tz = dz / (l || 1);
      // Right of travel: rotate the tangent 90° (the right of +X is +Z).
      return { x: pts[i] + dx * t, z: pts[i + 1] + dz * t, tx, tz, nx: -tz, nz: tx };
    }
    acc += l;
  }
  return { x: pts[0], z: pts[1], tx: 1, tz: 0, nx: 0, nz: 1 };
}

/** Where on a builder line a point lies (for attaching). */
function locate(builder: NetworkBuilder, x: number, z: number, line?: number): { line: number; seg: number; t: number } | null {
  const hit = builder.index.nearest(x, z, 6, line === undefined ? undefined : (owner) => owner !== line);
  return hit ? { line: hit.edge, seg: hit.seg, t: hit.t } : null;
}

// --- Houses -------------------------------------------------------------------------------

const WALLS: [number, number, number][] = [
  [0.78, 0.74, 0.66],
  [0.7, 0.62, 0.5],
  [0.62, 0.66, 0.68],
  [0.8, 0.78, 0.72],
  [0.55, 0.42, 0.32],
  [0.72, 0.68, 0.55],
  [0.5, 0.56, 0.5],
  [0.84, 0.82, 0.78],
  [0.66, 0.6, 0.58],
];
const ROOFS: [number, number, number][] = [
  [0.12, 0.12, 0.13],
  [0.32, 0.12, 0.08],
  [0.22, 0.16, 0.12],
  [0.2, 0.22, 0.25],
  [0.3, 0.27, 0.24],
];
const STYLE_HOUSE = 3;
const STYLE_BRICK = 1;
const STYLE_CONCRETE = 2;

/** Yaw for a rectangle whose local +Z points along (nx, nz). */
const yawFacing = (nx: number, nz: number) => Math.atan2(nx, nz);

/** A house at (x, z) whose back points along (nx, nz) (its front faces the street). */
function house(rng: Rng, x: number, z: number, nx: number, nz: number, w: number, d: number): Building {
  const floors = rng.chance(0.55) ? 2 : 1;
  return {
    x,
    z,
    y: 0,
    yaw: yawFacing(nx, nz),
    width: w,
    depth: d,
    height: floors * 3 + 0.4,
    style: STYLE_HOUSE,
    color: rng.pick(WALLS),
    seed: rng.int(0, 999),
    roof: { height: rng.range(2.2, 3.4), color: rng.pick(ROOFS) },
  };
}

/** Lots along both sides of a street, and round its cul-de-sac. */
function lotsAlong(rng: Rng, raster: Raster, out: Omit<StreetWorld, 'net'>, pts: number[], cls: RoadClass, bulbEnd: boolean, region: (x: number, z: number) => boolean): void {
  const spec = ROAD_SPECS[cls];
  const len = pts.reduce((acc, _v, i) => (i >= 2 && i % 2 === 0 ? acc + Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]) : acc), 0);
  const tryHouse = (px: number, pz: number, tx: number, tz: number, nx: number, nz: number, kerb: number, frontage: number): void => {
    const w = Math.min(frontage - 5, rng.range(10, 15));
    const d = rng.range(9, 12.5);
    const setback = rng.range(5.5, 8.5);
    const off = kerb + spec.sidewalk + setback + d / 2;
    const hx = px + nx * off;
    const hz = pz + nz * off;
    const yaw = yawFacing(nx, nz);
    if (!region(hx, hz) || !region(hx + nx * (d / 2 + 6), hz + nz * (d / 2 + 6))) return;
    if (!raster.rectFree(hx, hz, w / 2 + 2, d / 2 + 2, yaw)) return;
    // Its yard: from the sidewalk to ~7 m behind the house, the width of the lot.
    const lotDepth = setback + d + 7;
    const lx = px + nx * (kerb + spec.sidewalk + lotDepth / 2);
    const lz = pz + nz * (kerb + spec.sidewalk + lotDepth / 2);
    raster.markRect(lx, lz, frontage / 2 - 0.5, lotDepth / 2, yaw, CELL_HOUSE);
    raster.markRect(hx, hz, w / 2 + 1, d / 2 + 1, yaw, CELL_HOUSE);
    out.houses.push(house(rng, hx, hz, nx, nz, w, d));
    // Driveway to one side of the house, from the kerb to the house front.
    const side = rng.chance(0.5) ? 1 : -1;
    const dlen = spec.sidewalk + setback + 1;
    const dOff = side * (w / 2 - 1.8);
    out.driveways.push({
      x: px + tx * dOff + nx * (kerb + dlen / 2),
      z: pz + tz * dOff + nz * (kerb + dlen / 2),
      yaw,
      w: 3.4,
      d: dlen,
    });
    if (rng.chance(0.65)) {
      out.trees.push({ x: hx + nx * (d / 2 + 3.5) + tx * rng.range(-w / 2, w / 2), y: 0, z: hz + nz * (d / 2 + 3.5) + tz * rng.range(-w / 2, w / 2), scale: rng.range(0.8, 1.25), hue: rng.float() });
    }
    // A street tree in the front lawn now and then.
    if (rng.chance(0.3)) {
      const k = kerb + spec.sidewalk + 1.6;
      out.trees.push({ x: px - tx * dOff * 0.8 + nx * k, y: 0, z: pz - tz * dOff * 0.8 + nz * k, scale: rng.range(0.7, 1.0), hue: rng.float() });
    }
  };
  let s = 10;
  while (s < len - 10) {
    const frontage = rng.range(19, 25);
    const p = along(pts, s + frontage / 2);
    for (const side of [1, -1]) tryHouse(p.x, p.z, p.tx, p.tz, p.nx * side, p.nz * side, spec.width / 2, frontage);
    s += frontage;
  }
  if (bulbEnd) {
    // Pie-shaped lots round the turning circle.
    const end = along(pts, len);
    const h = Math.atan2(end.tz, end.tx);
    for (const a of [-1.75, -0.9, 0, 0.9, 1.75]) {
      const nx = Math.cos(h + a);
      const nz = Math.sin(h + a);
      const ex = end.x + nx * BULB;
      const ez = end.z + nz * BULB;
      tryHouse(ex, ez, -nz, nx, nx, nz, 0, 20);
    }
  }
}

// --- Superblocks ---------------------------------------------------------------------------

interface Superblock {
  west: SuperLine;
  east: SuperLine;
  north: SuperLine;
  south: SuperLine;
}

function superblock(inp: StreetInputs, builder: NetworkBuilder, raster: Raster, out: Omit<StreetWorld, 'net'>, rng: Rng, sb: Superblock): void {
  const inside = (x: number, z: number, margin: number) =>
    x > across(sb.west, z) + margin && x < across(sb.east, z) - margin && z > across(sb.north, x) + margin && z < across(sb.south, x) - margin;
  const town = (x: number, z: number) => isTownZone(inp.zoneAt(x, z)) && !inp.water(x, z);
  const region = (x: number, z: number) => inside(x, z, 12) && town(x, z);
  // Parcels front onto the arterials, so their corners may come closer to them.
  const parcelRegion = (x: number, z: number) => inside(x, z, 6) && town(x, z);
  const coastal = Math.abs(sb.south.base - inp.coastZ) < 1;

  // Corners: (x, z) where the edge lines cross, solved by alternating the two line lookups.
  const corner = (ns: SuperLine, ew: SuperLine) => {
    let x = ns.base;
    let z = ew.base;
    for (let k = 0; k < 4; k++) {
      x = across(ns, z);
      z = across(ew, x);
    }
    return { x, z };
  };
  const cx = (sb.west.base + sb.east.base) / 2;
  const cz = (sb.north.base + sb.south.base) / 2;

  // 1. Commercial corners: strip mall, gas station or big-box where two arterials meet.
  let bigbox = false;
  for (const [ns, ew] of [
    [sb.west, sb.north],
    [sb.east, sb.north],
    [sb.west, sb.south],
    [sb.east, sb.south],
  ] as const) {
    if (coastal && ew === sb.south) continue;
    if (!rng.chance(0.75)) continue;
    const c = corner(ns, ew);
    if (!town(c.x + Math.sign(cx - c.x) * 60, c.z + Math.sign(cz - c.z) * 60)) continue;
    const r = rng.float();
    const kind: ParcelKind = !bigbox && r < 0.14 ? 'bigbox' : r < 0.62 ? 'stripmall' : 'gas';
    if (kind === 'bigbox') bigbox = true;
    const [w, d] = kind === 'bigbox' ? [200, 150] : kind === 'stripmall' ? [rng.range(110, 160), rng.range(70, 85)] : [55, 45];
    // Front onto the E–W arterial (or the N–S one, at random), set back from both.
    const alongEW = rng.chance(0.6);
    const sx = Math.sign(cx - c.x);
    const sz = Math.sign(cz - c.z);
    const front = alongEW ? ew : ns;
    // The inward normal of the frontage line, from its direction halfway along the parcel's
    // frontage (the road may bend over that length).
    const a = (alongEW ? c.x + sx * (FRONT + w / 2) : c.z + sz * (FRONT + w / 2));
    const slope = (across(front, a + 6) - across(front, a - 6)) / 12;
    let nx: number;
    let nz: number;
    if (alongEW) {
      nx = -slope * sz;
      nz = sz;
    } else {
      nx = sx;
      nz = -slope * sx;
    }
    const nl = Math.hypot(nx, nz);
    nx /= nl;
    nz /= nl;
    // Tangent pointing away from the corner along the frontage line.
    let ux = -nz;
    let uz = nx;
    if ((alongEW ? ux * sx : uz * sz) < 0) {
      ux = -ux;
      uz = -uz;
    }
    // Shrink and slide away from the corner until it fits.
    let placed = false;
    for (const scale of [1, 0.8, 0.62]) {
      for (const slide of [0, 25, 50]) {
        if (placed) break;
        const ww = w * scale;
        const dd = Math.max(40, d * scale);
        const px = c.x + ux * (FRONT + slide + ww / 2) + nx * (FRONT + dd / 2);
        const pz = c.z + uz * (FRONT + slide + ww / 2) + nz * (FRONT + dd / 2);
        placed = placeParcel(rng, raster, out, kind === 'bigbox' && scale < 1 ? 'stripmall' : kind, px, pz, nx, nz, ww, dd, parcelRegion) !== null;
      }
    }
  }

  // 2. Civic places on the arterial frontage: school, church, park.
  const sides: { line: SuperLine; at: (f: number) => { x: number; z: number; nx: number; nz: number } }[] = [];
  const sideOf = (line: SuperLine, from: number, to: number, inward: number) => (f: number) => {
    const a = from + (to - from) * f;
    const lat = across(line, a);
    const slope = (across(line, a + 4) - across(line, a - 4)) / 8;
    let x: number;
    let z: number;
    let nx: number;
    let nz: number;
    if (line.dir === 'ns') {
      x = lat;
      z = a;
      nx = inward;
      nz = -slope * inward;
    } else {
      x = a;
      z = lat;
      nx = -slope * inward;
      nz = inward;
    }
    const l = Math.hypot(nx, nz);
    return { x, z, nx: nx / l, nz: nz / l };
  };
  sides.push({ line: sb.north, at: sideOf(sb.north, sb.west.base, sb.east.base, 1) });
  sides.push({ line: sb.west, at: sideOf(sb.west, sb.north.base, sb.south.base, 1) });
  sides.push({ line: sb.east, at: sideOf(sb.east, sb.north.base, sb.south.base, -1) });
  if (!coastal) sides.push({ line: sb.south, at: sideOf(sb.south, sb.west.base, sb.east.base, -1) });
  const civic: ParcelKind[] = [];
  if (rng.chance(0.3)) civic.push('school');
  if (rng.chance(0.35)) civic.push('church');
  if (rng.chance(0.4)) civic.push('park');
  // Strip malls also line the arterials between the corners.
  if (rng.chance(0.45)) civic.push('stripmall');
  if (rng.chance(0.25)) civic.push('gas');
  for (const kind of civic) {
    const [w, d] =
      kind === 'school' ? [170, 125] : kind === 'church' ? [70, 65] : kind === 'stripmall' ? [rng.range(100, 140), rng.range(65, 80)] : kind === 'gas' ? [55, 45] : [rng.range(90, 130), rng.range(80, 110)];
    // A few tries along different sides.
    for (let attempt = 0; attempt < 5; attempt++) {
      const side = rng.pick(sides);
      const p = side.at(rng.range(0.25, 0.75));
      if (placeParcel(rng, raster, out, kind, p.x + p.nx * (FRONT + d / 2), p.z + p.nz * (FRONT + d / 2), p.nx, p.nz, w, d, parcelRegion)) break;
    }
  }

  // 3. Beach town: a row of shops along the coastal road.
  if (coastal) {
    const p0 = corner(sb.west, sb.south);
    const p1 = corner(sb.east, sb.south);
    for (let x = p0.x + 30; x < p1.x - 30; x += rng.range(26, 32)) {
      const z = across(sb.south, x);
      if (inp.zoneAt(x, z - 20) !== 'beachtown') continue;
      placeParcel(rng, raster, out, 'shop', x, z - FRONT - 10, 0, -1, 24, 20, (a, b) => town(a, b));
    }
  }

  // 4. The subdivision: entrances off the arterials, a collector from each, local streets off those.
  const entrances: { x: number; z: number; nx: number; nz: number; line: SuperLine }[] = [];
  for (const side of sides) {
    for (const f of [0.28, 0.5, 0.72]) {
      const p = side.at(f + rng.range(-0.08, 0.08));
      const x0 = p.x + p.nx * 16;
      const z0 = p.z + p.nz * 16;
      if (!region(x0 + p.nx * 20, z0 + p.nz * 20)) continue;
      if (!raster.segmentFree(x0 + p.nx * 4, z0 + p.nz * 4, p.x + p.nx * 50, p.z + p.nz * 50, 6)) continue;
      entrances.push({ ...p, line: side.line });
    }
  }
  // Two to four entrances, spread out.
  shuffle(rng, entrances);
  const chosen: typeof entrances = [];
  for (const e of entrances) {
    if (chosen.length >= 4) break;
    if (chosen.some((c) => Math.hypot(c.x - e.x, c.z - e.z) < 180)) continue;
    chosen.push(e);
  }
  const queue: { x: number; z: number; h: number; parent: { line: number; seg: number; t: number } | null; cls: RoadClass; depth: number; curl?: number }[] = [];
  for (const e of chosen) {
    const at = locate(builder, e.x, e.z);
    if (!at) continue;
    const [x, z] = builder.pointOn(at.line, at.seg, at.t);
    queue.push({ x, z, h: Math.atan2(e.nz, e.nx), parent: at, cls: 'collector', depth: 0 });
  }
  const streets: { line: number; pts: number[]; cls: RoadClass; bulb: boolean }[] = [];
  let guard = 0;
  while (queue.length && guard++ < 200) {
    const q = queue.shift()!;
    const collector = q.cls === 'collector';
    const w = walk(builder, raster, rng, q.x, q.z, q.h, {
      cls: q.cls,
      step: collector ? 18 : q.curl ? 12 : 15,
      turnSd: collector ? 0.07 : 0.1,
      maxTurn: collector ? 0.16 : q.curl ? 0.34 : 0.22,
      curl: q.curl,
      minLen: collector ? 120 : 45,
      maxLen: collector ? rng.range(450, 750) : q.curl ? 420 : rng.range(110, 280),
      spacing: collector ? 58 : 52,
      region,
      join: collector || !!q.curl ? true : rng.chance(0.8),
    }, q.parent);
    if (!w) continue;
    const bulbEnd = builder.lines[w.line].bulbEnd > 0;
    streets.push({ line: w.line, pts: w.pts, cls: q.cls, bulb: bulbEnd });
    // Branches: local streets every 60–110 m, alternating sides.
    if (q.depth >= 2) continue;
    const len = w.pts.reduce((acc, _v, i) => (i >= 2 && i % 2 === 0 ? acc + Math.hypot(w.pts[i] - w.pts[i - 2], w.pts[i + 1] - w.pts[i - 1]) : acc), 0);
    let side = rng.chance(0.5) ? 1 : -1;
    for (let s = rng.range(45, 80); s < len - 35; s += rng.range(60, 110)) {
      if (!collector && !rng.chance(0.55)) continue;
      const p = along(w.pts, s);
      const at = locate(builder, p.x, p.z);
      if (!at || at.line !== w.line) continue;
      const h = Math.atan2(p.nz * side, p.nx * side) + rng.range(-0.3, 0.3);
      queue.push({ x: p.x, z: p.z, h, parent: at, cls: 'local', depth: q.depth + 1, curl: rng.chance(0.35) ? -side * rng.range(0.24, 0.3) : 0 });
      side = -side;
      // Sometimes a branch on both sides (a crossroads).
      if (rng.chance(0.25)) queue.push({ x: p.x, z: p.z, h: h + Math.PI, parent: at, cls: 'local', depth: q.depth + 1 });
    }
  }
  // 5. Infill: wherever open land is left beside a street, sprout another local street, so
  // the subdivision covers the superblock the way real ones do.
  for (let round = 0; round < 3; round++) {
    let grown = 0;
    for (const st of [...streets]) {
      const len = polyLen(st.pts);
      for (let s = 25; s < len - 20; s += rng.range(26, 36)) {
        const p = along(st.pts, s);
        for (const side of [1, -1]) {
          const nx = p.nx * side;
          const nz = p.nz * side;
          const open = (d: number) => region(p.x + nx * d, p.z + nz * d) && raster.get(p.x + nx * d, p.z + nz * d) === 0;
          if (!open(30) || !open(48) || !open(66)) continue;
          const at = locate(builder, p.x, p.z);
          if (!at || at.line !== st.line) continue;
          // Some are loops: they curl back round (toward the street's start side) to rejoin it.
          const curl = rng.chance(0.3) ? -side * rng.range(0.24, 0.3) : 0;
          const w = walk(builder, raster, rng, p.x, p.z, Math.atan2(nz, nx) + rng.range(-0.35, 0.35), {
            cls: 'local',
            step: curl ? 12 : 15,
            turnSd: 0.1,
            maxTurn: curl ? 0.34 : 0.22,
            curl,
            minLen: 40,
            maxLen: curl ? 420 : rng.range(90, 240),
            spacing: 50,
            region,
            join: rng.chance(0.75),
          }, at);
          if (!w) continue;
          streets.push({ line: w.line, pts: w.pts, cls: 'local', bulb: builder.lines[w.line].bulbEnd > 0 });
          grown++;
        }
      }
    }
    if (!grown) break;
  }
  for (const st of streets) lotsAlong(rng, raster, out, st.pts, st.cls, st.bulb, region);
}

function polyLen(pts: number[]): number {
  let len = 0;
  for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  return len;
}

function shuffle<T>(rng: Rng, a: T[]): void {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
}

// --- Parcels ------------------------------------------------------------------------------

/**
 * A rectangular parcel whose front faces a road: centre (x, z), (nx, nz) pointing from the
 * road into it, w along the road, d deep. Filled with its buildings, lots, fields…
 */
function placeParcel(
  rng: Rng,
  raster: Raster,
  out: Omit<StreetWorld, 'net'>,
  kind: ParcelKind,
  x: number,
  z: number,
  nx: number,
  nz: number,
  w: number,
  d: number,
  region: (x: number, z: number) => boolean,
): Parcel | null {
  const yaw = yawFacing(nx, nz);
  // Local axes: u along the road, v into the parcel.
  const ux = Math.cos(yaw);
  const uz = -Math.sin(yaw);
  const vx = Math.sin(yaw);
  const vz = Math.cos(yaw);
  // In its area: the centre and at least three of the four corners (suburb edges are ragged).
  let corners = 0;
  for (const [a, b] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    if (region(x + (ux * w * a) / 2 + (vx * d * b) / 2, z + (uz * w * a) / 2 + (vz * d * b) / 2)) corners++;
  }
  if (corners < 3 || !region(x, z)) return null;
  if (!raster.rectFree(x, z, w / 2, d / 2, yaw)) return null;
  raster.markRect(x, z, w / 2 + 3, d / 2 + 3, yaw, CELL_PARCEL);

  const p: Parcel = { kind, x, z, yaw, w, d, buildings: [], paved: [], stalls: [], grass: [], fields: [], ponds: [], trees: [], canopy: null, steeple: null };
  // Local (along, into) → world.
  const L = (a: number, b: number) => ({ x: x + ux * a + vx * b, z: z + uz * a + vz * b });
  const rect = (a: number, b: number, rw: number, rd: number): Rect => ({ ...L(a, b), yaw, w: rw, d: rd });
  const building = (a: number, b: number, bw: number, bd: number, height: number, style: number, color: [number, number, number], roof?: Building['roof']): Building => {
    const c = L(a, b);
    const bl: Building = { x: c.x, z: c.z, y: 0, yaw, width: bw, depth: bd, height, style, color, seed: rng.int(0, 999), roof };
    p.buildings.push(bl);
    return bl;
  };
  const tree = (a: number, b: number) => {
    const c = L(a, b);
    p.trees.push({ x: c.x, y: 0, z: c.z, scale: rng.range(0.8, 1.3), hue: rng.float() });
  };
  const front = -d / 2; // the edge facing the road
  // Parcels on an arterial get two entrance driveways from the kerb to their front edge
  // (the arterial's kerb is ROAD_SPECS.arterial.width / 2 from its centre line, FRONT is
  // where the parcel starts).
  const entrances = (gap: number) => {
    const reach = FRONT - ROAD_SPECS.arterial.width / 2 + 0.5;
    for (const a of [-gap, gap]) p.paved.push(rect(a, front - reach / 2, 9, reach));
  };

  switch (kind) {
    case 'stripmall': {
      // A long one-storey row of shops at the back, the parking lot in front.
      const bd = 20;
      building(0, d / 2 - bd / 2 - 3, w - 10, bd, rng.range(5.5, 7), rng.chance(0.5) ? STYLE_BRICK : STYLE_CONCRETE, rng.pick(SHOP_COLORS));
      const lotD = d - bd - 6;
      p.paved.push(rect(0, front + lotD / 2, w, lotD));
      p.stalls.push(rect(0, front + lotD / 2 + 2, w - 8, lotD - 12));
      for (let a = -w / 2 + 6; a <= w / 2 - 6; a += 24) tree(a, front + 1.5);
      entrances(w / 3);
      break;
    }
    case 'bigbox': {
      building(0, d / 2 - 42, 120, 78, 10, STYLE_CONCRETE, [0.72, 0.7, 0.66]);
      const lotD = d - 86;
      p.paved.push(rect(0, front + lotD / 2, w, lotD));
      p.stalls.push(rect(0, front + lotD / 2 + 2, w - 12, lotD - 14));
      p.paved.push(rect(w / 2 - 20, d / 2 - 40, 36, 76)); // loading yard beside the store
      entrances(w / 3);
      break;
    }
    case 'gas': {
      p.paved.push(rect(0, 0, w, d));
      p.canopy = rect(0, front + 17, 26, 14);
      building(0, d / 2 - 7, 16, 10, 4.2, STYLE_CONCRETE, [0.86, 0.84, 0.8]);
      entrances(w / 2 - 8);
      break;
    }
    case 'school': {
      // An L of two-storey wings, a car park, and playing fields.
      const col: [number, number, number] = [0.66, 0.42, 0.3];
      building(-w / 2 + 40, front + 32, 64, 22, 8, STYLE_BRICK, col);
      building(-w / 2 + 19, front + 62, 22, 40, 8, STYLE_BRICK, col);
      p.paved.push(rect(-w / 2 + 52, front + 12, 64, 18));
      p.stalls.push(rect(-w / 2 + 52, front + 12, 60, 14));
      p.paved.push(rect(-w / 2 + 52, front - (FRONT - ROAD_SPECS.arterial.width / 2 + 0.5) / 2, 9, FRONT - ROAD_SPECS.arterial.width / 2 + 0.5));
      p.grass.push(rect(w / 4, 0, w / 2 - 4, d - 8));
      p.fields.push(rect(w / 4, 0, Math.min(w / 2 - 14, 72), Math.min(d - 24, 100)));
      for (let b = front + 8; b < d / 2 - 4; b += 14) tree(-w / 2 + 4, b);
      break;
    }
    case 'church': {
      const col: [number, number, number] = rng.chance(0.5) ? [0.86, 0.84, 0.8] : [0.62, 0.36, 0.28];
      building(0, front + 26, 18, 30, 7, STYLE_BRICK, col, { height: 5, color: [0.18, 0.18, 0.2] });
      const c = L(0, front + 26 - 15 - 3);
      p.steeple = { x: c.x, z: c.z, size: 5, height: 22 };
      p.paved.push(rect(w / 2 - 15, 4, 26, d - 14));
      p.stalls.push(rect(w / 2 - 15, 4, 22, d - 20));
      p.paved.push(rect(w / 2 - 15, front - (FRONT - ROAD_SPECS.arterial.width / 2 + 0.5) / 2 - 1, 9, FRONT - ROAD_SPECS.arterial.width / 2 + 2.5));
      p.grass.push(rect(-w / 2 + 16, 0, 28, d - 6));
      tree(-w / 2 + 8, front + 8);
      tree(-w / 2 + 8, d / 2 - 8);
      break;
    }
    case 'park': {
      p.grass.push(rect(0, 0, w, d));
      const pr = Math.min(w, d) * rng.range(0.14, 0.2);
      const pc = L(rng.range(-w / 6, w / 6), rng.range(-d / 8, d / 8));
      p.ponds.push({ x: pc.x, z: pc.z, rx: pr * 1.5, rz: pr, yaw: yaw + rng.range(-0.5, 0.5) });
      for (let k = 0; k < Math.round((w * d) / 260); k++) {
        const a = rng.range(-w / 2 + 4, w / 2 - 4);
        const b = rng.range(-d / 2 + 4, d / 2 - 4);
        const c = L(a, b);
        if (Math.hypot((c.x - pc.x) / (pr * 1.5 + 5), (c.z - pc.z) / (pr * 1.5 + 5)) < 1) continue;
        tree(a, b);
      }
      break;
    }
    case 'shop':
    case 'village': {
      const floors = rng.int(1, 3);
      building(0, front + 8, w - 2, 14, floors * 3.2 + 1.5, STYLE_BRICK, rng.pick(PASTELS));
      break;
    }
  }
  out.parcels.push(p);
  return p;
}

const SHOP_COLORS: [number, number, number][] = [
  [0.8, 0.74, 0.62],
  [0.7, 0.66, 0.6],
  [0.62, 0.5, 0.42],
  [0.78, 0.76, 0.72],
];
const PASTELS: [number, number, number][] = [
  [0.86, 0.72, 0.62],
  [0.72, 0.82, 0.8],
  [0.86, 0.82, 0.64],
  [0.8, 0.7, 0.78],
  [0.9, 0.88, 0.84],
];

// --- Villages --------------------------------------------------------------------------------

function village(inp: StreetInputs, builder: NetworkBuilder, raster: Raster, out: Omit<StreetWorld, 'net'>, rng: Rng, v: { x: number; z: number }): void {
  const region = (x: number, z: number) => Math.hypot(x - v.x, z - v.z) < 230 && !inp.water(x, z);
  // Main street through the middle at a random angle, gently curved.
  const ang = rng.range(0, Math.PI);
  const dx = Math.cos(ang);
  const dz = Math.sin(ang);
  const ctrl: number[] = [];
  let bend = 0;
  for (let k = -5; k <= 5; k++) {
    bend += rng.range(-6, 6);
    ctrl.push(v.x + dx * k * 40 - dz * bend, v.z + dz * k * 40 + dx * bend);
  }
  const main = smoothCurve(ctrl, 6);
  const mainLine = builder.add('collector', main);
  raster.markPolyline(main, ROAD_SPECS.collector.width / 2 + ROAD_SPECS.collector.sidewalk + 1, CELL_ROAD);
  // Join both ends to the nearest country road.
  for (const end of [0, main.length - 2]) {
    const sx = main[end];
    const sz = main[end + 1];
    const away = end === 0 ? Math.atan2(-dz, -dx) : Math.atan2(dz, dx);
    connect(inp, builder, raster, rng, sx, sz, away, mainLine);
  }
  // Shops along the main street near the middle, houses on side streets.
  const mainLen = main.reduce((acc, _v, i) => (i >= 2 && i % 2 === 0 ? acc + Math.hypot(main[i] - main[i - 2], main[i + 1] - main[i - 1]) : acc), 0);
  for (let s = mainLen / 2 - 90; s < mainLen / 2 + 90; s += rng.range(20, 26)) {
    const p = along(main, s);
    for (const side of [1, -1]) {
      const off = ROAD_SPECS.collector.width / 2 + ROAD_SPECS.collector.sidewalk + 0.5 + 9;
      placeParcel(rng, raster, out, 'village', p.x + p.nx * side * off, p.z + p.nz * side * off, p.nx * side, p.nz * side, 20, 18, region);
    }
  }
  const streets: { pts: number[]; cls: RoadClass; bulb: boolean }[] = [{ pts: main, cls: 'collector', bulb: false }];
  for (let k = 0; k < 3; k++) {
    const s = rng.range(0.2, 0.8) * mainLen;
    const p = along(main, s);
    const side = rng.chance(0.5) ? 1 : -1;
    const at = locate(builder, p.x, p.z);
    if (!at) continue;
    const w = walk(builder, raster, rng, p.x, p.z, Math.atan2(p.nz * side, p.nx * side) + rng.range(-0.3, 0.3), {
      cls: 'local',
      step: 15,
      turnSd: 0.1,
      maxTurn: 0.22,
      minLen: 45,
      maxLen: rng.range(90, 180),
      spacing: 50,
      region,
      join: true,
    }, at);
    if (w) streets.push({ pts: w.pts, cls: 'local', bulb: builder.lines[w.line].bulbEnd > 0 });
  }
  for (const st of streets) lotsAlong(rng, raster, out, st.pts, st.cls, st.bulb, region);
}

/**
 * A country road from (x, z) toward the nearest existing road ahead, winding a little and
 * preferring gentle ground.
 */
function connect(inp: StreetInputs, builder: NetworkBuilder, raster: Raster, rng: Rng, x: number, z: number, heading: number, from: number): void {
  const target = builder.index.nearest(x + Math.cos(heading) * 200, z + Math.sin(heading) * 200, 700, (owner) => owner === from);
  if (!target) return;
  const ctrl = [x, z];
  let h = heading;
  let px = x;
  let pz = z;
  for (let k = 0; k < 60; k++) {
    const tx = target.x - px;
    const tz = target.z - pz;
    const dist = Math.hypot(tx, tz);
    if (dist < 30) break;
    // Steer toward the target, choosing among a few headings the one with the least climb.
    const want = Math.atan2(tz, tx);
    let dh = Math.atan2(Math.sin(want - h), Math.cos(want - h));
    dh = Math.max(-0.35, Math.min(0.35, dh));
    let best = Infinity;
    let bh = h + dh;
    for (const c of [-0.25, 0, 0.25]) {
      const nh = h + dh + c;
      const nx = px + Math.cos(nh) * 25;
      const nz = pz + Math.sin(nh) * 25;
      if (inp.water(nx, nz)) continue;
      const cost = Math.abs(inp.height(nx, nz) - inp.height(px, pz)) * 3 + Math.abs(c) * 6 + rng.range(0, 3);
      if (cost < best) {
        best = cost;
        bh = nh;
      }
    }
    h = bh;
    px += Math.cos(h) * 25;
    pz += Math.sin(h) * 25;
    ctrl.push(px, pz);
  }
  // Finish exactly on the nearest point of the road it reached.
  const hit = builder.index.nearest(px, pz, 80, (owner) => owner === from);
  if (!hit) return;
  ctrl.push(hit.x, hit.z);
  const pts = smoothCurve(ctrl, 8);
  builder.add('rural', pts);
  builder.attach(hit.edge, hit.seg, hit.t);
  raster.markPolyline(pts, ROAD_SPECS.rural.width / 2 + 4, CELL_ROAD);
}
