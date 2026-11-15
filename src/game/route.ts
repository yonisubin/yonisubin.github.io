import { ROAD_SPECS, type StreetEdge, type StreetNet } from '../world/streets';

// Directions: the best route along the roads from where you are to a waypoint on the map.
//
// A* on the street network (world/streets.ts): nodes are junctions, edges are road polylines.
//   • Driving, an edge costs its travel time (length ÷ that road's speed limit), so routes
//     prefer arterials and country roads over winding residential streets. On foot it costs
//     its length (the shortest way).
//   • The heuristic is the straight-line distance (÷ the fastest speed limit when driving):
//     it never overestimates the remaining cost, so A* finds the best route, and it steers
//     the search toward the goal so only a fraction of the ~1000 junctions are visited.
//   • You and the waypoint are rarely at junctions: each is snapped to the nearest point on a
//     road, and the search starts with both ends of your road (with the cost of getting there
//     along it) and finishes through either end of the waypoint's road. A waypoint off the
//     roads (a field, the lake) gets a straight final leg from the nearest road point.
//
// The Navigator keeps the waypoint and the current route: it recomputes when you wander
// off it or change between driving and walking, trims what's behind you, and notices when
// you've arrived. In the helicopter or a boat the "route" is a straight line.

export type TravelMode = 'drive' | 'walk' | 'direct';

export interface Route {
  /** x, z pairs from the start (you) to the destination. */
  pts: number[];
  /** Index (in points) where the off-road final leg begins (= the number of points if none). */
  offroad: number;
  /** Total length, m. */
  length: number;
}

/** Off-road legs shorter than this aren't worth showing as such. */
const OFFROAD_MIN = 8;
const FASTEST = Math.max(...Object.values(ROAD_SPECS).map((s) => s.speed));

interface Snap {
  edge: StreetEdge;
  /** Distance along the edge from node a. */
  s: number;
  x: number;
  z: number;
  dist: number;
}

/** Points along an edge between distances s0 and s1 (either way round), ends included. */
function slice(e: StreetEdge, s0: number, s1: number): number[] {
  const out: number[] = [];
  const at = (s: number) => {
    const cum = e.cum;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    const p = e.pts;
    return [p[(i - 1) * 2] + (p[i * 2] - p[(i - 1) * 2]) * t, p[(i - 1) * 2 + 1] + (p[i * 2 + 1] - p[(i - 1) * 2 + 1]) * t];
  };
  out.push(...at(s0));
  if (s1 >= s0) {
    for (let i = 0; i < e.cum.length; i++) if (e.cum[i] > s0 && e.cum[i] < s1) out.push(e.pts[i * 2], e.pts[i * 2 + 1]);
  } else {
    for (let i = e.cum.length - 1; i >= 0; i--) if (e.cum[i] < s0 && e.cum[i] > s1) out.push(e.pts[i * 2], e.pts[i * 2 + 1]);
  }
  out.push(...at(s1));
  return out;
}

/** A small binary min-heap of node ids keyed by f = g + h. */
class Heap {
  private readonly ids: number[] = [];
  private readonly keys: number[] = [];
  get size(): number {
    return this.ids.length;
  }
  push(id: number, key: number): void {
    this.ids.push(id);
    this.keys.push(key);
    let i = this.ids.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= this.keys[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.ids.length) {
      this.ids[0] = lastId;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.ids.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.ids.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    [this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}

export class Router {
  /** Junctions the last search expanded (for tests). */
  lastExpanded = 0;

  constructor(private readonly net: StreetNet) {}

  private snap(x: number, z: number): Snap | null {
    const hit = this.net.nearest(x, z, 2000);
    if (!hit) return null;
    const edge = this.net.edges[hit.edge];
    const segLen = edge.cum[hit.seg + 1] - edge.cum[hit.seg];
    return { edge, s: edge.cum[hit.seg] + segLen * hit.t, x: hit.x, z: hit.z, dist: hit.dist };
  }

  /** Cost of travelling along `len` metres of an edge in this mode. */
  private cost(e: StreetEdge, len: number, mode: TravelMode): number {
    return mode === 'drive' ? len / ROAD_SPECS[e.cls].speed : len;
  }

  /** The best route from (x0, z0) to (x1, z1), or null if there's no road anywhere near. */
  find(x0: number, z0: number, x1: number, z1: number, mode: TravelMode): Route | null {
    if (mode === 'direct') return { pts: [x0, z0, x1, z1], offroad: 2, length: Math.hypot(x1 - x0, z1 - z0) };
    const from = this.snap(x0, z0);
    const to = this.snap(x1, z1);
    if (!from || !to) return null;
    const net = this.net;
    const nodes = net.nodes;
    const n = nodes.length;
    const heuristic = (id: number) => {
      const d = Math.hypot(nodes[id].x - to.x, nodes[id].z - to.z);
      return mode === 'drive' ? d / FASTEST : d;
    };

    // A* from a virtual start (both ends of my road) to a virtual goal (via either end of
    // the waypoint's road). g = best cost found so far to each junction.
    const g = new Float64Array(n).fill(Infinity);
    const cameFrom = new Int32Array(n).fill(-1); // edge used to reach each junction
    const closed = new Uint8Array(n);
    const open = new Heap();
    const seed = (node: number, c: number) => {
      if (c < g[node]) {
        g[node] = c;
        cameFrom[node] = -2; // reached straight from the start
        open.push(node, c + heuristic(node));
      }
    };
    seed(from.edge.a, this.cost(from.edge, from.s, mode));
    seed(from.edge.b, this.cost(from.edge, from.edge.length - from.s, mode));
    // The goal is reached from to.edge.a (then forward along it) or to.edge.b (backward).
    const tail = (node: number) =>
      node === to.edge.a ? this.cost(to.edge, to.s, mode) : node === to.edge.b ? this.cost(to.edge, to.edge.length - to.s, mode) : Infinity;
    let best = Infinity;
    let bestEnd = -1;
    // Same road: maybe just go along it.
    if (from.edge === to.edge) best = this.cost(from.edge, Math.abs(to.s - from.s), mode);
    let expanded = 0;
    while (open.size) {
      const u = open.pop();
      if (closed[u]) continue;
      closed[u] = 1;
      expanded++;
      // Every remaining route costs at least g + h; stop once that can't beat the best.
      if (g[u] + heuristic(u) >= best) break;
      const t = tail(u);
      if (g[u] + t < best) {
        best = g[u] + t;
        bestEnd = u;
      }
      for (const eid of nodes[u].edges) {
        const e = net.edges[eid];
        const v = net.other(e, u);
        const c = g[u] + this.cost(e, e.length, mode);
        if (c < g[v]) {
          g[v] = c;
          cameFrom[v] = eid;
          open.push(v, c + heuristic(v));
        }
      }
    }
    this.lastExpanded = expanded;
    if (!Number.isFinite(best)) return null;

    // Build the polyline: along my road to the first junction, junction to junction, then
    // along the waypoint's road to the snapped point (or straight along the same road).
    let pts: number[];
    if (bestEnd < 0) {
      pts = slice(from.edge, from.s, to.s);
    } else {
      const chain: number[] = []; // edges from the first junction to bestEnd
      let v = bestEnd;
      while (cameFrom[v] >= 0) {
        const e = net.edges[cameFrom[v]];
        chain.push(cameFrom[v]);
        v = net.other(e, v);
      }
      chain.reverse();
      const first = v; // the junction we entered from the start
      pts = slice(from.edge, from.s, first === from.edge.a ? 0 : from.edge.length);
      let at = first;
      for (const eid of chain) {
        const e = net.edges[eid];
        const forward = e.a === at;
        const part = slice(e, forward ? 0 : e.length, forward ? e.length : 0);
        pts.push(...part.slice(2)); // skip the shared junction point
        at = net.other(e, at);
      }
      const end = slice(to.edge, bestEnd === to.edge.a ? 0 : to.edge.length, to.s);
      pts.push(...end.slice(2));
    }
    pts.unshift(x0, z0);
    const offroad = pts.length / 2;
    if (to.dist > OFFROAD_MIN) pts.push(x1, z1);
    let length = 0;
    for (let i = 2; i < pts.length; i += 2) length += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    return { pts, offroad, length };
  }
}

/** The waypoint, the route to it, and keeping that route up to date as you move. */
export class Navigator {
  waypoint: { x: number; z: number } | null = null;
  /** The route from where you are now (trimmed as you go), or null. */
  route: Route | null = null;
  private full: Route | null = null;
  private mode: TravelMode = 'drive';
  private sinceCheck = 0;
  private sinceRoute = 0;
  readonly router: Router;

  constructor(
    net: StreetNet,
    /** Told when you reach the waypoint. */
    private readonly onArrive: () => void,
  ) {
    this.router = new Router(net);
  }

  setWaypoint(x: number, z: number): void {
    this.waypoint = { x, z };
    this.full = this.route = null;
    this.sinceRoute = Infinity; // route on the next update
  }

  clear(): void {
    this.waypoint = null;
    this.full = this.route = null;
  }

  /** Remaining distance along the route, m (or null with no route). */
  get remaining(): number | null {
    return this.route ? this.route.length : null;
  }

  /** Call every frame with your position and how you're travelling. */
  update(dt: number, x: number, z: number, mode: TravelMode): void {
    const w = this.waypoint;
    if (!w) return;
    if (Math.hypot(w.x - x, w.z - z) < 15) {
      this.clear();
      this.onArrive();
      return;
    }
    this.sinceCheck += dt;
    this.sinceRoute += dt;
    if (mode !== this.mode || !this.full) {
      this.mode = mode;
      this.recompute(x, z);
      return;
    }
    if (mode === 'direct') {
      // Straight to it from wherever you are.
      this.recompute(x, z);
      return;
    }
    // Twice a second: where are we along the route? Re-route if we've strayed from it.
    if (this.sinceCheck < 0.5) return;
    this.sinceCheck = 0;
    const off = this.trim(x, z);
    if (off > 25 && this.sinceRoute > 2) this.recompute(x, z);
  }

  private recompute(x: number, z: number): void {
    const w = this.waypoint!;
    this.full = this.router.find(x, z, w.x, w.z, this.mode);
    this.route = this.full;
    this.sinceRoute = 0;
  }

  /** Cut the route at the point nearest to (x, z); returns how far off the route we are. */
  private trim(x: number, z: number): number {
    const r = this.full;
    if (!r) return Infinity;
    const p = r.pts;
    let best = Infinity;
    let bestI = 0;
    let bx = p[0];
    let bz = p[1];
    for (let i = 0; i + 3 < p.length; i += 2) {
      const dx = p[i + 2] - p[i];
      const dz = p[i + 3] - p[i + 1];
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - p[i]) * dx + (z - p[i + 1]) * dz) / l2));
      const qx = p[i] + dx * t;
      const qz = p[i + 1] + dz * t;
      const d = Math.hypot(x - qx, z - qz);
      if (d < best) {
        best = d;
        bestI = i / 2;
        bx = qx;
        bz = qz;
      }
    }
    // The route from here: you → the nearest point on it → the rest.
    const pts = [x, z, bx, bz, ...p.slice((bestI + 1) * 2)];
    const offroad = Math.max(2, r.offroad - bestI + 1);
    let length = 0;
    for (let i = 2; i < pts.length; i += 2) length += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    this.route = { pts, offroad, length };
    return best;
  }
}
