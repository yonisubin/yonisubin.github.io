import { pieceAt, type Piece, type RoadGraph } from '../world/roadGraph';
import type { Rng } from './rng';

// A route as one polyline in the right-hand lane: a chain of the road graph's lane and turn
// pieces (world/roadGraph.ts) joined end to end. The driver is told the route, never how to
// steer: progress is measured by projecting the car onto this line.

export interface StopLine {
  /** Distance along the path of the end of the lane (where you wait). */
  s: number;
  /** The lane arriving at the lit junction (for RoadGraph.lightState). */
  lane: Piece;
}

const tmp = { x: 0, z: 0, tx: 0, tz: 0 };

export class Path {
  readonly pts: Float32Array;
  readonly cum: Float32Array;
  readonly length: number;
  /** Road speed limit at each point, m/s. */
  readonly limit: Float32Array;
  /** Curvature speed limit at each point (v = √(a_lat/κ)), m/s. */
  readonly curve: Float32Array;
  readonly stops: StopLine[];
  /** Number of turn pieces (junctions crossed). */
  readonly turns: number;

  constructor(readonly pieces: Piece[], graph: RoadGraph) {
    const xs: number[] = [];
    const lim: number[] = [];
    const curve: number[] = [];
    const stops: StopLine[] = [];
    let s = 0;
    let turns = 0;
    for (const p of pieces) {
      if (p.kind === 'turn') turns++;
      const n = p.pts.length / 2;
      for (let i = 0; i < n; i++) {
        const x = p.pts[i * 2];
        const z = p.pts[i * 2 + 1];
        if (xs.length) {
          const d = Math.hypot(x - xs[xs.length - 2], z - xs[xs.length - 1]);
          if (d < 0.05) continue; // the shared point where two pieces join
          s += d;
        }
        xs.push(x, z);
        lim.push(p.speed);
        const k = Math.min(p.limits.length - 1, Math.round(p.cum[i] / p.limitStep));
        curve.push(p.limits[k]);
      }
      if (p.kind === 'lane' && graph.hasLights(p.node) && p !== pieces[pieces.length - 1]) stops.push({ s, lane: p });
    }
    this.pts = new Float32Array(xs);
    const n = xs.length / 2;
    this.cum = new Float32Array(n);
    for (let i = 1; i < n; i++) this.cum[i] = this.cum[i - 1] + Math.hypot(xs[i * 2] - xs[i * 2 - 2], xs[i * 2 + 1] - xs[i * 2 - 1]);
    this.length = this.cum[n - 1];
    this.limit = new Float32Array(lim);
    this.curve = new Float32Array(curve);
    this.stops = stops;
    this.turns = turns;
  }

  /** Index of the point at or before distance s. */
  index(s: number): number {
    const cum = this.cum;
    let lo = 0;
    let hi = cum.length - 1;
    if (s <= 0) return 0;
    if (s >= cum[hi]) return hi - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** Point and unit tangent at distance s (extrapolated straight past the ends). */
  at(s: number, out = tmp): typeof tmp {
    const i = this.index(s);
    const p = this.pts;
    const dx = p[i * 2 + 2] - p[i * 2];
    const dz = p[i * 2 + 3] - p[i * 2 + 1];
    const l = Math.hypot(dx, dz) || 1;
    const t = s - this.cum[i];
    out.tx = dx / l;
    out.tz = dz / l;
    out.x = p[i * 2] + out.tx * t;
    out.z = p[i * 2 + 1] + out.tz * t;
    return out;
  }

  /** Lowest curvature limit between s and s + ahead. */
  curveLimit(s: number, ahead: number): number {
    let v = Infinity;
    const i0 = this.index(s);
    const i1 = this.index(s + ahead) + 1;
    for (let i = i0; i <= i1 && i < this.curve.length; i++) v = Math.min(v, this.curve[i]);
    return v;
  }

  /**
   * Project (x, z) onto the path, searching near the previous projection `hint` (so a route
   * that loops back past itself can't make the car jump ahead). Returns s and the signed
   * lateral offset (+ = right of travel).
   */
  project(x: number, z: number, hint: number, out: { s: number; lat: number }): typeof out {
    const p = this.pts;
    const n = p.length / 2;
    const i0 = Math.max(0, this.index(hint - 10));
    const i1 = Math.min(n - 2, this.index(hint + 40) + 1);
    let best = Infinity;
    for (let i = i0; i <= i1; i++) {
      const ax = p[i * 2];
      const az = p[i * 2 + 1];
      const dx = p[i * 2 + 2] - ax;
      const dz = p[i * 2 + 3] - az;
      const l2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      const qx = ax + dx * t;
      const qz = az + dz * t;
      const d2 = (x - qx) ** 2 + (z - qz) ** 2;
      if (d2 < best) {
        best = d2;
        const l = Math.sqrt(l2);
        out.s = this.cum[i] + t * l;
        // Right of travel is (−tz, tx).
        out.lat = ((x - qx) * -dz + (z - qz) * dx) / l;
      }
    }
    return out;
  }
}

export interface RouteOptions {
  /** Target length, m. */
  length: number;
  /** Most junctions to cross (0 = one lane only). */
  maxTurns: number;
  /** Start somewhere inside this test (e.g. not in the held-out area). */
  startOk?: (x: number, z: number) => boolean;
  /** Start near this point (within `radius` m). */
  near?: { x: number; z: number; radius: number };
}

/**
 * A random route: a random lane to start, then a random exit at each junction (no U-turns
 * unless it's a dead end) until it's long enough. Random routes over the whole city are the
 * "random start, random destination" of the spec: the destination is where the walk ends.
 */
export function randomRoute(graph: RoadGraph, rng: Rng, opt: RouteOptions): { path: Path; start: number } {
  const net = graph.net;
  for (let attempt = 0; ; attempt++) {
    const e = net.edges[rng.int(net.edges.length)];
    if (e.length < 40) continue;
    const dir: 1 | -1 = rng.next() < 0.5 ? 1 : -1;
    const first = graph.lane(e.id, dir);
    if (first.length < 30) continue;
    const start = rng.range(0, Math.max(0, first.length - (opt.maxTurns === 0 ? opt.length : 20)));
    pieceAt(first, start, tmp);
    if (opt.startOk && !opt.startOk(tmp.x, tmp.z)) continue;
    if (opt.near && Math.hypot(tmp.x - opt.near.x, tmp.z - opt.near.z) > opt.near.radius && attempt < 2000) continue;
    if (opt.maxTurns === 0 && first.length - start < opt.length * 0.6 && attempt < 2000) continue;
    const pieces: Piece[] = [first];
    let len = first.length - start;
    let lane = first;
    let turns = 0;
    while (len < opt.length && turns < opt.maxTurns) {
      // No U-turns: a dead end or cul-de-sac is where the route ends.
      const choices = graph.exits(lane).filter((x) => x.edge !== lane.edge);
      if (!choices.length) break;
      const next = choices[rng.int(choices.length)];
      const turn = graph.turn(lane, next);
      pieces.push(turn, next);
      len += turn.length + next.length;
      lane = next;
      turns++;
    }
    const path = new Path(pieces, graph);
    return { path, start };
  }
}

const shifted = new WeakMap<Piece, Map<number, Piece>>();

/**
 * The same piece moved `lat` m to the right of travel (the outer lane of a two-lane road, an
 * overtaking car in the oncoming lane, a lane change in progress). Cached per 5 cm of offset.
 */
export function shiftPiece(p: Piece, lat: number): Piece {
  const key = Math.round(lat * 20);
  if (key === 0) return p;
  let byLat = shifted.get(p);
  if (!byLat) shifted.set(p, (byLat = new Map()));
  const hit = byLat.get(key);
  if (hit) return hit;
  const off = key / 20;
  const src = p.pts;
  const n = src.length / 2;
  const pts = new Float32Array(src.length);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    let tx = src[b * 2] - src[a * 2];
    let tz = src[b * 2 + 1] - src[a * 2 + 1];
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    pts[i * 2] = src[i * 2] - tz * off;
    pts[i * 2 + 1] = src[i * 2 + 1] + tx * off;
  }
  const piece: Piece = { ...p, pts };
  byLat.set(key, piece);
  return piece;
}

/** Distance along a piece of the point nearest (x, z), extended straight past its ends. */
export function projectOnPiece(p: Piece, x: number, z: number): number {
  const pts = p.pts;
  const n = pts.length / 2;
  let best = Infinity;
  let bestS = 0;
  for (let i = 0; i < n - 1; i++) {
    const ax = pts[i * 2];
    const az = pts[i * 2 + 1];
    const dx = pts[i * 2 + 2] - ax;
    const dz = pts[i * 2 + 3] - az;
    const l2 = dx * dx + dz * dz || 1e-9;
    let t = ((x - ax) * dx + (z - az) * dz) / l2;
    // Only the first and last segments extend beyond the piece.
    if (i > 0) t = Math.max(0, t);
    if (i < n - 2) t = Math.min(1, t);
    const qx = ax + dx * t;
    const qz = az + dz * t;
    const d2 = (x - qx) ** 2 + (z - qz) ** 2;
    if (d2 < best) {
      best = d2;
      bestS = p.cum[i] + t * Math.sqrt(l2);
    }
  }
  return bestS;
}

/**
 * Driving directions in lanes: the fastest chain of lanes and turns from a car at (x, z)
 * heading (hx, hz) to the road nearest (tx, tz) — A* over lanes, never a U-turn except at a
 * dead end. Returns the path, where the car is on it and where to stop, or null.
 */
export function laneRoute(
  graph: RoadGraph,
  x: number,
  z: number,
  hx: number,
  hz: number,
  tx: number,
  tz: number,
): { path: Path; start: number; goal: number } | null {
  const net = graph.net;
  const from = net.nearest(x, z, 60);
  const to = net.nearest(tx, tz, 2000);
  if (!from || !to) return null;
  const fe = net.edges[from.edge];
  const segDx = fe.pts[from.seg * 2 + 2] - fe.pts[from.seg * 2];
  const segDz = fe.pts[from.seg * 2 + 3] - fe.pts[from.seg * 2 + 1];
  const first = graph.lane(fe.id, segDx * hx + segDz * hz >= 0 ? 1 : -1);
  const startS = projectOnPiece(first, x, z);
  const goalLanes = [graph.lane(to.edge, 1), graph.lane(to.edge, -1)];
  const goalS = goalLanes.map((l) => Math.max(0, Math.min(l.length, projectOnPiece(l, to.x, to.z))));

  // Already on the destination's lane, ahead of us.
  const direct = goalLanes.indexOf(first);
  if (direct >= 0 && goalS[direct] > startS + 5) {
    return { path: new Path([first], graph), start: startS, goal: goalS[direct] };
  }
  const FAST = 19;
  const key = (l: Piece) => l.edge * 2 + (l.dir === 1 ? 0 : 1);
  const g = new Map<number, number>();
  const came = new Map<number, Piece>();
  const open: { lane: Piece; f: number }[] = [];
  const nodeOf = (l: Piece) => net.nodes[l.node];
  const h = (l: Piece) => Math.hypot(nodeOf(l).x - to.x, nodeOf(l).z - to.z) / FAST;
  g.set(key(first), (first.length - startS) / first.speed);
  open.push({ lane: first, f: g.get(key(first))! + h(first) });
  let goal: Piece | null = null;
  let expanded = 0;
  while (open.length && expanded < 20000) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const { lane } = open.splice(bi, 1)[0];
    expanded++;
    const gi = goalLanes.indexOf(lane);
    if (gi >= 0 && lane !== first) {
      goal = lane;
      break;
    }
    const base = g.get(key(lane))!;
    for (const next of graph.exits(lane)) {
      const turnCost = 3 + (next.edge === lane.edge ? 20 : 0); // junctions cost time; U-turns more
      const gi2 = goalLanes.indexOf(next);
      const along = gi2 >= 0 ? goalS[gi2] : next.length;
      const c = base + turnCost + along / next.speed;
      if (c < (g.get(key(next)) ?? Infinity)) {
        g.set(key(next), c);
        came.set(key(next), lane);
        open.push({ lane: next, f: c + h(next) });
      }
    }
  }
  if (!goal) return null;
  const lanes: Piece[] = [goal];
  while (lanes[0] !== first) lanes.unshift(came.get(key(lanes[0]))!);
  const pieces: Piece[] = [lanes[0]];
  for (let i = 1; i < lanes.length; i++) pieces.push(graph.turn(lanes[i - 1], lanes[i]), lanes[i]);
  const path = new Path(pieces, graph);
  const goalAlong = path.length - (goal.length - goalS[goalLanes.indexOf(goal)]);
  return { path, start: startS, goal: goalAlong };
}
