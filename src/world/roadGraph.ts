import { ROAD_SPECS, type StreetEdge, type StreetNet, type StreetNode } from './streets';

// Lanes and turns for traffic, on top of the street network (streets.ts). Traffic drives on
// the right.
//
// A car's route is a chain of "pieces", each a polyline in the world:
//   lane — along one edge in one direction, `LANE_OFFSET` right of the centre line, from just
//          after the junction at its start to just before the one at its end;
//   turn — a cubic Bézier through a junction from the end of one lane to the start of the
//          next (straight on, left, right, or a U-turn round a cul-de-sac or at a dead end).
//
// Multi-lane roads (arterials, downtown) have two lanes each way: a lane piece follows the
// inner lane and cars carry a lateral offset from it (0 = inner, LANE_SPACING = outer). On a
// one-lane road an overtaking car moves to −LANE_SPACING, the oncoming lane. Turn pieces are
// built between given lane offsets.
//
// Pieces are built on demand and cached, so cars on the same piece hold the same object and
// "is that car on my lane?" is an identity check. Each piece also stores a curvature speed
// limit every few metres, v = √(a_lat / κ).

export const LANE_OFFSET = 1.75; // m from the centre line to the inner lane's centre
/** Lateral offset of the outer (right) lane from the inner one on multi-lane roads, m. */
export const LANE_SPACING = 3.5;
/** Comfortable sideways acceleration on curves (m/s², ≈ 0.3 g). */
const A_LAT = 3.0;

export interface Piece {
  kind: 'lane' | 'turn';
  /** x, z pairs along the piece. */
  pts: Float32Array;
  /** Distance along the piece at each point. */
  cum: Float32Array;
  length: number;
  /** Lane: the edge and direction (+1 a → b, −1 b → a). Turn: the edge it leads onto. */
  edge: number;
  dir: 1 | -1;
  /** The junction at the end of a lane, or the one a turn crosses. */
  node: number;
  /** Turns: the lane it comes from and the lane it leads to. */
  from: Piece | null;
  to: Piece | null;
  /** Turns: lateral offsets (m, + = right) of the lanes it joins, relative to their inner lanes. */
  offIn: number;
  offOut: number;
  /** Lanes each way on this road (turns: on the road it leads onto). */
  lanes: number;
  /** One lane each way, out of town: overtaking through the oncoming lane allowed. */
  rural: boolean;
  /** Speed limit (m/s) and importance (smaller roads give way). */
  speed: number;
  rank: number;
  /** Curvature speed limit every `limitStep` m. */
  limits: Float32Array;
  limitStep: number;
  /** Direction of travel (unit) at the start and the end. */
  startDir: [number, number];
  endDir: [number, number];
}

export type TurnKind = 'right' | 'left' | 'straight' | 'uturn';

/** Left/right/straight/U from the heading in and the heading out. */
export function turnKind(a: [number, number], b: [number, number]): TurnKind {
  const dot = a[0] * b[0] + a[1] * b[1];
  // The right of +X is +Z, so a positive cross product (a × b)·y… here a.x·b.z − a.z·b.x > 0
  // means turning toward the right.
  const cross = a[0] * b[1] - a[1] * b[0];
  const angle = Math.atan2(cross, dot);
  if (Math.abs(angle) < 0.6) return 'straight';
  if (Math.abs(angle) > 2.5) return 'uturn';
  return angle > 0 ? 'right' : 'left';
}

export class RoadGraph {
  private readonly cache = new Map<string, Piece>();
  /** Lights: which phase group each approach (edge, arriving direction) is in. */
  private readonly phase = new Map<string, number>();

  constructor(readonly net: StreetNet) {
    // Group each lit junction's approaches into two phases: those roughly along the first
    // road's axis, and the rest.
    for (const n of net.nodes) {
      if (n.control !== 'lights') continue;
      const axes = n.edges.map((e) => this.axisAt(net.edges[e], n.id));
      const ref = axes[0];
      n.edges.forEach((e, i) => {
        let d = Math.abs(axes[i] - ref) % Math.PI;
        if (d > Math.PI / 2) d = Math.PI - d;
        this.phase.set(`${e},${n.id}`, d < Math.PI / 4 ? 0 : 1);
      });
    }
  }

  get nodes(): StreetNode[] {
    return this.net.nodes;
  }

  /** Angle of an edge's direction where it leaves a node. */
  private axisAt(e: StreetEdge, node: number): number {
    const p = e.pts;
    const n = p.length / 2;
    if (e.a === node) return Math.atan2(p[3] - p[1], p[2] - p[0]);
    return Math.atan2(p[(n - 2) * 2 + 1] - p[(n - 1) * 2 + 1], p[(n - 2) * 2] - p[(n - 1) * 2]);
  }

  /** How far back from a node lanes stop (inside the junction is the turn). */
  private trim(nodeId: number): number {
    const n = this.net.nodes[nodeId];
    if (n.bulb) return n.bulb * 0.8;
    let hw = 0;
    for (const e of n.edges) hw = Math.max(hw, this.net.halfWidth(this.net.edges[e]));
    if (n.edges.length >= 3) return hw + 1.2;
    if (n.edges.length === 1) return 3;
    return 2; // a plain bend or a change of road class: a short join
  }

  hasLights(node: number): boolean {
    return this.net.nodes[node].control === 'lights';
  }

  /** A stop-controlled junction where this lane's road is the smaller one (or all are equal). */
  mustStop(lane: Piece): boolean {
    const n = this.net.nodes[lane.node];
    if (n.control !== 'stop') return false;
    let max = 0;
    let count = 0;
    for (const e of n.edges) {
      const r = ROAD_SPECS[this.net.edges[e].cls].rank;
      if (r > max) {
        max = r;
        count = 1;
      } else if (r === max) count++;
    }
    // The biggest road has priority, unless several roads share the top rank and this is
    // a three-or-more-way meeting of equals (an all-way stop).
    return lane.rank < max || (count === n.edges.length && n.edges.length >= 3 && lane.rank < 3);
  }

  /** Lit phase of a lane arriving at its junction: 'green', 'yellow' or 'red'. */
  lightState(lane: Piece, time: number): Light {
    const n = this.net.nodes[lane.node];
    const group = this.phase.get(`${lane.edge},${lane.node}`) ?? 0;
    return lightPhase(group, n.id, time);
  }

  /** Lane along `edge` in direction `dir` (null if the edge is too short for one). */
  lane(edgeId: number, dir: 1 | -1): Piece {
    const key = `l${edgeId},${dir}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const e = this.net.edges[edgeId];
    const spec = ROAD_SPECS[e.cls];
    // Centre line in the direction of travel, offset right by LANE_OFFSET.
    const src = e.pts;
    const n = src.length / 2;
    const pts: number[] = [];
    const at = (i: number) => (dir === 1 ? i : n - 1 - i);
    for (let i = 0; i < n; i++) {
      const k = at(i);
      const kp = at(Math.max(0, i - 1));
      const kn = at(Math.min(n - 1, i + 1));
      let tx = src[kn * 2] - src[kp * 2];
      let tz = src[kn * 2 + 1] - src[kp * 2 + 1];
      const l = Math.hypot(tx, tz) || 1;
      tx /= l;
      tz /= l;
      // Right of travel: (−tz, tx).
      pts.push(src[k * 2] - tz * LANE_OFFSET, src[k * 2 + 1] + tx * LANE_OFFSET);
    }
    const startNode = dir === 1 ? e.a : e.b;
    const endNode = dir === 1 ? e.b : e.a;
    const trimmed = trimPolyline(pts, this.trim(startNode), this.trim(endNode));
    const piece = finish({
      kind: 'lane',
      pts: new Float32Array(trimmed),
      cum: new Float32Array(0),
      length: 0,
      edge: edgeId,
      dir,
      node: endNode,
      from: null,
      to: null,
      offIn: 0,
      offOut: 0,
      lanes: spec.lanes,
      rural: e.cls === 'rural',
      speed: spec.speed,
      rank: spec.rank,
      limits: new Float32Array(0),
      limitStep: 6,
      startDir: [1, 0],
      endDir: [1, 0],
    });
    this.cache.set(key, piece);
    return piece;
  }

  /** The lane on the same edge in the other direction. */
  reverse(lane: Piece): Piece {
    return this.lane(lane.edge, lane.dir === 1 ? -1 : 1);
  }

  /** Lanes a car arriving on `lane` may leave by (a U-turn only at dead ends and cul-de-sacs). */
  exits(lane: Piece): Piece[] {
    const n = this.net.nodes[lane.node];
    const out: Piece[] = [];
    for (const e of n.edges) {
      if (e === lane.edge) continue;
      const edge = this.net.edges[e];
      out.push(this.lane(e, edge.a === n.id ? 1 : -1));
    }
    if (!out.length) out.push(this.reverse(lane));
    return out;
  }

  /** Lanes arriving at the same junction as `lane` (other than it). */
  approaches(lane: Piece): Piece[] {
    const n = this.net.nodes[lane.node];
    const out: Piece[] = [];
    for (const e of n.edges) {
      if (e === lane.edge) continue;
      const edge = this.net.edges[e];
      out.push(this.lane(e, edge.b === n.id ? 1 : -1));
    }
    return out;
  }

  /**
   * Path through the junction at the end of `from` onto `to`, from `offIn` m right of
   * `from`'s inner lane to `offOut` m right of `to`'s.
   */
  turn(from: Piece, to: Piece, offIn = 0, offOut = 0): Piece {
    const key = `t${from.edge},${from.dir},${to.edge},${to.dir},${offIn},${offOut}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const [ix, iz] = from.endDir;
    const [ox, oz] = to.startDir;
    const fp = from.pts;
    const p0x = fp[fp.length - 2] - iz * offIn;
    const p0z = fp[fp.length - 1] + ix * offIn;
    const p2x = to.pts[0] - oz * offOut;
    const p2z = to.pts[1] + ox * offOut;
    const gap = Math.hypot(p2x - p0x, p2z - p0z);
    const kind = turnKind(from.endDir, to.startDir);
    // Control points along the lanes' own directions, so the heading is continuous. For a
    // U-turn, loop out wide enough to swing round (the cul-de-sac's circle).
    const node = this.net.nodes[from.node];
    const k = kind === 'uturn' ? Math.max(4, node.bulb * 1.3, 5) : Math.max(1.5, gap * 0.45);
    const c1x = p0x + ix * k;
    const c1z = p0z + iz * k;
    const c2x = p2x - ox * k;
    const c2z = p2z - oz * k;
    const pts: number[] = [];
    const N = 14;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const u = 1 - t;
      const a = u * u * u;
      const b = 3 * u * u * t;
      const c = 3 * u * t * t;
      const d = t * t * t;
      pts.push(a * p0x + b * c1x + c * c2x + d * p2x, a * p0z + b * c1z + c * c2z + d * p2z);
    }
    const piece = finish({
      kind: 'turn',
      pts: new Float32Array(pts),
      cum: new Float32Array(0),
      length: 0,
      edge: to.edge,
      dir: to.dir,
      node: from.node,
      from,
      to,
      offIn,
      offOut,
      lanes: to.lanes,
      rural: to.rural,
      speed: Math.min(from.speed, to.speed),
      rank: from.rank,
      limits: new Float32Array(0),
      limitStep: 1.5,
      startDir: [1, 0],
      endDir: [1, 0],
    });
    this.cache.set(key, piece);
    return piece;
  }
}

/** Arc lengths, end directions and curvature speed limits for a new piece. */
function finish(p: Piece): Piece {
  const pts = p.pts;
  const n = pts.length / 2;
  const cum = new Float32Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
  p.cum = cum;
  p.length = Math.max(0.1, cum[n - 1]);
  const dir = (i0: number, i1: number): [number, number] => {
    const dx = pts[i1 * 2] - pts[i0 * 2];
    const dz = pts[i1 * 2 + 1] - pts[i0 * 2 + 1];
    const l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  };
  p.startDir = dir(0, Math.min(1, n - 1));
  p.endDir = dir(Math.max(0, n - 2), n - 1);
  // Curvature from the circle through three points `step` apart: κ = 2·|AB × BC| / (|AB|·|BC|·|AC|).
  const steps = Math.max(1, Math.ceil(p.length / p.limitStep));
  p.limitStep = p.length / steps;
  const limits = new Float32Array(steps + 1);
  const P = { x: 0, z: 0, tx: 0, tz: 0 };
  const sample = (s: number): [number, number] => {
    pieceAt(p, s, P);
    // Past the ends, carry on along the end directions.
    if (s < 0) return [P.x + P.tx * s, P.z + P.tz * s];
    if (s > p.length) return [P.x + P.tx * (s - p.length), P.z + P.tz * (s - p.length)];
    return [P.x, P.z];
  };
  for (let i = 0; i <= steps; i++) {
    const s = i * p.limitStep;
    const [ax, az] = sample(s - p.limitStep);
    const [bx, bz] = sample(s);
    const [cx, cz] = sample(s + p.limitStep);
    const abx = bx - ax;
    const abz = bz - az;
    const bcx = cx - bx;
    const bcz = cz - bz;
    const cross = Math.abs(abx * bcz - abz * bcx);
    const kappa = (2 * cross) / (Math.hypot(abx, abz) * Math.hypot(bcx, bcz) * Math.hypot(cx - ax, cz - az) + 1e-9);
    limits[i] = Math.max(2.2, Math.sqrt(A_LAT / Math.max(kappa, 1e-6)));
  }
  p.limits = limits;
  return p;
}

/** Point and unit direction at distance s along a piece (clamped to its ends). */
export function pieceAt(p: Piece, s: number, out: { x: number; z: number; tx: number; tz: number }): typeof out {
  const cum = p.cum;
  const n = cum.length;
  const d = Math.max(0, Math.min(p.length, s));
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid;
    else hi = mid;
  }
  const pts = p.pts;
  const seg = cum[hi] - cum[lo] || 1;
  const t = Math.max(0, Math.min(1, (d - cum[lo]) / seg));
  const dx = pts[hi * 2] - pts[lo * 2];
  const dz = pts[hi * 2 + 1] - pts[lo * 2 + 1];
  const l = Math.hypot(dx, dz) || 1;
  out.x = pts[lo * 2] + dx * t;
  out.z = pts[lo * 2 + 1] + dz * t;
  out.tx = dx / l;
  out.tz = dz / l;
  return out;
}

/** Cut `a` metres off the start and `b` off the end of a polyline (keeps at least a stub). */
function trimPolyline(pts: number[], a: number, b: number): number[] {
  const n = pts.length / 2;
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]));
  const len = cum[n - 1];
  if (a + b > len - 1) {
    // A very short edge: keep its middle metre.
    const m = (a / (a + b || 1)) * len;
    a = Math.max(0, m - 0.5);
    b = Math.max(0, len - m - 0.5);
  }
  const at = (s: number): [number, number] => {
    let i = 1;
    while (i < n - 1 && cum[i] < s) i++;
    const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return [pts[(i - 1) * 2] + (pts[i * 2] - pts[(i - 1) * 2]) * t, pts[(i - 1) * 2 + 1] + (pts[i * 2 + 1] - pts[(i - 1) * 2 + 1]) * t];
  };
  const out: number[] = [...at(a)];
  for (let i = 0; i < n; i++) if (cum[i] > a && cum[i] < len - b) out.push(pts[i * 2], pts[i * 2 + 1]);
  out.push(...at(len - b));
  return out;
}

// --- Traffic lights. Each lit junction alternates its two phase groups, with a
// per-junction time offset so lights along a street are staggered ("green wave").

const CYCLE = 24; // s
export type Light = 'green' | 'yellow' | 'red';

export function lightPhase(group: number, node: number, time: number): Light {
  const t = (((time + node * 3.7) % CYCLE) + CYCLE) % CYCLE;
  // Group 0: green 0–9, yellow 9–11.5. Group 1: green 12–21, yellow 21–23.5. The half-second
  // gaps are all-red so the junction clears.
  const green = group === 0 ? 0 : 12;
  if (t >= green && t < green + 9) return 'green';
  if (t >= green + 9 && t < green + 11.5) return 'yellow';
  return 'red';
}
