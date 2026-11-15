// The street network: a graph of roads in world coordinates.
//
// Downtown is a grid, but everything else (suburban arterials, winding subdivision streets,
// cul-de-sacs, country roads) has arbitrary shapes, so roads are stored as a general graph:
//
//   nodes — junctions, dead ends and cul-de-sac bulbs, with how the junction is controlled;
//   edges — a road between two nodes: a polyline (points every few metres) and a road class
//           (width, lanes, speed, markings, sidewalks).
//
// Generators (suburbs.ts) don't build the graph directly: they draw polylines, say where a
// street joins another one, and the NetworkBuilder works out the junctions: where polylines
// cross, where one ends on another (a T-junction), and splits everything into edges.
//
// Two helpers are shared by generation and gameplay:
//   SegmentIndex — a spatial hash of road segments: distance to the nearest road, nearest
//                  point on a road, roads near a point;
//   Raster       — a coarse (4 m) occupancy grid over the world, so generators can check that
//                  a lot or a building doesn't overlap a road or another lot.

export type RoadClass = 'downtown' | 'arterial' | 'collector' | 'local' | 'rural';

export interface RoadSpec {
  /** Kerb to kerb, m. */
  width: number;
  /** Lanes each way. */
  lanes: number;
  /** Sidewalk width each side, m (0 = none). */
  sidewalk: number;
  /** Speed limit, m/s. */
  speed: number;
  /** Importance: at a junction, the smaller roads give way. */
  rank: number;
}

export const ROAD_SPECS: Record<RoadClass, RoadSpec> = {
  downtown: { width: 14, lanes: 2, sidewalk: 0, speed: 12.5, rank: 4 }, // blocks have their own sidewalks
  arterial: { width: 14, lanes: 2, sidewalk: 2, speed: 17, rank: 4 }, // ~60 km/h, four lanes
  collector: { width: 10, lanes: 1, sidewalk: 1.8, speed: 12, rank: 3 },
  local: { width: 8, lanes: 1, sidewalk: 1.6, speed: 10, rank: 2 }, // residential, ~35 km/h
  rural: { width: 8, lanes: 1, sidewalk: 0, speed: 19, rank: 3 },
};

export type JunctionControl = 'lights' | 'stop' | 'none';

export interface StreetNode {
  id: number;
  x: number;
  z: number;
  /** Edges meeting here. */
  edges: number[];
  control: JunctionControl;
  /** Radius of a cul-de-sac turning circle (0 if none). */
  bulb: number;
}

export interface StreetEdge {
  id: number;
  a: number;
  b: number;
  cls: RoadClass;
  /** x, z pairs from node a to node b. */
  pts: Float32Array;
  /** Distance along the edge at each point. */
  cum: Float32Array;
  length: number;
}

export interface NearestRoad {
  edge: number;
  /** Segment index (point seg → seg+1) and fraction along it. */
  seg: number;
  t: number;
  x: number;
  z: number;
  dist: number;
}

// --- Spatial hash of segments -------------------------------------------------------

const BUCKET = 32;

/** Buckets of (owner, segment) pairs on a BUCKET-metre grid. Owners are edges or lines. */
export class SegmentIndex {
  private readonly buckets = new Map<number, number[]>();
  constructor(private readonly polyline: (owner: number) => ArrayLike<number>) {}

  private static key(bx: number, bz: number): number {
    return (bx + 2048) * 4096 + (bz + 2048);
  }

  add(owner: number, seg: number): void {
    const p = this.polyline(owner);
    const x0 = p[seg * 2];
    const z0 = p[seg * 2 + 1];
    const x1 = p[seg * 2 + 2];
    const z1 = p[seg * 2 + 3];
    const bx0 = Math.floor(Math.min(x0, x1) / BUCKET);
    const bx1 = Math.floor(Math.max(x0, x1) / BUCKET);
    const bz0 = Math.floor(Math.min(z0, z1) / BUCKET);
    const bz1 = Math.floor(Math.max(z0, z1) / BUCKET);
    for (let bx = bx0; bx <= bx1; bx++) {
      for (let bz = bz0; bz <= bz1; bz++) {
        const k = SegmentIndex.key(bx, bz);
        let list = this.buckets.get(k);
        if (!list) this.buckets.set(k, (list = []));
        list.push(owner, seg);
      }
    }
  }

  addAll(owner: number): void {
    const n = this.polyline(owner).length / 2 - 1;
    for (let s = 0; s < n; s++) this.add(owner, s);
  }

  /** Calls fn(owner, seg) for segments in buckets within r of (x, z) (may repeat a segment). */
  forEachNear(x: number, z: number, r: number, fn: (owner: number, seg: number) => void): void {
    const bx0 = Math.floor((x - r) / BUCKET);
    const bx1 = Math.floor((x + r) / BUCKET);
    const bz0 = Math.floor((z - r) / BUCKET);
    const bz1 = Math.floor((z + r) / BUCKET);
    for (let bx = bx0; bx <= bx1; bx++) {
      for (let bz = bz0; bz <= bz1; bz++) {
        const list = this.buckets.get(SegmentIndex.key(bx, bz));
        if (!list) continue;
        for (let i = 0; i < list.length; i += 2) fn(list[i], list[i + 1]);
      }
    }
  }

  /** Nearest segment point within `maxDist`, optionally skipping some owners. */
  nearest(x: number, z: number, maxDist: number, skip?: (owner: number, seg: number) => boolean): NearestRoad | null {
    let best: NearestRoad | null = null;
    let bestD = maxDist;
    this.forEachNear(x, z, maxDist, (owner, seg) => {
      if (skip && skip(owner, seg)) return;
      const p = this.polyline(owner);
      const ax = p[seg * 2];
      const az = p[seg * 2 + 1];
      const dx = p[seg * 2 + 2] - ax;
      const dz = p[seg * 2 + 3] - az;
      const len2 = dx * dx + dz * dz;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
      const qx = ax + dx * t;
      const qz = az + dz * t;
      const d = Math.hypot(x - qx, z - qz);
      if (d < bestD) {
        bestD = d;
        best = { edge: owner, seg, t, x: qx, z: qz, dist: d };
      }
    });
    return best;
  }
}

// --- Occupancy raster -------------------------------------------------------------------

export const CELL_FREE = 0;
export const CELL_ROAD = 1; // road surface, sidewalks and a margin around them
export const CELL_PARCEL = 2; // commercial / civic parcel
export const CELL_HOUSE = 3; // a house and its yard
export const CELL_BLOCKED = 4; // water, downtown, out of bounds…

/** A 4 m occupancy grid over the whole world. */
export class Raster {
  readonly res = 4;
  readonly n: number;
  readonly data: Uint8Array;
  constructor(readonly half: number) {
    this.n = Math.ceil((half * 2) / this.res);
    this.data = new Uint8Array(this.n * this.n);
  }

  private index(x: number, z: number): number {
    const i = Math.floor((x + this.half) / this.res);
    const k = Math.floor((z + this.half) / this.res);
    if (i < 0 || k < 0 || i >= this.n || k >= this.n) return -1;
    return k * this.n + i;
  }

  get(x: number, z: number): number {
    const i = this.index(x, z);
    return i < 0 ? CELL_BLOCKED : this.data[i];
  }

  /** Cells whose centres lie in the rotated rectangle (centre, half sizes along / across `yaw`). */
  private forRect(cx: number, cz: number, hw: number, hd: number, yaw: number, fn: (i: number) => boolean | void): boolean {
    // Rectangle axes: u = (cos yaw, −sin yaw) for the width, v = (sin yaw, cos yaw) for the depth.
    const ux = Math.cos(yaw);
    const uz = -Math.sin(yaw);
    const ex = Math.abs(ux) * hw + Math.abs(uz) * hd;
    const ez = Math.abs(uz) * hw + Math.abs(ux) * hd;
    const r = this.res;
    const i0 = Math.max(0, Math.floor((cx - ex + this.half) / r));
    const i1 = Math.min(this.n - 1, Math.floor((cx + ex + this.half) / r));
    const k0 = Math.max(0, Math.floor((cz - ez + this.half) / r));
    const k1 = Math.min(this.n - 1, Math.floor((cz + ez + this.half) / r));
    if (cx - ex < -this.half || cx + ex > this.half || cz - ez < -this.half || cz + ez > this.half) {
      if (fn(-1) === false) return false;
    }
    for (let k = k0; k <= k1; k++) {
      for (let i = i0; i <= i1; i++) {
        const x = (i + 0.5) * r - this.half - cx;
        const z = (k + 0.5) * r - this.half - cz;
        const a = x * ux + z * uz;
        const b = x * -uz + z * ux;
        if (Math.abs(a) > hw || Math.abs(b) > hd) continue;
        if (fn(k * this.n + i) === false) return false;
      }
    }
    return true;
  }

  /** Is every cell of the rectangle free? */
  rectFree(cx: number, cz: number, hw: number, hd: number, yaw: number): boolean {
    return this.forRect(cx, cz, hw, hd, yaw, (i) => i >= 0 && this.data[i] === CELL_FREE);
  }

  markRect(cx: number, cz: number, hw: number, hd: number, yaw: number, value: number): void {
    this.forRect(cx, cz, hw, hd, yaw, (i) => {
      if (i >= 0 && this.data[i] < value) this.data[i] = value;
    });
  }

  /** Mark a thick line (a road corridor). */
  markSegment(x0: number, z0: number, x1: number, z1: number, halfWidth: number, value: number): void {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 1e-6) return;
    const yaw = Math.atan2(-(z1 - z0), x1 - x0);
    this.markRect((x0 + x1) / 2, (z0 + z1) / 2, len / 2 + halfWidth * 0.5, halfWidth, yaw, value);
  }

  markPolyline(pts: ArrayLike<number>, halfWidth: number, value: number): void {
    for (let i = 0; i + 3 < pts.length; i += 2) this.markSegment(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], halfWidth, value);
  }

  markDisk(cx: number, cz: number, r: number, value: number): void {
    this.forRect(cx, cz, r, r, 0, (i) => {
      if (i < 0) return;
      const x = ((i % this.n) + 0.5) * this.res - this.half - cx;
      const z = (Math.floor(i / this.n) + 0.5) * this.res - this.half - cz;
      if (x * x + z * z <= r * r && this.data[i] < value) this.data[i] = value;
    });
  }

  /** Is the segment's corridor free? (samples every `res` metres) */
  segmentFree(x0: number, z0: number, x1: number, z1: number, halfWidth: number): boolean {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.max(1, Math.ceil(len / this.res));
    const nx = -(z1 - z0) / (len || 1);
    const nz = (x1 - x0) / (len || 1);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      for (let w = -halfWidth; w <= halfWidth + 1e-6; w += Math.max(this.res, halfWidth)) {
        if (this.get(x + nx * w, z + nz * w) !== CELL_FREE) return false;
      }
    }
    return true;
  }
}

// --- Geometry helpers ------------------------------------------------------------------

/** Resample a control polyline into a smooth Catmull-Rom curve with points every ~`step` m. */
export function smoothCurve(ctrl: number[], step: number): number[] {
  const n = ctrl.length / 2;
  if (n < 3) return resample(ctrl, step);
  const out: number[] = [ctrl[0], ctrl[1]];
  const P = (i: number, c: number) => {
    // Clamp, extrapolating the end tangents.
    if (i < 0) return 2 * ctrl[c] - ctrl[2 + c];
    if (i >= n) return 2 * ctrl[(n - 1) * 2 + c] - ctrl[(n - 2) * 2 + c];
    return ctrl[i * 2 + c];
  };
  for (let i = 0; i < n - 1; i++) {
    const segLen = Math.hypot(ctrl[i * 2 + 2] - ctrl[i * 2], ctrl[i * 2 + 3] - ctrl[i * 2 + 1]);
    const k = Math.max(1, Math.round(segLen / step));
    for (let j = 1; j <= k; j++) {
      const t = j / k;
      const t2 = t * t;
      const t3 = t2 * t;
      for (let c = 0; c < 2; c++) {
        const p0 = P(i - 1, c);
        const p1 = P(i, c);
        const p2 = P(i + 1, c);
        const p3 = P(i + 2, c);
        // Uniform Catmull-Rom: passes through every control point with a continuous tangent.
        out.push(0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3));
      }
    }
  }
  return out;
}

/** Points along a polyline every ~`step` m (keeps the end points). */
export function resample(pts: number[], step: number): number[] {
  const out: number[] = [pts[0], pts[1]];
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const len = Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
    const k = Math.max(1, Math.round(len / step));
    for (let j = 1; j <= k; j++) {
      out.push(pts[i] + ((pts[i + 2] - pts[i]) * j) / k, pts[i + 1] + ((pts[i + 3] - pts[i + 1]) * j) / k);
    }
  }
  return out;
}

export function polylineLength(pts: ArrayLike<number>): number {
  let len = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) len += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
  return len;
}

// --- The network ---------------------------------------------------------------------

export class StreetNet {
  readonly index: SegmentIndex;
  constructor(
    readonly nodes: StreetNode[],
    readonly edges: StreetEdge[],
  ) {
    this.index = new SegmentIndex((e) => this.edges[e].pts);
    for (const e of edges) this.index.addAll(e.id);
  }

  /** Distance from (x, z) to the nearest road centre line (capped at `cap`). */
  distance(x: number, z: number, cap = 200): number {
    return this.index.nearest(x, z, cap)?.dist ?? cap;
  }

  /** Distance to the nearest road's kerb (negative on the road). */
  kerbDistance(x: number, z: number, cap = 200): number {
    let best = cap;
    this.index.forEachNear(x, z, Math.min(cap, 40), (e, seg) => {
      const p = this.edges[e].pts;
      const ax = p[seg * 2];
      const az = p[seg * 2 + 1];
      const dx = p[seg * 2 + 2] - ax;
      const dz = p[seg * 2 + 3] - az;
      const len2 = dx * dx + dz * dz;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
      const d = Math.hypot(x - ax - dx * t, z - az - dz * t) - ROAD_SPECS[this.edges[e].cls].width / 2;
      if (d < best) best = d;
    });
    return best;
  }

  nearest(x: number, z: number, maxDist = 200): NearestRoad | null {
    return this.index.nearest(x, z, maxDist);
  }

  /** The other end of an edge. */
  other(edge: StreetEdge, node: number): number {
    return edge.a === node ? edge.b : edge.a;
  }

  /** Point and unit tangent at distance s along an edge (from a to b). */
  pointAt(edge: StreetEdge, s: number, out: { x: number; z: number; tx: number; tz: number }): typeof out {
    const cum = edge.cum;
    const n = cum.length;
    s = Math.max(0, Math.min(edge.length, s));
    // Binary search for the segment.
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    const p = edge.pts;
    const segLen = cum[hi] - cum[lo] || 1;
    const t = (s - cum[lo]) / segLen;
    const dx = p[hi * 2] - p[lo * 2];
    const dz = p[hi * 2 + 1] - p[lo * 2 + 1];
    out.x = p[lo * 2] + dx * t;
    out.z = p[lo * 2 + 1] + dz * t;
    const l = Math.hypot(dx, dz) || 1;
    out.tx = dx / l;
    out.tz = dz / l;
    return out;
  }
}

// --- Building the network from polylines --------------------------------------------

interface Line {
  cls: RoadClass;
  pts: number[];
  /** Where nodes must be: (segment, fraction) pairs, plus the two ends. */
  splits: { seg: number; t: number }[];
  /** Cul-de-sac bulb radius at the start / end (0 = none). */
  bulbStart: number;
  bulbEnd: number;
}

export class NetworkBuilder {
  readonly lines: Line[] = [];
  /** Index over the lines as they are added (for generators: distance to existing streets). */
  readonly index = new SegmentIndex((l) => this.lines[l].pts);

  /** Add a road polyline (x, z pairs); returns its id. */
  add(cls: RoadClass, pts: number[], bulbStart = 0, bulbEnd = 0): number {
    const id = this.lines.length;
    this.lines.push({ cls, pts, splits: [], bulbStart, bulbEnd });
    this.index.addAll(id);
    return id;
  }

  /** Make sure there is a junction at a point on line `line` (something joins it there). */
  attach(line: number, seg: number, t: number): void {
    this.lines[line].splits.push({ seg, t });
  }

  /** Point on a line at (seg, t). */
  pointOn(line: number, seg: number, t: number): [number, number] {
    const p = this.lines[line].pts;
    return [p[seg * 2] + (p[seg * 2 + 2] - p[seg * 2]) * t, p[seg * 2 + 1] + (p[seg * 2 + 3] - p[seg * 2 + 1]) * t];
  }

  /**
   * Turn the lines into a graph: find crossings, put nodes at every crossing, attachment and
   * end, split lines into edges between nodes, and work out junction control.
   */
  build(pruneRng?: { float(): number }): StreetNet {
    this.findCrossings();

    // Nodes, merged when closer than MERGE metres (attachments land on the line exactly,
    // but rounding and smoothing can leave them a little off).
    const MERGE = 1.5;
    const nodes: StreetNode[] = [];
    const grid = new Map<number, number[]>();
    const nodeAt = (x: number, z: number, bulb = 0): number => {
      const gx = Math.floor(x / MERGE);
      const gz = Math.floor(z / MERGE);
      for (let a = -1; a <= 1; a++) {
        for (let b = -1; b <= 1; b++) {
          for (const id of grid.get((gx + a) * 100003 + (gz + b)) ?? []) {
            const n = nodes[id];
            if (Math.hypot(n.x - x, n.z - z) < MERGE) {
              n.bulb = Math.max(n.bulb, bulb);
              return id;
            }
          }
        }
      }
      const id = nodes.length;
      nodes.push({ id, x, z, edges: [], control: 'none', bulb });
      const k = gx * 100003 + gz;
      const list = grid.get(k);
      if (list) list.push(id);
      else grid.set(k, [id]);
      return id;
    };

    const edges: StreetEdge[] = [];
    const seen = new Set<string>();
    for (const line of this.lines) {
      const p = line.pts;
      const nSeg = p.length / 2 - 1;
      if (nSeg < 1) continue;
      // Vertices in order with node flags: original points plus split points. A split at the
      // very end of a segment is the start of the next one.
      const splits = line.splits
        .map((sp) => (sp.t >= 1 - 1e-4 ? { seg: sp.seg + 1, t: 0 } : sp))
        .filter((sp) => sp.seg >= 0 && sp.seg <= nSeg)
        .sort((a, b) => a.seg - b.seg || a.t - b.t);
      const verts: { x: number; z: number; node: boolean }[] = [];
      let k = 0;
      for (let s = 0; s <= nSeg; s++) {
        verts.push({ x: p[s * 2], z: p[s * 2 + 1], node: s === 0 || s === nSeg });
        while (k < splits.length && splits[k].seg === s) {
          const sp = splits[k++];
          if (sp.t <= 1e-4) verts[verts.length - 1].node = true;
          else if (s < nSeg) {
            verts.push({ x: p[s * 2] + (p[s * 2 + 2] - p[s * 2]) * sp.t, z: p[s * 2 + 1] + (p[s * 2 + 3] - p[s * 2 + 1]) * sp.t, node: true });
          }
        }
      }
      // Split into edges between node vertices.
      let start = 0;
      for (let i = 1; i < verts.length; i++) {
        if (!verts[i].node) continue;
        const run = verts.slice(start, i + 1);
        start = i;
        const len = polylineLength(run.flatMap((v) => [v.x, v.z]));
        if (len < 0.5) continue;
        const a = nodeAt(run[0].x, run[0].z);
        const b = nodeAt(run[run.length - 1].x, run[run.length - 1].z);
        if (a === b) continue;
        const key = a < b ? `${a},${b},${Math.round(len)}` : `${b},${a},${Math.round(len)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const pts = new Float32Array(run.length * 2);
        run.forEach((v, j) => {
          pts[j * 2] = v.x;
          pts[j * 2 + 1] = v.z;
        });
        // Snap the ends onto the (possibly merged) nodes.
        pts[0] = nodes[a].x;
        pts[1] = nodes[a].z;
        pts[pts.length - 2] = nodes[b].x;
        pts[pts.length - 1] = nodes[b].z;
        const cum = new Float32Array(run.length);
        for (let j = 1; j < run.length; j++) cum[j] = cum[j - 1] + Math.hypot(pts[j * 2] - pts[j * 2 - 2], pts[j * 2 + 1] - pts[j * 2 - 1]);
        const id = edges.length;
        edges.push({ id, a, b, cls: line.cls, pts, cum, length: cum[cum.length - 1] });
        nodes[a].edges.push(id);
        nodes[b].edges.push(id);
      }
      if (line.bulbStart > 0) nodes[nodeAt(p[0], p[1])].bulb = line.bulbStart;
      if (line.bulbEnd > 0) nodes[nodeAt(p[p.length - 2], p[p.length - 1])].bulb = line.bulbEnd;
    }

    return compact(nodes, edges, pruneRng);
  }

  /** Where two lines cross (not at their ends), add a split to both. */
  private findCrossings(): void {
    const lines = this.lines;
    lines.forEach((line, li) => {
      const p = line.pts;
      for (let s = 0; s + 3 < p.length; s += 2) {
        const ax = p[s];
        const az = p[s + 1];
        const bx = p[s + 2];
        const bz = p[s + 3];
        const r = Math.hypot(bx - ax, bz - az) / 2 + 1;
        this.index.forEachNear((ax + bx) / 2, (az + bz) / 2, r, (lj, sj) => {
          if (lj <= li) return; // each pair once
          const q = lines[lj].pts;
          const cx = q[sj * 2];
          const cz = q[sj * 2 + 1];
          const dx = q[sj * 2 + 2];
          const dz = q[sj * 2 + 3];
          // Segment intersection: a + (b−a)·t = c + (d−c)·u.
          const rx = bx - ax;
          const rz = bz - az;
          const sx = dx - cx;
          const sz = dz - cz;
          const den = rx * sz - rz * sx;
          if (Math.abs(den) < 1e-9) return;
          const t = ((cx - ax) * sz - (cz - az) * sx) / den;
          const u = ((cx - ax) * rz - (cz - az) * rx) / den;
          if (t < 0 || t > 1 || u < 0 || u > 1) return;
          // Ends touching ends are joins, not crossings (the node merge handles them).
          const lastI = s / 2 === p.length / 2 - 2;
          const lastJ = sj === q.length / 2 - 2;
          const endI = (s === 0 && t < 1e-3) || (lastI && t > 1 - 1e-3);
          const endJ = (sj === 0 && u < 1e-3) || (lastJ && u > 1 - 1e-3);
          if (endI && endJ) return;
          line.splits.push({ seg: s / 2, t });
          lines[lj].splits.push({ seg: sj, t: u });
        });
      }
    });
  }
}

/**
 * Break up the regular pattern of country roads: drop about a third of the links between two
 * junctions, keeping only drops that leave every road reachable.
 */
function pruneCountry(nodes: StreetNode[], edges: StreetEdge[], alive: boolean[], rng: { float(): number }): void {
  const degree = (n: number) => nodes[n].edges.filter((e) => alive[e]).length;
  const connected = (): boolean => {
    const start = edges.findIndex((_e, i) => alive[i]);
    if (start < 0) return true;
    const seen = new Uint8Array(nodes.length);
    const stack = [edges[start].a];
    seen[edges[start].a] = 1;
    while (stack.length) {
      const n = stack.pop()!;
      for (const e of nodes[n].edges) {
        if (!alive[e]) continue;
        const o = edges[e].a === n ? edges[e].b : edges[e].a;
        if (!seen[o]) {
          seen[o] = 1;
          stack.push(o);
        }
      }
    }
    return edges.every((e, i) => !alive[i] || seen[e.a]);
  };
  for (const e of edges) {
    if (e.cls !== 'rural' || rng.float() > 0.35) continue;
    if (degree(e.a) < 3 || degree(e.b) < 3) continue;
    alive[e.id] = false;
    if (!connected()) alive[e.id] = true;
  }
}

/**
 * Tidy the graph: drop tiny dead-end stubs (left where a line ran a metre past a crossing),
 * renumber, and decide junction control.
 */
function compact(nodes: StreetNode[], edges: StreetEdge[], pruneRng?: { float(): number }): StreetNet {
  const alive = new Array(edges.length).fill(true);
  if (pruneRng) pruneCountry(nodes, edges, alive, pruneRng);
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of edges) {
      if (!alive[e.id] || e.length > 18) continue;
      const da = nodes[e.a].edges.filter((x) => alive[x]).length;
      const db = nodes[e.b].edges.filter((x) => alive[x]).length;
      if ((da === 1 && nodes[e.a].bulb === 0) || (db === 1 && nodes[e.b].bulb === 0)) {
        alive[e.id] = false;
        changed = true;
      }
    }
  }
  const nodeMap = new Map<number, number>();
  const outNodes: StreetNode[] = [];
  const outEdges: StreetEdge[] = [];
  const mapNode = (id: number) => {
    let m = nodeMap.get(id);
    if (m === undefined) {
      m = outNodes.length;
      nodeMap.set(id, m);
      const n = nodes[id];
      outNodes.push({ id: m, x: n.x, z: n.z, edges: [], control: 'none', bulb: n.bulb });
    }
    return m;
  };
  for (const e of edges) {
    if (!alive[e.id]) continue;
    const id = outEdges.length;
    const a = mapNode(e.a);
    const b = mapNode(e.b);
    outEdges.push({ ...e, id, a, b });
    outNodes[a].edges.push(id);
    outNodes[b].edges.push(id);
  }
  for (const n of outNodes) {
    if (n.edges.length < 3) continue;
    const ranks = n.edges.map((e) => ROAD_SPECS[outEdges[e].cls].rank).sort((a, b) => b - a);
    const classes = n.edges.map((e) => outEdges[e].cls);
    // Lights where two big roads cross (or anywhere downtown); stop signs on the smaller
    // roads elsewhere.
    if (classes.includes('downtown') || (ranks[0] >= 4 && ranks[1] >= 4 && classes.filter((c) => c === 'arterial').length >= 2)) {
      n.control = 'lights';
    } else n.control = 'stop';
  }
  return new StreetNet(outNodes, outEdges);
}
