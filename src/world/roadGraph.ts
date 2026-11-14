import * as THREE from 'three';
import { ROAD_WIDTH, type CityLayout } from './layout';

// Road graph for traffic. The road grid's intersections are the nodes (i, j); each road
// segment between neighbouring intersections carries one inner lane per direction
// (traffic drives on the right; the outer lanes are parking lanes).
//
// A car's route is a chain of "pieces":
//   lane — straight, from the far edge of one intersection to the near edge of the next;
//   turn — a quadratic Bézier through the intersection, from the end of one lane to the
//          start of the next (straight on, left or right).

export const LANE_OFFSET = 1.75; // m from the road centre line to the inner lane centre
const HALF = ROAD_WIDTH / 2; // intersections are ROAD_WIDTH × ROAD_WIDTH squares

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
  p0: THREE.Vector3;
  p1: THREE.Vector3; // Bézier control point (midpoint for straight pieces)
  p2: THREE.Vector3;
  length: number;
  /** For lanes: the intersection at the end and the direction of travel. */
  toI: number;
  toJ: number;
  dir: Dir;
}

export class RoadGraph {
  readonly lines: number[];
  readonly size: number;

  constructor(layout: CityLayout) {
    this.lines = layout.roadLines;
    this.size = this.lines.length;
  }

  node(i: number, j: number): THREE.Vector3 {
    return new THREE.Vector3(this.lines[i], 0, this.lines[j]);
  }

  /** The neighbouring intersection in direction d, or null at the edge of the city. */
  neighbor(i: number, j: number, d: Dir): [number, number] | null {
    const ni = i + DX[d];
    const nj = j + DZ[d];
    if (ni < 0 || nj < 0 || ni >= this.size || nj >= this.size) return null;
    return [ni, nj];
  }

  /** Straight lane from intersection (i, j) toward its neighbour in direction d. */
  lane(i: number, j: number, d: Dir): Piece | null {
    const next = this.neighbor(i, j, d);
    if (!next) return null;
    const fwd = dirVector(d);
    const side = rightOf(d).multiplyScalar(LANE_OFFSET);
    const p0 = this.node(i, j).addScaledVector(fwd, HALF).add(side);
    const p2 = this.node(next[0], next[1]).addScaledVector(fwd, -HALF).add(side);
    return {
      kind: 'lane',
      p0,
      p1: p0.clone().lerp(p2, 0.5),
      p2,
      length: p0.distanceTo(p2),
      toI: next[0],
      toJ: next[1],
      dir: d,
    };
  }

  /** Path through intersection (i, j), from arriving in direction `from` to leaving in `to`. */
  turn(i: number, j: number, from: Dir, to: Dir): Piece {
    const centre = this.node(i, j);
    const p0 = centre.clone().addScaledVector(dirVector(from), -HALF).add(rightOf(from).multiplyScalar(LANE_OFFSET));
    const p2 = centre.clone().addScaledVector(dirVector(to), HALF).add(rightOf(to).multiplyScalar(LANE_OFFSET));
    // Control point where the incoming and outgoing lane lines cross (a corner);
    // going straight on, just the midpoint.
    let p1: THREE.Vector3;
    if (from === to) p1 = p0.clone().lerp(p2, 0.5);
    else if (DX[from] !== 0) p1 = new THREE.Vector3(p2.x, 0, p0.z);
    else p1 = new THREE.Vector3(p0.x, 0, p2.z);
    return { kind: 'turn', p0, p1, p2, length: bezierLength(p0, p1, p2), toI: i, toJ: j, dir: to };
  }

  /** Directions a car arriving at (i, j) travelling in `from` may leave by (no U-turns). */
  exits(i: number, j: number, from: Dir): Dir[] {
    const back = ((from + 2) % 4) as Dir;
    return DIRS.filter((d) => d !== back && this.neighbor(i, j, d) !== null);
  }
}

export function bezierPoint(p: Piece, t: number, out: THREE.Vector3): THREE.Vector3 {
  const u = 1 - t;
  return out
    .copy(p.p0)
    .multiplyScalar(u * u)
    .addScaledVector(p.p1, 2 * u * t)
    .addScaledVector(p.p2, t * t);
}

/** Direction of travel along the piece at parameter t (unnormalised derivative). */
export function bezierTangent(p: Piece, t: number, out: THREE.Vector3): THREE.Vector3 {
  // d/dt of the quadratic Bézier: 2(1−t)(p1−p0) + 2t(p2−p1).
  return out
    .copy(p.p1)
    .sub(p.p0)
    .multiplyScalar(2 * (1 - t))
    .addScaledVector(new THREE.Vector3().subVectors(p.p2, p.p1), 2 * t);
}

function bezierLength(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3): number {
  const piece = { p0, p1, p2 } as Piece;
  let len = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  bezierPoint(piece, 0, a);
  for (let k = 1; k <= 16; k++) {
    bezierPoint(piece, k / 16, b);
    len += a.distanceTo(b);
    a.copy(b);
  }
  return len;
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
