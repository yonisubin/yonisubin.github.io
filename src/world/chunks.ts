import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { BLOCK_SIZE, CELLS, CURB_HEIGHT, LOT, PITCH, lawnLift, lineCoord, ruralFeatures, type Block, type Building, type CityLayout, type Tree } from './layout';
import { ROAD_SPECS, type StreetEdge, type StreetNet } from './streets';
import { hashSeed, Rng } from './rng';
import { CAR_DIMENSIONS, PAINT_COLORS } from '../vehicles/carModel';
import type { Parcel, Rect } from './suburbs';
import type { InstancePool } from './instancePool';
import { VERGE, type Terrain } from './terrain';
import { smoothstep } from './noise';

// Streaming: the world is cut into CHUNKS × CHUNKS square chunks of 4 × 4 grid cells
// (312 m). Only chunks near the player have meshes and colliders, in two tiers:
//
//   far  (within ~850 m): terrain mesh + heightfield collider; roads (asphalt, markings,
//        sidewalks, curbs, verges, junctions, cul-de-sacs) and one collider for every paved
//        surface; downtown block slabs; houses, shops and other buildings (with colliders);
//        driveways and parking lots. Enough to see the skyline and drive anywhere.
//   near (within ~400 m): the small stuff — street, garden and forest trees, lamps, rooftop clutter.
//
// Roads come from the street network (streets.ts): each chunk builds the road segments whose
// midpoints fall inside it, and the junctions, houses and parcels whose centres do, so every
// piece is built exactly once whatever order chunks load in.
//
// Chunks load and unload with some hysteresis (the unload distance is larger than the load
// distance) so walking back and forth over a boundary doesn't thrash. Building a chunk is
// the expensive part, so work is queued and done a step at a time within a per-frame budget.
//
// Repeated objects go into shared InstancePools (one draw call each, whatever is loaded);
// per-chunk meshes are only the terrain, road surfaces, paint, sidewalks and verges.

export const CHUNK_CELLS = 4;
export const CHUNK_SIZE = CHUNK_CELLS * PITCH; // 312 m
export const CHUNKS = CELLS / CHUNK_CELLS; // 13
/** Default streaming distances (m, from the player to a chunk's edge); see setDistances(). */
export const STREAM_DISTANCES = { farLoad: 850, farUnload: 1000, nearLoad: 400, nearUnload: 520 };
export type StreamDistances = typeof STREAM_DISTANCES;
/** Terrain sample spacing inside a chunk (mesh and collider share it). */
const TERRAIN_STEP = 6;
const TERRAIN_SEGMENTS = Math.round(CHUNK_SIZE / TERRAIN_STEP); // 52
const ROAD_Y = 0.02; // road surface above road level (the ground dips below it anyway)
const PAINT_Y = 0.035;
const JUNCTION_Y = 0.025;

export interface WorldPools {
  buildings: InstancePool;
  roofs: InstancePool;
  acs: InstancePool;
  tanks: InstancePool;
  trunks: InstancePool;
  canopies: InstancePool;
  forest: InstancePool;
  lamps: InstancePool;
  lampHeads: InstancePool;
  lightPools: InstancePool;
  parkedBodies: InstancePool;
  parkedGlass: InstancePool;
  parkedTyres: InstancePool;
}

export interface ChunkMaterials {
  terrain: THREE.Material;
  road: THREE.Material;
  paint: THREE.Material;
  pavement: THREE.Material;
  lawn: THREE.Material;
}

/** Everything one tier of a chunk created, so it can all be removed again. */
interface TierContents {
  meshes: THREE.Mesh[];
  colliders: RAPIER.Collider[];
  slots: [InstancePool, number][];
}

interface Chunk {
  cx: number;
  cz: number;
  far: TierContents | null;
  near: TierContents | null;
  /** Countryside buildings and trees (generated with the far tier, reused by the near one). */
  rural: { buildings: Building[]; trees: Tree[] } | null;
}

/** What each chunk owns from the street world (by midpoint / centre). */
interface Owned {
  segs: number[]; // edge, segment pairs
  nodes: number[];
  houses: Building[];
  driveways: Rect[];
  parcels: Parcel[];
  trees: Tree[];
}

type Job = { chunk: Chunk; tier: 'far' | 'near' };
type Rgb = readonly [number, number, number];

const _color = new THREE.Color();
/** Downtown block sidewalks are draped over the hills on a grid of BLOCK_GRID × BLOCK_GRID quads. */
const BLOCK_GRID = 8;
export const LAMP_HEAD_OUT = 1.8; // m from the pole to the luminaire
const WHITE: Rgb = [0.85, 0.85, 0.8];
const YELLOW: Rgb = [0.85, 0.62, 0.17];
const PLAIN: Rgb = [1, 1, 1];
const CONCRETE: Rgb = [0.92, 0.9, 0.86];
const POND: Rgb = [0.05, 0.13, 0.2];

export class WorldStreamer {
  private readonly chunks: Chunk[] = [];
  /** 1 where a chunk's far tier (terrain collider) is loaded; read by the far-terrain shader. */
  readonly loadedMask = new Uint8Array(CHUNKS * CHUNKS);
  readonly loadedTexture: THREE.DataTexture;
  private queue: Job[] = [];
  private readonly net: StreetNet;
  private readonly owned: Owned[] = [];
  /** Per edge: mitred normals (to the right of travel a → b) and road heights per point. */
  private readonly edgeGeo = new Map<number, { nx: Float32Array; nz: Float32Array; h: Float32Array }>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: RAPIER.World,
    private readonly layout: CityLayout,
    private readonly terrain: Terrain,
    private readonly pools: WorldPools,
    private readonly materials: ChunkMaterials,
  ) {
    for (let cz = 0; cz < CHUNKS; cz++) {
      for (let cx = 0; cx < CHUNKS; cx++) {
        this.chunks.push({ cx, cz, far: null, near: null, rural: null });
        this.owned.push({ segs: [], nodes: [], houses: [], driveways: [], parcels: [], trees: [] });
      }
    }
    this.loadedTexture = new THREE.DataTexture(this.loadedMask, CHUNKS, CHUNKS, THREE.RedFormat, THREE.UnsignedByteType);
    this.loadedTexture.needsUpdate = true;

    // Hand the street world out to chunks.
    const streets = layout.streets;
    this.net = streets.net;
    for (const e of this.net.edges) {
      for (let s = 0; s + 1 < e.pts.length / 2; s++) {
        const o = this.ownerOf((e.pts[s * 2] + e.pts[s * 2 + 2]) / 2, (e.pts[s * 2 + 1] + e.pts[s * 2 + 3]) / 2);
        o?.segs.push(e.id, s);
      }
    }
    for (const n of this.net.nodes) this.ownerOf(n.x, n.z)?.nodes.push(n.id);
    for (const h of streets.houses) this.ownerOf(h.x, h.z)?.houses.push(h);
    for (const d of streets.driveways) this.ownerOf(d.x, d.z)?.driveways.push(d);
    for (const p of streets.parcels) this.ownerOf(p.x, p.z)?.parcels.push(p);
    for (const t of streets.trees) this.ownerOf(t.x, t.z)?.trees.push(t);
    for (const p of streets.parcels) for (const t of p.trees) this.ownerOf(t.x, t.z)?.trees.push(t);
  }

  private ownerOf(x: number, z: number): Owned | null {
    const cx = Math.floor((x - lineCoord(0)) / CHUNK_SIZE);
    const cz = Math.floor((z - lineCoord(0)) / CHUNK_SIZE);
    if (cx < 0 || cz < 0 || cx >= CHUNKS || cz >= CHUNKS) return null;
    return this.owned[cz * CHUNKS + cx];
  }

  /** World-space rectangle of a chunk. */
  private bounds(c: Chunk): { x0: number; z0: number; x1: number; z1: number } {
    const x0 = lineCoord(c.cx * CHUNK_CELLS);
    const z0 = lineCoord(c.cz * CHUNK_CELLS);
    return { x0, z0, x1: x0 + CHUNK_SIZE, z1: z0 + CHUNK_SIZE };
  }

  private distance(c: Chunk, x: number, z: number): number {
    const b = this.bounds(c);
    const dx = Math.max(b.x0 - x, 0, x - b.x1);
    const dz = Math.max(b.z0 - z, 0, z - b.z1);
    return Math.hypot(dx, dz);
  }

  /** Is the ground (terrain collider) loaded at (x, z)? */
  isLoaded(x: number, z: number): boolean {
    const cx = Math.floor((x - lineCoord(0)) / CHUNK_SIZE);
    const cz = Math.floor((z - lineCoord(0)) / CHUNK_SIZE);
    if (cx < 0 || cz < 0 || cx >= CHUNKS || cz >= CHUNKS) return false;
    return this.chunks[cz * CHUNKS + cx].far !== null;
  }

  get loadedCount(): { far: number; near: number; queued: number } {
    let far = 0;
    let near = 0;
    for (const c of this.chunks) {
      if (c.far) far++;
      if (c.near) near++;
    }
    return { far, near, queued: this.queue.length };
  }

  /** How far chunks load and unload (graphics quality lowers them on slow machines). */
  private dist: StreamDistances = { ...STREAM_DISTANCES };

  /** Change the streaming distances; chunks now out of range unload on the next update(). */
  setDistances(d: StreamDistances): void {
    this.dist = { ...d };
  }

  get distances(): StreamDistances {
    return this.dist;
  }

  /**
   * Call every frame with the player's position. Unloads far-away chunks at once and builds
   * queued ones, nearest first, for up to `budgetMs` milliseconds (at least one job).
   */
  update(focus: THREE.Vector3, budgetMs = 4): void {
    const jobs: (Job & { d: number })[] = [];
    for (const c of this.chunks) {
      const d = this.distance(c, focus.x, focus.z);
      if (c.near && d > this.dist.nearUnload) this.unload(c, 'near');
      if (c.far && d > this.dist.farUnload) {
        if (c.near) this.unload(c, 'near');
        this.unload(c, 'far');
      }
      if (!c.far && d < this.dist.farLoad) jobs.push({ chunk: c, tier: 'far', d });
      else if (c.far && !c.near && d < this.dist.nearLoad) jobs.push({ chunk: c, tier: 'near', d });
    }
    // Near-tier jobs first among equals: what's around the player matters most.
    jobs.sort((a, b) => a.d - b.d || (a.tier === 'near' ? -1 : 1));
    this.queue = jobs;
    const start = performance.now();
    while (this.queue.length) {
      const job = this.queue.shift()!;
      if (job.tier === 'far') this.buildFar(job.chunk);
      else this.buildNear(job.chunk);
      if (performance.now() - start > budgetMs) break;
    }
    this.flushPools();
  }

  /** Build everything within `radius` of `focus` right now (startup, teleports). */
  loadAround(focus: THREE.Vector3, radius: number): void {
    for (const c of this.chunks) {
      const d = this.distance(c, focus.x, focus.z);
      if (d > radius) continue;
      if (!c.far && d < this.dist.farLoad) this.buildFar(c);
      if (c.far && !c.near && d < this.dist.nearLoad) this.buildNear(c);
    }
    this.flushPools();
  }

  private flushPools(): void {
    for (const p of Object.values(this.pools)) p.flush();
  }

  private unload(c: Chunk, tier: 'far' | 'near'): void {
    const contents = c[tier];
    if (!contents) return;
    for (const m of contents.meshes) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    for (const col of contents.colliders) this.world.removeCollider(col, false);
    for (const [pool, slot] of contents.slots) pool.release(slot);
    c[tier] = null;
    if (tier === 'far') {
      this.loadedMask[c.cz * CHUNKS + c.cx] = 0;
      this.loadedTexture.needsUpdate = true;
    }
  }

  // ------------------------------------------------------------------ far tier

  private buildFar(c: Chunk): void {
    const t: TierContents = { meshes: [], colliders: [], slots: [] };
    const b = this.bounds(c);
    const own = this.owned[c.cz * CHUNKS + c.cx];
    this.buildTerrain(b, t);

    const take = (pool: InstancePool) => {
      const slot = pool.alloc();
      if (slot >= 0) t.slots.push([pool, slot]);
      return slot;
    };
    const collider = (desc: RAPIER.ColliderDesc) => t.colliders.push(this.world.createCollider(desc));

    const g: Builders = {
      asphalt: new GeometryBuilder(),
      paint: new GeometryBuilder(),
      pavement: new GeometryBuilder(),
      verge: new GeometryBuilder(),
      lawn: new GeometryBuilder(),
      solid: new GeometryBuilder(),
    };
    this.buildRoads(own, g);
    this.buildLots(own, g);

    // Downtown blocks: raised sidewalk + lot draped over the hills, lawn, buildings.
    const buildings: Building[] = [];
    for (let bz = c.cz * CHUNK_CELLS; bz < (c.cz + 1) * CHUNK_CELLS; bz++) {
      for (let bx = c.cx * CHUNK_CELLS; bx < (c.cx + 1) * CHUNK_CELLS; bx++) {
        const block = this.layout.blockAt(bx, bz);
        if (!block) continue;
        this.buildBlockSurface(block, g, collider);
        // Buildings stand upright on the slope: base at the footprint's lowest corner, walls
        // taller by the drop so the roof is level with where it would be on flat ground at
        // the highest corner (the uphill side is set into the hill).
        for (const bl of block.buildings) {
          const f = this.footing(bl, 0);
          buildings.push({ ...bl, y: f.low + CURB_HEIGHT - 0.05, height: bl.height + (f.high - f.low) + 0.05 });
        }
      }
    }
    // Church steeples: a tall square tower with a pointed roof.
    const steeples: Building[] = own.parcels.flatMap((p) =>
      p.steeple
        ? [{ x: p.steeple.x, z: p.steeple.z, y: 0, yaw: p.yaw, width: p.steeple.size, depth: p.steeple.size, height: p.steeple.height, style: 1, color: p.buildings[0]?.color ?? [0.8, 0.8, 0.8], seed: 3, roof: { height: 7, color: [0.18, 0.18, 0.2] as [number, number, number] } }]
        : [],
    );
    // Suburban houses and parcel buildings: the same, on the lawn level.
    for (const bl of [...own.houses, ...own.parcels.flatMap((p) => p.buildings), ...steeples]) {
      const f = this.footing(bl, CURB_HEIGHT);
      buildings.push({ ...bl, y: f.low - 0.25, height: bl.height + (f.high - f.low) + 0.25 });
    }

    // Countryside: farmsteads and trees, generated from each cell's seed.
    const rural = { buildings: [] as Building[], trees: [] as Tree[] };
    for (let bz = c.cz * CHUNK_CELLS; bz < (c.cz + 1) * CHUNK_CELLS; bz++) {
      for (let bx = c.cx * CHUNK_CELLS; bx < (c.cx + 1) * CHUNK_CELLS; bx++) {
        const f = ruralFeatures(
          this.layout.seed,
          bx,
          bz,
          this.layout.zones[bz * CELLS + bx],
          (x, z) => this.terrain.heightAt(x, z),
          (x, z, m) => this.terrain.isClear(x, z, m),
        );
        rural.buildings.push(...f.buildings);
        rural.trees.push(...f.trees);
      }
    }
    c.rural = rural;
    buildings.push(...rural.buildings);

    // Meshes for the chunk's surfaces, and one collider for everything you can walk or drive on.
    for (const [builder, material, uvSize] of [
      [g.asphalt, this.materials.road, 10],
      [g.paint, this.materials.paint, 10],
      [g.pavement, this.materials.pavement, 8],
      [g.verge, this.materials.terrain, 8],
      [g.lawn, this.materials.lawn, 6],
    ] as const) {
      if (builder.empty) continue;
      const mesh = new THREE.Mesh(builder.build(uvSize), material);
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      t.meshes.push(mesh);
    }
    if (!g.solid.empty) {
      const { vertices, indices } = g.solid.raw();
      collider(RAPIER.ColliderDesc.trimesh(vertices, indices));
    }

    for (const bl of buildings) {
      const yaw = bl.yaw ?? 0;
      const slot = take(this.pools.buildings);
      if (slot >= 0) {
        this.pools.buildings.place(slot, bl.x, bl.y, bl.z, bl.width, bl.height, bl.depth, yaw);
        this.pools.buildings.setColor(slot, _color.setRGB(...bl.color));
        const style = this.pools.buildings.mesh.geometry.getAttribute('aStyle') as THREE.InstancedBufferAttribute;
        style.setXY(slot, bl.style, bl.seed);
      }
      collider(
        RAPIER.ColliderDesc.cuboid(bl.width / 2, bl.height / 2, bl.depth / 2)
          .setTranslation(bl.x, bl.y + bl.height / 2, bl.z)
          .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }),
      );
      if (bl.roof) {
        // Ridge along the longer side; the unit prism's ridge runs along X.
        const alongX = bl.width >= bl.depth;
        const r = take(this.pools.roofs);
        this.pools.roofs.place(
          r,
          bl.x,
          bl.y + bl.height,
          bl.z,
          (alongX ? bl.width : bl.depth) + 0.8,
          bl.roof.height,
          (alongX ? bl.depth : bl.width) + 0.8,
          yaw + (alongX ? 0 : Math.PI / 2),
        );
        this.pools.roofs.setColor(r, _color.setRGB(...bl.roof.color));
      }
    }

    c.far = t;
    this.loadedMask[c.cz * CHUNKS + c.cx] = 255;
    this.loadedTexture.needsUpdate = true;
  }

  /** Terrain mesh with vertex colours, and a matching heightfield collider. */
  private buildTerrain(b: { x0: number; z0: number }, t: TierContents): void {
    const n = TERRAIN_SEGMENTS;
    const heights = new Float32Array((n + 1) * (n + 1));
    for (let iz = 0; iz <= n; iz++) {
      for (let ix = 0; ix <= n; ix++) {
        heights[iz * (n + 1) + ix] = this.terrain.heightAt(b.x0 + ix * TERRAIN_STEP, b.z0 + iz * TERRAIN_STEP);
      }
    }

    const geometry = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, n, n).rotateX(-Math.PI / 2);
    // PlaneGeometry rotated flat: vertices run row by row from −Z to +Z, −X to +X — the same
    // order as `heights`.
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    const cxw = b.x0 + CHUNK_SIZE / 2;
    const czw = b.z0 + CHUNK_SIZE / 2;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, heights[i]);
      uv.setXY(i, (pos.getX(i) + cxw) / 8, (pos.getZ(i) + czw) / 8);
    }
    geometry.computeVertexNormals();
    const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const c = this.terrain.colorAt(pos.getX(i) + cxw, pos.getZ(i) + czw, heights[i], 1 - normal.getY(i));
      colors.set(c, i * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(geometry, this.materials.terrain);
    mesh.position.set(cxw, 0, czw);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    t.meshes.push(mesh);

    // Rapier heightfield: a (rows × cols) matrix in column-major order, rows along Z and
    // columns along X, spanning `scale` and centred on the collider's position.
    const hf = new Float32Array((n + 1) * (n + 1));
    for (let ix = 0; ix <= n; ix++) {
      for (let iz = 0; iz <= n; iz++) hf[ix * (n + 1) + iz] = heights[iz * (n + 1) + ix];
    }
    const desc = RAPIER.ColliderDesc.heightfield(n, n, hf, { x: CHUNK_SIZE, y: 1, z: CHUNK_SIZE }).setTranslation(cxw, 0, czw);
    t.colliders.push(this.world.createCollider(desc));
  }

  // ------------------------------------------------------------------ roads

  /** Distance from (x, z) to one edge's centre line. */
  private edgeDistance(edgeId: number, x: number, z: number): number {
    const p = this.net.edges[edgeId].pts;
    let best = Infinity;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const dx = p[i + 2] - p[i];
      const dz = p[i + 3] - p[i + 1];
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - p[i]) * dx + (z - p[i + 1]) * dz) / l2));
      best = Math.min(best, Math.hypot(x - p[i] - dx * t, z - p[i + 1] - dz * t));
    }
    return best;
  }

  /** Road level at a point (the smooth height layer, which the terrain dip follows too). */
  private readonly roadLevel = (x: number, z: number): number => this.terrain.smoothHeight(x, z);

  /** Mitred normals and road heights along an edge (cached). */
  private geoOf(e: StreetEdge): { nx: Float32Array; nz: Float32Array; h: Float32Array } {
    let geo = this.edgeGeo.get(e.id);
    if (geo) return geo;
    const n = e.pts.length / 2;
    const nx = new Float32Array(n);
    const nz = new Float32Array(n);
    const h = new Float32Array(n);
    const p = e.pts;
    // Segment normals, to the right of travel: the right of +X is +Z, i.e. (−dz, dx).
    const sn: [number, number][] = [];
    for (let i = 0; i + 1 < n; i++) {
      const dx = p[i * 2 + 2] - p[i * 2];
      const dz = p[i * 2 + 3] - p[i * 2 + 1];
      const l = Math.hypot(dx, dz) || 1;
      sn.push([-dz / l, dx / l]);
    }
    for (let i = 0; i < n; i++) {
      const a = sn[Math.max(0, i - 1)];
      const b = sn[Math.min(sn.length - 1, i)];
      let mx = a[0] + b[0];
      let mz = a[1] + b[1];
      const ml = Math.hypot(mx, mz) || 1;
      mx /= ml;
      mz /= ml;
      // Mitre: stretch so the ribbon keeps its width round the bend (capped for sharp ones).
      const k = 1 / Math.max(0.6, mx * b[0] + mz * b[1]);
      nx[i] = mx * k;
      nz[i] = mz * k;
      h[i] = this.terrain.smoothHeight(p[i * 2], p[i * 2 + 1]);
    }
    geo = { nx, nz, h };
    this.edgeGeo.set(e.id, geo);
    return geo;
  }

  /** Radius of a node's junction disc (0 at plain bends, where markings run on through). */
  private junctionRadius(nodeId: number): number {
    const n = this.net.nodes[nodeId];
    if (n.bulb) return n.bulb;
    let hw = 0;
    for (const e of n.edges) hw = Math.max(hw, this.net.halfWidth(this.net.edges[e]));
    return n.edges.length >= 3 ? hw + 1.2 : 0;
  }

  /** A chunk's share of the roads: segment ribbons, junction discs and cul-de-sacs. */
  private buildRoads(own: Owned, g: Builders): void {
    const net = this.net;
    for (let k = 0; k < own.segs.length; k += 2) {
      const e = net.edges[own.segs[k]];
      const s = own.segs[k + 1];
      const spec = ROAD_SPECS[e.cls];
      const geo = this.geoOf(e);
      const p = e.pts;
      const i0 = s;
      const i1 = s + 1;
      const x0 = p[i0 * 2];
      const z0 = p[i0 * 2 + 1];
      const x1 = p[i1 * 2];
      const z1 = p[i1 * 2 + 1];
      const hw = spec.width / 2;
      // Road level at a point: the smooth layer *at that point*. Roads are draped over the
      // hill across their width too (banked with the hillside), so they always sit exactly on
      // top of the terrain dip under them, which follows the same layer. (A road kept level
      // across, at its centre line's height, let the hillside collider poke up through its
      // uphill edge: an invisible bump.)
      const H = this.roadLevel;
      // A strip from offset a to offset b (m right of the centre line), lifted y0 / y1.
      const ribbon = (target: GeometryBuilder, a: number, b: number, y0: number, y1: number, color: Rgb) => {
        const ax0 = x0 + geo.nx[i0] * a;
        const az0 = z0 + geo.nz[i0] * a;
        const ax1 = x1 + geo.nx[i1] * a;
        const az1 = z1 + geo.nz[i1] * a;
        const bx1 = x1 + geo.nx[i1] * b;
        const bz1 = z1 + geo.nz[i1] * b;
        const bx0 = x0 + geo.nx[i0] * b;
        const bz0 = z0 + geo.nz[i0] * b;
        target.quadY(ax0, H(ax0, az0) + y0, az0, ax1, H(ax1, az1) + y0, az1, bx1, H(bx1, bz1) + y1, bz1, bx0, H(bx0, bz0) + y1, bz0, color);
      };
      ribbon(g.asphalt, -hw, hw, ROAD_Y, ROAD_Y, PLAIN);
      ribbon(g.solid, -hw, hw, ROAD_Y, ROAD_Y, PLAIN);

      // Sidewalks, curbs and verges on both sides — but not where they'd cross another road
      // (at junctions) or lie on a downtown block (whose slab is the sidewalk there).
      const midx = (x0 + x1) / 2;
      const midz = (z0 + z1) / 2;
      for (const side of [1, -1]) {
        const at = (o: number, i: number) => [p[i * 2] + geo.nx[i] * o * side, p[i * 2 + 1] + geo.nz[i] * o * side] as const;
        // Clear of every other road's surface (at both ends and the middle of this piece,
        // with half a metre to spare), so no sidewalk or verge juts into a junction as a curb.
        const blocked = (o: number) => {
          const [ax, az] = at(o, i0);
          const [bx, bz] = at(o, i1);
          for (const [x, z] of [[ax, az], [bx, bz], [(ax + bx) / 2, (az + bz) / 2]]) {
            if (net.kerbDistance(x, z, 10, e.id) < 0.5) return true;
            if (this.terrain.blockUnder(x, z)) return true;
          }
          return false;
        };
        // Sidewalks are always a curb above the road; the verge slopes from there (or from
        // the road edge, with no sidewalk) to the lawn level of the zone (raised in town).
        const lawn = lawnLift(this.terrain.zoneAt(midx + geo.nx[i0] * (hw + VERGE) * side, midz + geo.nz[i0] * (hw + VERGE) * side));
        const sw = spec.sidewalk;
        const up = sw > 0 ? CURB_HEIGHT : 0;
        if (sw > 0 && !blocked(hw + 0.05) && !blocked(hw + sw / 2) && !blocked(hw + sw)) {
          // Curb face: from the sidewalk top down to the road, facing the road.
          const [ax, az] = at(hw, i0);
          const [bx, bz] = at(hw, i1);
          g.pavement.wallY(ax, az, H(ax, az) + up, bx, bz, H(bx, bz) + up, up + 0.05, -geo.nx[i0] * side, -geo.nz[i0] * side, CONCRETE);
          ribbon(g.pavement, hw * side, (hw + sw) * side, up, up, PLAIN);
          ribbon(g.solid, hw * side, (hw + sw) * side, up, up, PLAIN);
        }
        // Grass verge out to where the terrain is back at its own level.
        const v0 = sw > 0 ? hw + sw : hw;
        if (!blocked(v0 + 0.5) && !blocked(hw + VERGE)) {
          const col = this.terrain.colorAt(midx + geo.nx[i0] * (hw + 3) * side, midz + geo.nz[i0] * (hw + 3) * side, geo.h[i0] + up, 0);
          ribbon(g.verge, v0 * side, (hw + VERGE + 0.4) * side, up, lawn, col);
          ribbon(g.solid, v0 * side, (hw + VERGE + 0.4) * side, up, lawn, col);
        }
      }
      this.markings(e, s, g.paint);
    }

    // Junction discs (cover where ribbons meet), dead-end caps and cul-de-sac circles.
    for (const id of own.nodes) {
      const n = net.nodes[id];
      if (!n.edges.length) continue;
      // Discs and rings are draped over the hill vertex by vertex too: a flat disc on a
      // slope stood proud of the road on its downhill side (another invisible step).
      const H = this.roadLevel;
      const lifted = (dy: number) => (x: number, z: number) => H(x, z) + dy;
      if (n.bulb) {
        const up = CURB_HEIGHT;
        const sw = ROAD_SPECS[net.edges[n.edges[0]].cls].sidewalk;
        disc(g.asphalt, n.x, n.z, lifted(JUNCTION_Y), n.bulb, PLAIN);
        disc(g.solid, n.x, n.z, lifted(JUNCTION_Y), n.bulb, PLAIN);
        // The sidewalk and verge go round the circle except across the street's mouth.
        const street = n.edges[0];
        const open = (x: number, z: number) => this.edgeDistance(street, x, z) < net.halfWidth(net.edges[street]) + 0.5;
        ring(g.pavement, n.x, n.z, lifted(up), n.bulb, n.bulb + sw, PLAIN, true, up + 0.05, open);
        ring(g.solid, n.x, n.z, lifted(up), n.bulb, n.bulb + sw, PLAIN, false, 0, open);
        const col = this.terrain.colorAt(n.x + n.bulb + 3, n.z, H(n.x, n.z) + up, 0);
        ring(g.verge, n.x, n.z, lifted(up), n.bulb + sw, n.bulb + VERGE + 0.5, col, false, 0, open);
        ring(g.solid, n.x, n.z, lifted(up), n.bulb + sw, n.bulb + VERGE + 0.5, col, false, 0, open);
        continue;
      }
      let hw = 0;
      for (const e of n.edges) hw = Math.max(hw, net.halfWidth(net.edges[e]));
      const r = n.edges.length >= 3 ? hw + 1.2 : hw;
      disc(g.asphalt, n.x, n.z, lifted(JUNCTION_Y), r, PLAIN);
      disc(g.solid, n.x, n.z, lifted(JUNCTION_Y), r, PLAIN);
    }
  }

  /** Paint for one segment of an edge: centre lines, lane lines, edge lines, stop lines, zebras. */
  private markings(e: StreetEdge, s: number, paint: GeometryBuilder): void {
    const net = this.net;
    const spec = ROAD_SPECS[e.cls];
    const geo = this.geoOf(e);
    const hw = spec.width / 2;
    const sa = e.cum[s];
    const sb = e.cum[s + 1];
    const segLen = sb - sa;
    if (segLen < 1e-3) return;
    const p = e.pts;
    const pt = (dist: number, off: number) => {
      const t = (dist - sa) / segLen;
      const nx = geo.nx[s] + (geo.nx[s + 1] - geo.nx[s]) * t;
      const nz = geo.nz[s] + (geo.nz[s + 1] - geo.nz[s]) * t;
      const x = p[s * 2] + (p[s * 2 + 2] - p[s * 2]) * t + nx * off;
      const z = p[s * 2 + 1] + (p[s * 2 + 3] - p[s * 2 + 1]) * t + nz * off;
      return [x, this.roadLevel(x, z) + PAINT_Y, z] as const;
    };
    // A painted strip `width` wide centred `off` m right of the centre line, from a to b,
    // clipped to this segment and to [lo, hi].
    const strip = (off: number, width: number, a: number, b: number, color: Rgb, lo: number, hi: number) => {
      a = Math.max(a, sa, lo);
      b = Math.min(b, sb, hi);
      if (b - a < 0.05) return;
      const [ax, ay, az] = pt(a, off - width / 2);
      const [bx, by, bz] = pt(b, off - width / 2);
      const [cx, cy, cz] = pt(b, off + width / 2);
      const [dx, dy, dz] = pt(a, off + width / 2);
      paint.quadY(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, color);
    };
    // Lines stop short of junctions (the disc has none).
    const rA = this.junctionRadius(e.a);
    const rB = this.junctionRadius(e.b);
    const lo = rA > 0 ? rA + (e.cls === 'downtown' ? 5 : 1.2) : 0;
    const hi = e.length - (rB > 0 ? rB + (e.cls === 'downtown' ? 5 : 1.2) : 0);
    const dashed = (off: number, width: number, on: number, period: number, color: Rgb) => {
      for (let d = Math.floor(sa / period) * period; d < sb; d += period) strip(off, width, d, d + on, color, lo, hi);
    };
    const solid = (off: number, width: number, color: Rgb) => strip(off, width, sa, sb, color, lo, hi);

    switch (e.cls) {
      case 'downtown':
      case 'arterial':
        solid(-0.17, 0.12, YELLOW);
        solid(0.17, 0.12, YELLOW);
        dashed(-3.5, 0.12, 3, 9, WHITE);
        dashed(3.5, 0.12, 3, 9, WHITE);
        break;
      case 'collector':
        dashed(0, 0.13, 3, 8, YELLOW);
        break;
      case 'rural':
        dashed(0, 0.14, 4, 10, YELLOW);
        solid(-hw + 0.35, 0.15, WHITE);
        solid(hw - 0.35, 0.15, WHITE);
        break;
      default:
        break; // quiet residential streets have no lines
    }

    // Stop lines (lights, or a stop sign on the smaller road) across the right-hand half
    // before a junction, and zebra crossings downtown. Traffic drives on the right: arriving
    // at b (travelling a → b) the right half is offsets 0…hw; arriving at a it's −hw…0.
    for (const [node, atEnd] of [
      [e.b, true],
      [e.a, false],
    ] as const) {
      const n = net.nodes[node];
      if (n.edges.length < 3) continue;
      const maxRank = Math.max(...n.edges.map((x) => ROAD_SPECS[net.edges[x].cls].rank));
      const stop = n.control === 'lights' || (n.control === 'stop' && spec.rank < maxRank);
      const r = this.junctionRadius(node);
      const zebra = e.cls === 'downtown';
      const lineAt = r + (zebra ? 4.6 : 0.8);
      if (stop) {
        if (atEnd) strip(hw / 2, hw - 0.4, e.length - lineAt - 0.45, e.length - lineAt, WHITE, -Infinity, Infinity);
        else strip(-hw / 2, hw - 0.4, lineAt, lineAt + 0.45, WHITE, -Infinity, Infinity);
      }
      if (zebra) {
        const z0 = atEnd ? e.length - r - 3.8 : r + 0.6;
        for (let o = -hw + 0.9; o <= hw - 0.9; o += 1.1) strip(o, 0.55, z0, z0 + 3.2, WHITE, -Infinity, Infinity);
      }
    }
  }

  /** Driveways and parking lots: concrete and asphalt on the lawn level, part of the collider. */
  private buildLots(own: Owned, g: Builders): void {
    const rect = (targets: GeometryBuilder[], r: Rect, y: number, color: Rgb, step = 8) => {
      const ux = Math.cos(r.yaw);
      const uz = -Math.sin(r.yaw);
      const vx = Math.sin(r.yaw);
      const vz = Math.cos(r.yaw);
      const na = Math.max(1, Math.ceil(r.w / step));
      const nb = Math.max(1, Math.ceil(r.d / step));
      const up = lawnLift(this.terrain.zoneAt(r.x, r.z));
      const P = (a: number, b: number) => {
        const la = -r.w / 2 + (r.w * a) / na;
        const lb = -r.d / 2 + (r.d * b) / nb;
        const x = r.x + ux * la + vx * lb;
        const z = r.z + uz * la + vz * lb;
        // A curb cut: within 1.5 m of a road the surface ramps down to road level, so a
        // driveway or lot entrance that meets a curving street never overhangs it as a lip.
        const ramp = smoothstep(-0.2, 1.5, this.net.kerbDistance(x, z, 10));
        return [x, this.terrain.smoothHeight(x, z) + (up + y) * ramp + 0.01, z] as const;
      };
      for (let a = 0; a < na; a++) {
        for (let b = 0; b < nb; b++) {
          const p0 = P(a, b);
          const p1 = P(a + 1, b);
          const p2 = P(a + 1, b + 1);
          const p3 = P(a, b + 1);
          for (const t of targets) t.quadY(...p0, ...p1, ...p2, ...p3, color);
        }
      }
    };
    for (const d of own.driveways) rect([g.pavement, g.solid], d, 0.02, CONCRETE, 6);
    for (const p of own.parcels) {
      for (const r of p.paved) rect([g.asphalt, g.solid], r, 0.03, PLAIN);
      for (const r of p.stalls) this.stallLines(r, g.paint);
      for (const f of p.fields) this.fieldLines(f, g.paint);
      for (const o of p.ponds) {
        // A pond: dark water in a shallow hollow (drawn just above the lawn).
        const y = this.terrain.smoothHeight(o.x, o.z) + lawnLift(this.terrain.zoneAt(o.x, o.z)) + 0.05;
        const c = Math.cos(o.yaw);
        const sn = Math.sin(o.yaw);
        const P = (a: number) => {
          const lx = Math.cos(a) * o.rx;
          const lz = Math.sin(a) * o.rz;
          return [o.x + c * lx + sn * lz, y, o.z - sn * lx + c * lz] as const;
        };
        for (let i = 0; i < 24; i++) {
          const a0 = (i / 24) * Math.PI * 2;
          const a1 = ((i + 1) / 24) * Math.PI * 2;
          g.paint.quadY(o.x, y, o.z, ...P(a0), ...P(a1), o.x, y, o.z, POND);
        }
      }
    }
  }

  /** A sports field's markings: the boundary, the halfway line and the centre circle. */
  private fieldLines(r: Rect, paint: GeometryBuilder): void {
    const ux = Math.cos(r.yaw);
    const uz = -Math.sin(r.yaw);
    const vx = Math.sin(r.yaw);
    const vz = Math.cos(r.yaw);
    const up = lawnLift(this.terrain.zoneAt(r.x, r.z)) + 0.04;
    const P = (a: number, b: number) => {
      const x = r.x + ux * a + vx * b;
      const z = r.z + uz * a + vz * b;
      return [x, this.terrain.smoothHeight(x, z) + up, z] as const;
    };
    const w = 0.15;
    const line = (a0: number, b0: number, a1: number, b1: number) => {
      const l = Math.hypot(a1 - a0, b1 - b0) || 1;
      const na = (-(b1 - b0) / l) * w;
      const nb = ((a1 - a0) / l) * w;
      paint.quadY(...P(a0 - na, b0 - nb), ...P(a1 - na, b1 - nb), ...P(a1 + na, b1 + nb), ...P(a0 + na, b0 + nb), WHITE);
    };
    const hw = r.w / 2 - 2;
    const hd = r.d / 2 - 2;
    line(-hw, -hd, hw, -hd);
    line(hw, -hd, hw, hd);
    line(hw, hd, -hw, hd);
    line(-hw, hd, -hw, -hd);
    line(-hw, 0, hw, 0);
    for (let i = 0; i < 16; i++) {
      const a0 = (i / 16) * Math.PI * 2;
      const a1 = ((i + 1) / 16) * Math.PI * 2;
      line(Math.cos(a0) * 8, Math.sin(a0) * 8, Math.cos(a1) * 8, Math.sin(a1) * 8);
    }
  }

  /** Parking-bay lines: double rows of 5.5 m × 2.7 m stalls, with a driving aisle between pairs. */
  private stallLines(r: Rect, paint: GeometryBuilder): void {
    const ux = Math.cos(r.yaw);
    const uz = -Math.sin(r.yaw);
    const vx = Math.sin(r.yaw);
    const vz = Math.cos(r.yaw);
    const up = lawnLift(this.terrain.zoneAt(r.x, r.z));
    // A line along the depth direction at `a`, from depth b0 to b1, 0.12 m wide.
    const line = (a: number, b0: number, b1: number) => {
      const P = (la: number, lb: number) => {
        const x = r.x + ux * la + vx * lb;
        const z = r.z + uz * la + vz * lb;
        return [x, this.terrain.smoothHeight(x, z) + up + 0.06, z] as const;
      };
      paint.quadY(...P(a - 0.06, b0), ...P(a + 0.06, b0), ...P(a + 0.06, b1), ...P(a - 0.06, b1), WHITE);
    };
    for (let b = -r.d / 2; b + 5.5 <= r.d / 2 + 0.01; b += 18) {
      for (let a = -r.w / 2; a <= r.w / 2 + 0.01; a += 2.7) {
        line(a, b, b + 5.5);
        if (b + 11 <= r.d / 2 + 0.01) line(a, b + 5.5, b + 11);
      }
    }
  }

  /** Lowest and highest surface height under a building's footprint (+ `lift`). */
  private footing(bl: Building, lift: number): { low: number; high: number } {
    let low = Infinity;
    let high = -Infinity;
    const yaw = bl.yaw ?? 0;
    const ux = Math.cos(yaw);
    const uz = -Math.sin(yaw);
    // Corners and edge midpoints: the hills are smooth, so this catches the extremes.
    for (const [fx, fz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0], [0, 0]]) {
      const a = (fx * bl.width) / 2;
      const b = (fz * bl.depth) / 2;
      // Width along u = (cos, −sin), depth along v = (sin, cos) = (−uz, ux).
      const x = bl.x + ux * a - uz * b;
      const z = bl.z + uz * a + ux * b;
      const h = this.terrain.smoothHeight(x, z) + lift;
      low = Math.min(low, h);
      high = Math.max(high, h);
    }
    return { low, high };
  }

  /**
   * A downtown block's raised slab, draped over the smooth hills so it sits exactly
   * CURB_HEIGHT above the roads all round: a top grid every 8 m, curb faces down each side,
   * the lawn over the lot, and a triangle-mesh collider matching the top.
   */
  private buildBlockSurface(block: Block, g: Builders, collider: (desc: RAPIER.ColliderDesc) => void): void {
    const n = BLOCK_GRID;
    const half = BLOCK_SIZE / 2;
    const step = BLOCK_SIZE / n;
    const top = (x: number, z: number) => this.terrain.blockHeight(block, x, z) + CURB_HEIGHT;
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const x0 = block.cx - half + ix * step;
        const z0 = block.cz - half + iz * step;
        g.pavement.quad(x0, z0, x0 + step, z0, x0 + step, z0 + step, x0, z0 + step, top, 0, PLAIN);
      }
    }
    // Curb faces: from the sidewalk top down below the road on all four sides.
    for (let i = 0; i < n; i++) {
      const a = -half + i * step;
      const b = a + step;
      g.pavement.wall(block.cx + a, block.cz - half, block.cx + b, block.cz - half, top, CURB_HEIGHT + 0.5, 0, -1, PLAIN);
      g.pavement.wall(block.cx + a, block.cz + half, block.cx + b, block.cz + half, top, CURB_HEIGHT + 0.5, 0, 1, PLAIN);
      g.pavement.wall(block.cx - half, block.cz + a, block.cx - half, block.cz + b, top, CURB_HEIGHT + 0.5, -1, 0, PLAIN);
      g.pavement.wall(block.cx + half, block.cz + a, block.cx + half, block.cz + b, top, CURB_HEIGHT + 0.5, 1, 0, PLAIN);
    }
    if (block.lawn) {
      const ln = 7;
      const ls = LOT / ln;
      for (let iz = 0; iz < ln; iz++) {
        for (let ix = 0; ix < ln; ix++) {
          const x0 = block.cx - LOT / 2 + ix * ls;
          const z0 = block.cz - LOT / 2 + iz * ls;
          g.lawn.quad(x0, z0, x0 + ls, z0, x0 + ls, z0 + ls, x0, z0 + ls, top, 0.02, PLAIN);
        }
      }
    }
    // Collider: a triangle mesh over the same draped top grid.
    const vertices = new Float32Array((n + 1) * (n + 1) * 3);
    for (let iz = 0; iz <= n; iz++) {
      for (let ix = 0; ix <= n; ix++) {
        const x = block.cx - half + ix * step;
        const z = block.cz - half + iz * step;
        vertices.set([x, top(x, z), z], (iz * (n + 1) + ix) * 3);
      }
    }
    const indices = new Uint32Array(n * n * 6);
    for (let iz = 0, k = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++, k += 6) {
        const a = iz * (n + 1) + ix;
        indices.set([a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2], k);
      }
    }
    collider(RAPIER.ColliderDesc.trimesh(vertices, indices));
  }

  // ------------------------------------------------------------------ near tier

  private buildNear(c: Chunk): void {
    const t: TierContents = { meshes: [], colliders: [], slots: [] };
    const take = (pool: InstancePool) => {
      const slot = pool.alloc();
      if (slot >= 0) t.slots.push([pool, slot]);
      return slot;
    };
    const collider = (desc: RAPIER.ColliderDesc) => t.colliders.push(this.world.createCollider(desc));
    const p = this.pools;
    const own = this.owned[c.cz * CHUNKS + c.cx];

    const tree = (tr: Tree, y: number) => {
      const yaw = tr.hue * Math.PI * 2;
      p.trunks.place(take(p.trunks), tr.x, y, tr.z, tr.scale, tr.scale, tr.scale, yaw);
      const slot = take(p.canopies);
      p.canopies.place(slot, tr.x, y, tr.z, tr.scale, tr.scale, tr.scale, yaw);
      p.canopies.setColor(slot, _color.setHSL(0.22 + tr.hue * 0.09, 0.45, 0.16 + tr.hue * 0.08));
      collider(RAPIER.ColliderDesc.cylinder(1.4 * tr.scale, 0.2 * tr.scale).setTranslation(tr.x, y + 1.4 * tr.scale, tr.z));
    };
    const lamp = (x: number, z: number, yaw: number, y: number) => {
      p.lamps.place(take(p.lamps), x, y, z, 1, 1, 1, yaw);
      p.lampHeads.place(take(p.lampHeads), x, y, z, 1, 1, 1, yaw);
      // Ground point under the luminaire (over the road): the arm's +X direction after
      // yawing by `yaw`.
      const gx = x + Math.cos(yaw) * LAMP_HEAD_OUT;
      const gz = z - Math.sin(yaw) * LAMP_HEAD_OUT;
      p.lightPools.place(take(p.lightPools), gx, this.terrain.surfaceAt(gx, gz) + 0.06, gz);
      collider(RAPIER.ColliderDesc.cylinder(3.5, 0.12).setTranslation(x, y + 3.5, z));
    };

    for (let bz = c.cz * CHUNK_CELLS; bz < (c.cz + 1) * CHUNK_CELLS; bz++) {
      for (let bx = c.cx * CHUNK_CELLS; bx < (c.cx + 1) * CHUNK_CELLS; bx++) {
        const block = this.layout.blockAt(bx, bz);
        if (!block) continue;
        const top = (x: number, z: number) => this.terrain.blockHeight(block, x, z) + CURB_HEIGHT;
        for (const prop of block.roofProps) {
          // Roof height is set by the building's highest corner (see buildFar).
          const pool = prop.kind === 'ac' ? p.acs : p.tanks;
          pool.place(take(pool), prop.x, this.footing(prop.building, 0).high + CURB_HEIGHT + prop.y, prop.z, ...prop.size, 0);
        }
        for (const tr of block.trees) tree(tr, top(tr.x, tr.z) - 0.05);
        for (const l of block.lamps) lamp(l.x, l.z, l.yaw, top(l.x, l.z) - 0.05);
      }
    }

    // Garden, street and park trees in the suburbs.
    for (const tr of own.trees) tree(tr, this.terrain.surfaceAt(tr.x, tr.z) - 0.05);

    for (const parcel of own.parcels) {
      const up = lawnLift(this.terrain.zoneAt(parcel.x, parcel.z));
      // Gas station: a flat canopy on four posts over two islands of pumps.
      const cnp = parcel.canopy;
      if (cnp) {
        const ux = Math.cos(cnp.yaw);
        const uz = -Math.sin(cnp.yaw);
        const vx = Math.sin(cnp.yaw);
        const vz = Math.cos(cnp.yaw);
        const y = this.terrain.smoothHeight(cnp.x, cnp.z) + up;
        p.acs.place(take(p.acs), cnp.x, y + 4.6, cnp.z, cnp.w, 0.7, cnp.d, cnp.yaw);
        for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const x = cnp.x + ux * a * (cnp.w / 2 - 1.5) + vx * b * (cnp.d / 2 - 1.5);
          const z = cnp.z + uz * a * (cnp.w / 2 - 1.5) + vz * b * (cnp.d / 2 - 1.5);
          p.acs.place(take(p.acs), x, y, z, 0.4, 4.6, 0.4, cnp.yaw);
          collider(RAPIER.ColliderDesc.cuboid(0.2, 2.3, 0.2).setTranslation(x, y + 2.3, z));
        }
        for (const a of [-6, -2, 2, 6]) {
          const x = cnp.x + ux * a;
          const z = cnp.z + uz * a;
          p.acs.place(take(p.acs), x, y, z, 0.9, 1.7, 0.6, cnp.yaw);
          collider(RAPIER.ColliderDesc.cuboid(0.45, 0.85, 0.3).setTranslation(x, y + 0.85, z).setRotation({ x: 0, y: Math.sin(cnp.yaw / 2), z: 0, w: Math.cos(cnp.yaw / 2) }));
        }
      }
      // Parked cars in about a third of the stalls.
      const rng = new Rng(hashSeed(this.layout.seed, Math.round(parcel.x), Math.round(parcel.z)));
      for (const r of parcel.stalls) {
        const ux = Math.cos(r.yaw);
        const uz = -Math.sin(r.yaw);
        const vx = Math.sin(r.yaw);
        const vz = Math.cos(r.yaw);
        for (let b = -r.d / 2; b + 5.5 <= r.d / 2 + 0.01; b += 18) {
          for (const row of [0, 1]) {
            if (row === 1 && b + 11 > r.d / 2 + 0.01) continue;
            for (let a = -r.w / 2 + 1.35; a < r.w / 2; a += 2.7) {
              if (!rng.chance(0.35)) continue;
              const lb = b + 2.75 + row * 5.5;
              const x = r.x + ux * a + vx * lb;
              const z = r.z + uz * a + vz * lb;
              // Nose in: the first row faces +v (toward the shops), the second −v.
              const fx = row === 0 ? vx : -vx;
              const fz = row === 0 ? vz : -vz;
              const yaw = Math.atan2(-fz, fx) + rng.range(-0.04, 0.04);
              const y = this.terrain.smoothHeight(x, z) + up + 0.03;
              this.parkedCar(take, collider, x, y, z, yaw, PAINT_COLORS[rng.int(0, PAINT_COLORS.length - 1)]);
            }
          }
        }
      }
    }

    // Street lamps along arterials and collectors, alternating sides.
    const pt = { x: 0, z: 0, tx: 0, tz: 0 };
    for (let k = 0; k < own.segs.length; k += 2) {
      const e = this.net.edges[own.segs[k]];
      if (e.cls !== 'arterial' && e.cls !== 'collector') continue;
      const s = own.segs[k + 1];
      const sa = e.cum[s];
      const sb = e.cum[s + 1];
      const period = e.cls === 'arterial' ? 40 : 55;
      const spec = ROAD_SPECS[e.cls];
      for (let d = Math.ceil(sa / period) * period; d < sb; d += period) {
        if (d < 15 || d > e.length - 15) continue;
        const side = Math.round(d / period) % 2 === 0 ? 1 : -1;
        this.net.pointAt(e, d, pt);
        // Right of travel is (−tz, tx).
        const nx = -pt.tz * side;
        const nz = pt.tx * side;
        const off = spec.width / 2 + 0.5;
        const x = pt.x + nx * off;
        const z = pt.z + nz * off;
        if (this.net.kerbDistance(x, z, 10, e.id) < 1) continue;
        // The arm (+X after yaw, i.e. (cos yaw, −sin yaw)) points back over the road, (−nx, −nz).
        const yaw = Math.atan2(nz, -nx);
        lamp(x, z, yaw, this.terrain.surfaceAt(x, z) - 0.05);
      }
    }

    // Countryside trees (low-poly pines and broadleaves, one pool).
    for (const tr of c.rural?.trees ?? []) {
      const slot = take(p.forest);
      if (slot < 0) continue; // pool full: no tree, and so no (invisible) collider either
      p.forest.place(slot, tr.x, tr.y - 0.2, tr.z, tr.scale, tr.scale * (0.9 + tr.hue * 0.3), tr.scale, tr.hue * Math.PI * 2);
      p.forest.setColor(slot, _color.setHSL(0.25 + tr.hue * 0.08, 0.55, 0.06 + tr.hue * 0.05));
      collider(RAPIER.ColliderDesc.cylinder(2 * tr.scale, 0.25 * tr.scale).setTranslation(tr.x, tr.y + 2 * tr.scale, tr.z));
    }
    c.near = t;
  }

  /** A parked sedan (body, glass, tyres and a box collider), facing yaw (its forward is +X). */
  private parkedCar(
    take: (pool: InstancePool) => number,
    collider: (desc: RAPIER.ColliderDesc) => void,
    x: number,
    y: number,
    z: number,
    yaw: number,
    color: number,
  ): void {
    const p = this.pools;
    const d = CAR_DIMENSIONS.sedan;
    const body = take(p.parkedBodies);
    p.parkedBodies.place(body, x, y, z, 1, 1, 1, yaw);
    p.parkedBodies.setColor(body, _color.set(color));
    p.parkedGlass.place(take(p.parkedGlass), x, y, z, 1, 1, 1, yaw);
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    for (const [wx, wz] of [[d.wheelBase / 2, d.track / 2], [d.wheelBase / 2, -d.track / 2], [-d.wheelBase / 2, d.track / 2], [-d.wheelBase / 2, -d.track / 2]]) {
      // Car-local (wx, wz) → world: x' = x + wx·cos + wz·sin, z' = z − wx·sin + wz·cos.
      p.parkedTyres.place(take(p.parkedTyres), x + wx * c + wz * s, y + d.wheelRadius, z - wx * s + wz * c, 1, 1, 1, yaw);
    }
    _quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    collider(
      RAPIER.ColliderDesc.cuboid(d.boxHalf[0], d.boxHalf[1], d.boxHalf[2])
        .setTranslation(x + d.boxCenter[0] * c, y + d.boxCenter[1], z - d.boxCenter[0] * s)
        .setRotation({ x: _quat.x, y: _quat.y, z: _quat.z, w: _quat.w }),
    );
  }
}

const _quat = new THREE.Quaternion();

interface Builders {
  asphalt: GeometryBuilder;
  paint: GeometryBuilder;
  pavement: GeometryBuilder;
  verge: GeometryBuilder;
  lawn: GeometryBuilder;
  /** Everything walkable / drivable, for the chunk's trimesh collider. */
  solid: GeometryBuilder;
}

/**
 * A circle of radius r draped over `y(x, z)`: a fan out to half the radius, then a ring, so
 * it bends with the hill instead of being one flat plate.
 */
function disc(b: GeometryBuilder, x: number, z: number, y: (x: number, z: number) => number, r: number, color: Rgb): void {
  const n = 20;
  const yc = y(x, z);
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const hx0 = x + Math.cos(a0) * r * 0.5;
    const hz0 = z + Math.sin(a0) * r * 0.5;
    const hx1 = x + Math.cos(a1) * r * 0.5;
    const hz1 = z + Math.sin(a1) * r * 0.5;
    b.quadY(x, yc, z, hx0, y(hx0, hz0), hz0, hx1, y(hx1, hz1), hz1, x, yc, z, color);
  }
  ring(b, x, z, y, r * 0.5, r, color, false, 0);
}

/**
 * A ring from r0 to r1 draped over `y(x, z)`; with `curb`, a vertical face `drop` deep at
 * r0, facing in.
 */
function ring(
  b: GeometryBuilder,
  x: number,
  z: number,
  y: (x: number, z: number) => number,
  r0: number,
  r1: number,
  color: Rgb,
  curb: boolean,
  drop: number,
  /** Leave out pieces whose middle is here (e.g. where a street runs through). */
  skip?: (x: number, z: number) => boolean,
): void {
  const n = 24;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    const p = (c: number, s: number, r: number) => {
      const px = x + c * r;
      const pz = z + s * r;
      return [px, y(px, pz), pz] as const;
    };
    if (skip) {
      const cm = Math.cos((a0 + a1) / 2);
      const sm = Math.sin((a0 + a1) / 2);
      // Any part of the piece over the street (its corners or its middle) leaves it out.
      const pts: [number, number][] = [
        [x + cm * (r0 + r1) / 2, z + sm * (r0 + r1) / 2],
        [x + c0 * r0, z + s0 * r0],
        [x + c1 * r0, z + s1 * r0],
        [x + c0 * r1, z + s0 * r1],
        [x + c1 * r1, z + s1 * r1],
      ];
      if (pts.some(([px, pz]) => skip(px, pz))) continue;
    }
    b.quadY(...p(c0, s0, r0), ...p(c0, s0, r1), ...p(c1, s1, r1), ...p(c1, s1, r0), color);
    if (curb) {
      const [ax, ay, az] = p(c0, s0, r0);
      const [bx, by, bz] = p(c1, s1, r0);
      b.wallY(ax, az, ay, bx, bz, by, drop, -(c0 + c1) / 2, -(s0 + s1) / 2, CONCRETE);
    }
  }
}

/** Builds quads (draped or with explicit heights) and vertical faces, with colours. */
class GeometryBuilder {
  private readonly positions: number[] = [];
  private readonly colors: number[] = [];
  private readonly indices: number[] = [];

  get empty(): boolean {
    return this.positions.length === 0;
  }

  /** A quad with explicit corner heights; faces up whatever order the corners come in. */
  quadY(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    x2: number, y2: number, z2: number,
    x3: number, y3: number, z3: number,
    color: Rgb,
  ): void {
    const base = this.positions.length / 3;
    this.positions.push(x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3);
    for (let k = 0; k < 4; k++) this.colors.push(color[0], color[1], color[2]);
    // The y component of (p1 − p0) × (p2 − p0) is positive for an upward face.
    const up = (z1 - z0) * (x2 - x0) - (x1 - x0) * (z2 - z0) > 0;
    if (up) this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else this.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }

  /** A quad draped over `height(x, z)` + `lift`. */
  quad(
    x0: number, z0: number, x1: number, z1: number, x2: number, z2: number, x3: number, z3: number,
    height: (x: number, z: number) => number,
    lift: number,
    color: Rgb,
  ): void {
    this.quadY(x0, height(x0, z0) + lift, z0, x1, height(x1, z1) + lift, z1, x2, height(x2, z2) + lift, z2, x3, height(x3, z3) + lift, z3, color);
  }

  /** A vertical face along (x0, z0)–(x1, z1): top edge at `top(x, z)`, `drop` deep, facing (nx, nz). */
  wall(x0: number, z0: number, x1: number, z1: number, top: (x: number, z: number) => number, drop: number, nx: number, nz: number, color: Rgb): void {
    this.wallY(x0, z0, top(x0, z0), x1, z1, top(x1, z1), drop, nx, nz, color);
  }

  /** A vertical face with explicit top heights t0, t1. */
  wallY(x0: number, z0: number, t0: number, x1: number, z1: number, t1: number, drop: number, nx: number, nz: number, color: Rgb): void {
    const base = this.positions.length / 3;
    this.positions.push(x0, t0, z0, x1, t1, z1, x1, t1 - drop, z1, x0, t0 - drop, z0);
    for (let k = 0; k < 4; k++) this.colors.push(color[0], color[1], color[2]);
    // Winding so the face points along (nx, nz): its normal is (p1 − p0) × (p3 − p0), which
    // with p1 − p0 = (dx, ·, dz) and p3 − p0 = (0, −drop, 0) is (−dz·drop, 0, dx·drop) —
    // flip the order if that points inward.
    const dx = x1 - x0;
    const dz = z1 - z0;
    const outward = -dz * nx + dx * nz > 0;
    if (outward) this.indices.push(base, base + 3, base + 2, base, base + 2, base + 1);
    else this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Raw arrays (for a trimesh collider). */
  raw(): { vertices: Float32Array; indices: Uint32Array } {
    return { vertices: new Float32Array(this.positions), indices: new Uint32Array(this.indices) };
  }

  /** `uvSize`: metres per texture repeat (world-space UVs, so textures never stretch). */
  build(uvSize = 10): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    const uv: number[] = [];
    // Top faces map x/z; mixing y into v gives the vertical curb faces some texture too.
    for (let i = 0; i < this.positions.length; i += 3) uv.push(this.positions[i] / uvSize, (this.positions[i + 2] - this.positions[i + 1]) / uvSize);
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(this.indices);
    g.computeVertexNormals();
    return g;
  }
}
