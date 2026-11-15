import * as THREE from 'three';
import { CELLS, lineCoord, type CityLayout, type RoadNet } from './layout';

// Road graph for traffic. The road grid's intersections are the nodes (i, j). Pieces are
// laid out on the grid (layout space) and bent into the world by the road warp (warp.ts)
// when a car is placed. Traffic drives on the right. Town roads have two lanes each way:
// a piece follows the inner lane line and cars carry a lateral offset from it (0 = inner,
// LANE_SPACING = outer). Country roads have one lane each way (offset 0); an overtaking car
// moves to −LANE_SPACING, the oncoming lane.
//
// A car's route is a chain of "pieces":
//   lane — straight on the grid, from the far edge of one intersection to the near edge of
//          the next (the warp makes it gently curvy in the world);
//   turn — a cubic Bézier through the intersection, from the end of one lane to the start
//          of the next (straight on, left, right or a U-turn), between given lane offsets.

export const LANE_OFFSET = 1.75; // m from the road centre line to the inner lane centre

/** 0 = +X, 1 = +Z, 2 = −X, 3 = −Z. */
export type Dir = 0 | 1 | 2 | 3;
export const DIRS: Dir[] = [0, 1, 2, 3];
const DX = [1, 0, -1, 0];
const DZ = [0, 1, 0, -1];

export function dirVector(d: Dir): THREE.Vector3 {
  return new THREE.Vector3(DX[d], 0, DZ[d]);
}

/** The side traffic keeps to: forward (dx, dz) rotated 90° clockwise seen from above. */
function rightOf(d: Dir): THREE.Vector3 {
  return new THREE.Vector3(-DZ[d], 0, DX[d]);
}

export function isNorthSouth(d: Dir): boolean {
  return d === 1 || d === 3;
}

export interface Piece {
  kind: 'lane' | 'turn';
  /** Cubic Bézier on the grid (layout space): p0 → p2 with control points c1, c2. */
  p0: THREE.Vector3;
  c1: THREE.Vector3;
  c2: THREE.Vector3;
  p2: THREE.Vector3;
  length: number;
  /** For lanes: the intersection at the end. For turns: the intersection it crosses. */
  toI: number;
  toJ: number;
  /** Direction of travel at the end of the piece. */
  dir: Dir;
  /** Direction of travel at the start (same as `dir` for lanes). */
  from: Dir;
  /** Turns: lateral offsets (m, + = right) of the lanes it joins, relative to the inner lane. */
  offIn: number;
  offOut: number;
  /** Country road: higher cruise speed, one lane each way. */
  rural: boolean;
  /**
   * Curvature speed limit (m/s) every `limitStep` m along the piece, measured in the world
   * (so the road warp's bends count): v = √(a_lat / κ), the speed at which the sideways
   * acceleration on a curve of curvature κ is a comfortable a_lat.
   */
  limits: Float32Array;
  limitStep: number;
}

/** Comfortable sideways acceleration on curves (m/s², ≈ 0.3 g). */
const A_LAT = 3.0;
/** Lateral offset of the outer (right) lane from the inner one on town roads, m. */
export const LANE_SPACING = 3.5;

export class RoadGraph {
  /** Grid lines per side: nodes are (i, j) for i, j in 0…size−1. */
  readonly size = CELLS + 1;
  private readonly roads: RoadNet;
  private readonly layout: CityLayout;
  /**
   * Pieces are deterministic, so they're built once and shared: two cars on the same piece
   * hold the same object, which makes "is that car in my lane?" an identity check.
   */
  private readonly cache = new Map<string, Piece>();

  constructor(layout: CityLayout) {
    this.layout = layout;
    this.roads = layout.roads;
  }
  node(i: number, j: number): THREE.Vector3 {
    return new THREE.Vector3(lineCoord(i), 0, lineCoord(j));
  }

  /** Unsignalled crossing where 3+ roads meet (country junctions): cars give way here. */
  isJunction(i: number, j: number): boolean {
    if (this.roads.hasLights(i, j)) return false;
    return DIRS.filter((d) => this.hasRoad(i, j, d)).length >= 3;
  }

  /** Is there a road from (i, j) in direction d? */
  hasRoad(i: number, j: number, d: Dir): boolean {
    switch (d) {
      case 0:
        return this.roads.hasH(i, j);
      case 2:
        return this.roads.hasH(i - 1, j);
      case 1:
        return this.roads.hasV(i, j);
      default:
        return this.roads.hasV(i, j - 1);
    }
  }

  /** Country road (faster, no lights) from (i, j) in direction d. */
  isRural(i: number, j: number, d: Dir): boolean {
    switch (d) {
      case 0:
        return this.roads.ruralH(i, j);
      case 2:
        return this.roads.ruralH(i - 1, j);
      case 1:
        return this.roads.ruralV(i, j);
      default:
        return this.roads.ruralV(i, j - 1);
    }
  }

  /** Half the size of the intersection square at (i, j). */
  nodeHalf(i: number, j: number): number {
    return this.roads.nodeHalf(i, j);
  }

  hasLights(i: number, j: number): boolean {
    return this.roads.hasLights(i, j);
  }

  /** The neighbouring intersection in direction d, or null if no road goes that way. */
  neighbor(i: number, j: number, d: Dir): [number, number] | null {
    if (!this.hasRoad(i, j, d)) return null;
    return [i + DX[d], j + DZ[d]];
  }

  /** Straight lane (inner lane line) from intersection (i, j) toward its neighbour in direction d. */
  lane(i: number, j: number, d: Dir): Piece | null {
    const key = `l${i},${j},${d}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const next = this.neighbor(i, j, d);
    if (!next) return null;
    const fwd = dirVector(d);
    const side = rightOf(d).multiplyScalar(LANE_OFFSET);
    const p0 = this.node(i, j).addScaledVector(fwd, this.roads.nodeHalf(i, j)).add(side);
    const p2 = this.node(next[0], next[1]).addScaledVector(fwd, -this.roads.nodeHalf(next[0], next[1])).add(side);
    const piece = this.finish({
      kind: 'lane',
      p0,
      c1: p0.clone().lerp(p2, 1 / 3),
      c2: p0.clone().lerp(p2, 2 / 3),
      p2,
      length: 0,
      toI: next[0],
      toJ: next[1],
      dir: d,
      from: d,
      offIn: 0,
      offOut: 0,
      rural: this.isRural(i, j, d),
      limits: new Float32Array(0),
      limitStep: 6,
    });
    this.cache.set(key, piece);
    return piece;
  }

  /**
   * Path through intersection (i, j), from arriving in direction `from` to leaving in `to`,
   * from the lane `offIn` m right of the inner lane to the one `offOut` m right of it.
   * `to` = the opposite of `from` is a U-turn (only used at dead ends).
   */
  turn(i: number, j: number, from: Dir, to: Dir, offIn = 0, offOut = 0): Piece {
    const key = `t${i},${j},${from},${to},${offIn},${offOut}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const centre = this.node(i, j);
    const half = this.roads.nodeHalf(i, j);
    const fin = dirVector(from);
    const fout = dirVector(to);
    const p0 = centre.clone().addScaledVector(fin, -half).add(rightOf(from).multiplyScalar(LANE_OFFSET + offIn));
    const p2 = centre.clone().addScaledVector(fout, half).add(rightOf(to).multiplyScalar(LANE_OFFSET + offOut));
    let c1: THREE.Vector3;
    let c2: THREE.Vector3;
    if (from === to) {
      c1 = p0.clone().lerp(p2, 1 / 3);
      c2 = p0.clone().lerp(p2, 2 / 3);
    } else if ((from + 2) % 4 === to) {
      // U-turn: loop out across the intersection.
      c1 = p0.clone().addScaledVector(fin, half * 1.6);
      c2 = p2.clone().addScaledVector(fout, -half * 1.6);
    } else {
      // A corner: the incoming and outgoing lane lines cross at q. Control points 0.55 of
      // the way to q make (nearly) a circular arc, and keep the heading continuous with
      // the lanes at both ends.
      const q = DX[from] !== 0 ? new THREE.Vector3(p2.x, 0, p0.z) : new THREE.Vector3(p0.x, 0, p2.z);
      c1 = p0.clone().lerp(q, 0.55);
      c2 = p2.clone().lerp(q, 0.55);
    }
    const piece = this.finish({
      kind: 'turn',
      p0,
      c1,
      c2,
      p2,
      length: 0,
      toI: i,
      toJ: j,
      dir: to,
      from,
      offIn,
      offOut,
      rural: !this.roads.townNode(i, j),
      limits: new Float32Array(0),
      limitStep: 1.5,
    });
    this.cache.set(key, piece);
    return piece;
  }

  /** Measure a new piece: its length and its curvature speed limits through the warp. */
  private finish(piece: Piece): Piece {
    // Length: sum of chords over 24 steps (plenty for these gentle curves).
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    bezierPoint(piece, 0, a);
    let len = 0;
    for (let k = 1; k <= 24; k++) {
      bezierPoint(piece, k / 24, b);
      len += a.distanceTo(b);
      a.copy(b);
    }
    piece.length = len;
    // Curvature from the circle through three consecutive world points:
    // κ = 2·|AB × BC| / (|AB|·|BC|·|AC|).
    const n = Math.max(2, Math.ceil(len / piece.limitStep));
    const world: { x: number; z: number }[] = [];
    // Extend one sample beyond each end so the ends get a curvature too.
    for (let k = -1; k <= n + 1; k++) {
      const t = Math.min(1, Math.max(0, k / n));
      bezierPoint(piece, t, a);
      // Past the ends, carry on along the end tangent.
      if (k < 0 || k > n) a.addScaledVector(bezierTangent(piece, t, b).normalize(), (k < 0 ? -1 : 1) * piece.limitStep);
      const w = this.layout.warp.forward(a.x, a.z);
      world.push({ x: w.x, z: w.z });
    }
    const limits = new Float32Array(n + 1);
    for (let k = 0; k <= n; k++) {
      const A = world[k];
      const B = world[k + 1];
      const C = world[k + 2];
      const abx = B.x - A.x;
      const abz = B.z - A.z;
      const bcx = C.x - B.x;
      const bcz = C.z - B.z;
      const cross = Math.abs(abx * bcz - abz * bcx);
      const kappa = (2 * cross) / (Math.hypot(abx, abz) * Math.hypot(bcx, bcz) * Math.hypot(C.x - A.x, C.z - A.z) + 1e-9);
      limits[k] = Math.max(2.2, Math.sqrt(A_LAT / Math.max(kappa, 1e-6)));
    }
    piece.limits = limits;
    piece.limitStep = len / n;
    return piece;
  }

  /** Directions a car arriving at (i, j) travelling in `from` may leave by (a U-turn only at dead ends). */
  exits(i: number, j: number, from: Dir): Dir[] {
    const back = ((from + 2) % 4) as Dir;
    const out = DIRS.filter((d) => d !== back && this.hasRoad(i, j, d));
    return out.length ? out : [back];
  }
}

/** 'right', 'left', 'straight' or 'uturn' for a turn from `from` to `to`. */
export function turnKind(from: Dir, to: Dir): 'right' | 'left' | 'straight' | 'uturn' {
  if (from === to) return 'straight';
  if ((from + 1) % 4 === to) return 'right'; // the right of +X is +Z (dir 1)
  if ((from + 3) % 4 === to) return 'left';
  return 'uturn';
}

export function bezierPoint(p: Piece, t: number, out: THREE.Vector3): THREE.Vector3 {
  const u = 1 - t;
  return out
    .copy(p.p0)
    .multiplyScalar(u * u * u)
    .addScaledVector(p.c1, 3 * u * u * t)
    .addScaledVector(p.c2, 3 * u * t * t)
    .addScaledVector(p.p2, t * t * t);
}

/** Direction of travel along the piece at parameter t (unnormalised derivative). */
export function bezierTangent(p: Piece, t: number, out: THREE.Vector3): THREE.Vector3 {
  // d/dt of the cubic Bézier: 3(1−t)²(c1−p0) + 6(1−t)t(c2−c1) + 3t²(p2−c2).
  const u = 1 - t;
  const a = 3 * u * u;
  const b = 6 * u * t;
  const c = 3 * t * t;
  return out.set(
    a * (p.c1.x - p.p0.x) + b * (p.c2.x - p.c1.x) + c * (p.p2.x - p.c2.x),
    0,
    a * (p.c1.z - p.p0.z) + b * (p.c2.z - p.c1.z) + c * (p.p2.z - p.c2.z),
  );
}

// --- Traffic lights. Each intersection alternates north–south and east–west green, with a
// per-intersection time offset so lights along a street are staggered ("green wave").

const CYCLE = 24; // s
export type Light = 'green' | 'yellow' | 'red';

export function lightState(i: number, j: number, d: Dir, time: number): Light {
  const t = (((time + (i * 7 + j * 3)) % CYCLE) + CYCLE) % CYCLE;
  // North–south: green 0–9, yellow 9–11.5. East–west: green 12–21, yellow 21–23.5.
  // The half-second gaps are all-red so the intersection clears.
  const [green, yellow] = isNorthSouth(d) ? [0, 9] : [12, 21];
  if (t >= green && t < green + 9) return 'green';
  if (t >= yellow && t < yellow + 2.5) return 'yellow';
  return 'red';
}
