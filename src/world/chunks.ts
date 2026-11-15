import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  BLOCK_SIZE,
  CELLS,
  CURB_HEIGHT,
  PITCH,
  LOT,
  ROAD_WIDTH,
  RURAL_ROAD_WIDTH,
  lineCoord,
  ruralFeatures,
  type Block,
  type Building,
  type CityLayout,
  type Tree,
} from './layout';
import type { InstancePool } from './instancePool';
import type { Terrain } from './terrain';

// Streaming: the world is cut into CHUNKS × CHUNKS square chunks of 4 × 4 grid cells
// (312 m). Only chunks near the player have meshes and colliders, in two tiers:
//
//   far  (within ~850 m): terrain mesh + heightfield collider, roads and markings, block
//        slabs, buildings, roofs (and their colliders). Enough to see the town skyline and
//        to drive anywhere you can reach.
//   near (within ~400 m): the small stuff — street and forest trees, lamps, rooftop clutter.
//
// Chunks load and unload with some hysteresis (the unload distance is larger than the load
// distance) so walking back and forth over a boundary doesn't thrash. Building a chunk is
// the expensive part, so work is queued and done a step at a time within a per-frame budget.
//
// Repeated objects go into shared InstancePools (one draw call each, whatever is loaded);
// per-chunk meshes are only the terrain, the road surface and the road markings.

export const CHUNK_CELLS = 4;
export const CHUNK_SIZE = CHUNK_CELLS * PITCH; // 312 m
export const CHUNKS = CELLS / CHUNK_CELLS; // 13
const FAR_LOAD = 850;
const FAR_UNLOAD = 1000;
const NEAR_LOAD = 400;
const NEAR_UNLOAD = 520;
/** Terrain sample spacing inside a chunk (mesh and collider share it). */
const TERRAIN_STEP = 6;
const TERRAIN_SEGMENTS = Math.round(CHUNK_SIZE / TERRAIN_STEP); // 52
const ROAD_Y = 0.03; // road surface above the ground (avoids z-fighting)
const PAINT_Y = 0.05;

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

type Job = { chunk: Chunk; tier: 'far' | 'near' };

const _color = new THREE.Color();
/** Town block sidewalks are draped over the hills on a grid of BLOCK_GRID × BLOCK_GRID quads. */
const BLOCK_GRID = 8;
export const LAMP_HEAD_OUT = 1.8; // m from the pole to the luminaire

export class WorldStreamer {
  private readonly chunks: Chunk[] = [];
  /** 1 where a chunk's far tier (terrain collider) is loaded; read by the far-terrain shader. */
  readonly loadedMask = new Uint8Array(CHUNKS * CHUNKS);
  readonly loadedTexture: THREE.DataTexture;
  private queue: Job[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: RAPIER.World,
    private readonly layout: CityLayout,
    private readonly terrain: Terrain,
    private readonly pools: WorldPools,
    private readonly materials: ChunkMaterials,
  ) {
    for (let cz = 0; cz < CHUNKS; cz++) {
      for (let cx = 0; cx < CHUNKS; cx++) this.chunks.push({ cx, cz, far: null, near: null, rural: null });
    }
    this.loadedTexture = new THREE.DataTexture(this.loadedMask, CHUNKS, CHUNKS, THREE.RedFormat, THREE.UnsignedByteType);
    this.loadedTexture.needsUpdate = true;
  }

  /** Grid → world through the road warp (a fresh object each call, safe to keep). */
  private readonly toWorld = (gx: number, gz: number): { x: number; z: number } => {
    const w = this.layout.warp.forward(gx, gz);
    return { x: w.x, z: w.z };
  };

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

  /**
   * Call every frame with the player's position. Unloads far-away chunks at once and builds
   * queued ones, nearest first, for up to `budgetMs` milliseconds (at least one job).
   */
  update(focus: THREE.Vector3, budgetMs = 4): void {
    const jobs: (Job & { d: number })[] = [];
    for (const c of this.chunks) {
      const d = this.distance(c, focus.x, focus.z);
      if (c.near && d > NEAR_UNLOAD) this.unload(c, 'near');
      if (c.far && d > FAR_UNLOAD) {
        if (c.near) this.unload(c, 'near');
        this.unload(c, 'far');
      }
      if (!c.far && d < FAR_LOAD) jobs.push({ chunk: c, tier: 'far', d });
      else if (c.far && !c.near && d < NEAR_LOAD) jobs.push({ chunk: c, tier: 'near', d });
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
      if (!c.far && d < FAR_LOAD) this.buildFar(c);
      if (c.far && !c.near && d < NEAR_LOAD) this.buildNear(c);
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
    this.buildTerrain(b, t);
    this.buildRoads(c, t);

    const take = (pool: InstancePool) => {
      const slot = pool.alloc();
      if (slot >= 0) t.slots.push([pool, slot]);
      return slot;
    };
    const collider = (desc: RAPIER.ColliderDesc) => t.colliders.push(this.world.createCollider(desc));

    // Town blocks: raised sidewalk + lot draped over the hills, lawn, buildings.
    const buildings: (Building & { yaw?: number })[] = [];
    const pavement = new GeometryBuilder(this.toWorld);
    const lawn = new GeometryBuilder(this.toWorld);
    for (let bz = c.cz * CHUNK_CELLS; bz < (c.cz + 1) * CHUNK_CELLS; bz++) {
      for (let bx = c.cx * CHUNK_CELLS; bx < (c.cx + 1) * CHUNK_CELLS; bx++) {
        const block = this.layout.blockAt(bx, bz);
        if (!block) continue;
        this.buildBlockSurface(block, pavement, lawn, collider);
        // Buildings stand upright on the slope: base at the footprint's lowest corner, walls
        // taller by the drop so the roof is level with where it would be on flat ground at
        // the highest corner (the uphill side is set into the hill).
        for (const bl of block.buildings) {
          const f = this.footing(block, bl);
          const w = this.toWorld(bl.x, bl.z);
          buildings.push({
            ...bl,
            x: w.x,
            z: w.z,
            y: f.low + CURB_HEIGHT - 0.05,
            height: bl.height + (f.high - f.low) + 0.05,
            yaw: this.layout.warp.angle(bl.x, bl.z),
          });
        }
      }
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
    for (const [b, material, uvSize] of [
      [pavement, this.materials.pavement, 8],
      [lawn, this.materials.lawn, 6],
    ] as const) {
      if (b.empty) continue;
      const mesh = new THREE.Mesh(b.build(uvSize), material);
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      t.meshes.push(mesh);
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

  /** Road surface (asphalt) and paint for the segments and intersections in this chunk. */
  private buildRoads(c: Chunk, t: TierContents): void {
    const roads = this.layout.roads;
    const asphalt = new GeometryBuilder(this.toWorld);
    const paint = new GeometryBuilder(this.toWorld);
    const white = { b: paint, color: [0.85, 0.85, 0.8] as const };
    const yellow = { b: paint, color: [0.85, 0.62, 0.17] as const };
    const surface = { b: asphalt, color: [1, 1, 1] as const };
    const h = (x: number, z: number) => this.terrain.smoothHeight(x, z);
    const i0 = c.cx * CHUNK_CELLS;
    const k0 = c.cz * CHUNK_CELLS;
    // The last chunk row/column also owns the outermost grid line.
    const i1 = i0 + CHUNK_CELLS + (c.cx === CHUNKS - 1 ? 1 : 0);
    const k1 = k0 + CHUNK_CELLS + (c.cz === CHUNKS - 1 ? 1 : 0);

    // A strip along a road segment: `fixed` is the line's coordinate, from/to run along it.
    const strip = (
      target: { b: GeometryBuilder; color: readonly [number, number, number] },
      alongZ: boolean,
      fixed: number,
      offset: number,
      from: number,
      to: number,
      width: number,
      y: number,
    ) => {
      const steps = Math.max(1, Math.ceil((to - from) / 8));
      for (let s = 0; s < steps; s++) {
        const a = from + ((to - from) * s) / steps;
        const e = from + ((to - from) * (s + 1)) / steps;
        const w = width / 2;
        if (alongZ) {
          const x = fixed + offset;
          target.b.quad(x - w, a, x + w, a, x + w, e, x - w, e, h, y, target.color);
        } else {
          const z = fixed + offset;
          target.b.quad(a, z + w, a, z - w, e, z - w, e, z + w, h, y, target.color);
        }
      }
    };

    const segment = (
      alongZ: boolean,
      fixed: number,
      from: number,
      to: number,
      rural: boolean,
      halfStart: number,
      halfEnd: number,
      lightsAtStart: boolean,
      lightsAtEnd: boolean,
      townStart: boolean,
      townEnd: boolean,
    ) => {
      const half = (rural ? RURAL_ROAD_WIDTH : ROAD_WIDTH) / 2;
      const start = from + halfStart;
      const end = to - halfEnd;
      strip(surface, alongZ, fixed, 0, start, end, half * 2, ROAD_Y);
      const CROSSWALK = 3.2;
      const GAP = 0.6;
      const linesFrom = start + (townStart ? GAP + CROSSWALK + 1.2 : 1);
      const linesTo = end - (townEnd ? GAP + CROSSWALK + 1.2 : 1);
      if (rural) {
        // Country road, one lane each way: a dashed yellow centre line (overtaking allowed)
        // and solid white edge lines.
        for (let s = linesFrom + 1; s + 4 < linesTo; s += 10) strip(yellow, alongZ, fixed, 0, s, s + 4, 0.14, PAINT_Y);
        strip(white, alongZ, fixed, -half + 0.35, start, end, 0.15, PAINT_Y);
        strip(white, alongZ, fixed, half - 0.35, start, end, 0.15, PAINT_Y);
        return;
      }
      // Town road, two lanes each way: double yellow centre line, dashed lane dividers.
      strip(yellow, alongZ, fixed, -0.17, linesFrom, linesTo, 0.12, PAINT_Y);
      strip(yellow, alongZ, fixed, 0.17, linesFrom, linesTo, 0.12, PAINT_Y);
      for (let s = linesFrom + 2; s + 3 < linesTo - 2; s += 9) {
        strip(white, alongZ, fixed, -3.5, s, s + 3, 0.12, PAINT_Y);
        strip(white, alongZ, fixed, 3.5, s, s + 3, 0.12, PAINT_Y);
      }
      // Stop lines where there are traffic lights (traffic drives on the right).
      if (lightsAtEnd) strip(white, alongZ, fixed, -half / 2 - 0.1, linesTo, linesTo + 0.45, half - 0.4, PAINT_Y);
      if (lightsAtStart) strip(white, alongZ, fixed, half / 2 + 0.1, linesFrom - 0.45, linesFrom, half - 0.4, PAINT_Y);
      // Zebra crossings at town intersections: stripes parallel to the road, across it.
      const zebra = (a: number, e: number) => {
        for (let o = -half + 0.9; o <= half - 0.9; o += 1.1) strip(white, alongZ, fixed, o, a, e, 0.55, PAINT_Y);
      };
      if (townStart) zebra(start + GAP, start + GAP + CROSSWALK);
      if (townEnd) zebra(end - GAP - CROSSWALK, end - GAP);
    };

    const townNode = (i: number, k: number) => roads.townNode(i, k);
    const nh = (i: number, k: number) => roads.nodeHalf(i, k);

    for (let k = k0; k < k1; k++) {
      for (let i = i0; i < i1; i++) {
        // Segment along X from node (i, k) to (i+1, k).
        if (roads.hasH(i, k)) {
          segment(false, lineCoord(k), lineCoord(i), lineCoord(i + 1), roads.ruralH(i, k), nh(i, k), nh(i + 1, k), roads.hasLights(i, k), roads.hasLights(i + 1, k), townNode(i, k), townNode(i + 1, k));
        }
        // Segment along Z from node (i, k) to (i, k+1).
        if (roads.hasV(i, k)) {
          segment(true, lineCoord(i), lineCoord(k), lineCoord(k + 1), roads.ruralV(i, k), nh(i, k), nh(i, k + 1), roads.hasLights(i, k), roads.hasLights(i, k + 1), townNode(i, k), townNode(i, k + 1));
        }
        // Intersection square (2 × 2 quads, so it follows the warp and the hill).
        if (roads.hasH(i, k) || roads.hasH(i - 1, k) || roads.hasV(i, k) || roads.hasV(i, k - 1)) {
          const x = lineCoord(i);
          const z = lineCoord(k);
          const half = nh(i, k);
          for (const [ox, oz] of [[-half, -half], [0, -half], [-half, 0], [0, 0]]) {
            asphalt.quad(x + ox, z + oz + half, x + ox + half, z + oz + half, x + ox + half, z + oz, x + ox, z + oz, h, ROAD_Y, surface.color);
          }
        }
      }
    }

    const add = (b: GeometryBuilder, material: THREE.Material) => {
      if (b.empty) return;
      const mesh = new THREE.Mesh(b.build(), material);
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      t.meshes.push(mesh);
    };
    add(asphalt, this.materials.road);
    add(paint, this.materials.paint);
  }

  /** Lowest and highest ground height (road level) under a town building's footprint. */
  private footing(block: Block, bl: Building): { low: number; high: number } {
    let low = Infinity;
    let high = -Infinity;
    // Corners and edge midpoints: the hills are smooth, so this catches the extremes.
    for (const [fx, fz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0], [0, 0]]) {
      const w = this.toWorld(bl.x + (fx * bl.width) / 2, bl.z + (fz * bl.depth) / 2);
      const h = this.terrain.blockHeight(block, w.x, w.z);
      low = Math.min(low, h);
      high = Math.max(high, h);
    }
    return { low, high };
  }

  /**
   * A town block's raised slab, draped over the smooth hills so it sits exactly CURB_HEIGHT
   * above the roads all round: a top grid every 8 m, curb faces down each side, the lawn
   * over the lot, and a triangle-mesh collider matching the top (the road warp bends the block).
   */
  private buildBlockSurface(
    block: Block,
    pavement: GeometryBuilder,
    lawn: GeometryBuilder,
    collider: (desc: RAPIER.ColliderDesc) => void,
  ): void {
    const n = BLOCK_GRID;
    const half = BLOCK_SIZE / 2;
    const step = BLOCK_SIZE / n;
    const top = (x: number, z: number) => this.terrain.blockHeight(block, x, z) + CURB_HEIGHT;
    const white = [1, 1, 1] as const;
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const x0 = block.cx - half + ix * step;
        const z0 = block.cz - half + iz * step;
        pavement.quad(x0, z0, x0 + step, z0, x0 + step, z0 + step, x0, z0 + step, top, 0, white);
      }
    }
    // Curb faces: from the sidewalk top down below the road on all four sides.
    for (let i = 0; i < n; i++) {
      const a = -half + i * step;
      const b = a + step;
      pavement.wall(block.cx + a, block.cz - half, block.cx + b, block.cz - half, top, CURB_HEIGHT + 0.5, 0, -1, white);
      pavement.wall(block.cx + a, block.cz + half, block.cx + b, block.cz + half, top, CURB_HEIGHT + 0.5, 0, 1, white);
      pavement.wall(block.cx - half, block.cz + a, block.cx - half, block.cz + b, top, CURB_HEIGHT + 0.5, -1, 0, white);
      pavement.wall(block.cx + half, block.cz + a, block.cx + half, block.cz + b, top, CURB_HEIGHT + 0.5, 1, 0, white);
    }
    if (block.lawn) {
      const ln = 7;
      const ls = LOT / ln;
      for (let iz = 0; iz < ln; iz++) {
        for (let ix = 0; ix < ln; ix++) {
          const x0 = block.cx - LOT / 2 + ix * ls;
          const z0 = block.cz - LOT / 2 + iz * ls;
          lawn.quad(x0, z0, x0 + ls, z0, x0 + ls, z0 + ls, x0, z0 + ls, top, 0.02, white);
        }
      }
    }
    // Collider: a triangle mesh over the same (warped, draped) top grid.
    const vertices = new Float32Array((n + 1) * (n + 1) * 3);
    for (let iz = 0; iz <= n; iz++) {
      for (let ix = 0; ix <= n; ix++) {
        const w = this.toWorld(block.cx - half + ix * step, block.cz - half + iz * step);
        vertices.set([w.x, top(w.x, w.z), w.z], (iz * (n + 1) + ix) * 3);
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

    for (let bz = c.cz * CHUNK_CELLS; bz < (c.cz + 1) * CHUNK_CELLS; bz++) {
      for (let bx = c.cx * CHUNK_CELLS; bx < (c.cx + 1) * CHUNK_CELLS; bx++) {
        const block = this.layout.blockAt(bx, bz);
        if (!block) continue;
        // Layout positions are on the grid; toWorld() bends them with the roads.
        const top = (x: number, z: number) => this.terrain.blockHeight(block, x, z) + CURB_HEIGHT;
        for (const prop of block.roofProps) {
          // Roof height is set by the building's highest corner (see buildFar).
          const pool = prop.kind === 'ac' ? p.acs : p.tanks;
          const w = this.toWorld(prop.x, prop.z);
          const yaw = this.layout.warp.angle(prop.x, prop.z);
          pool.place(take(pool), w.x, this.footing(block, prop.building).high + CURB_HEIGHT + prop.y, w.z, ...prop.size, yaw);
        }
        for (const tr of block.trees) {
          const yaw = tr.hue * Math.PI * 2;
          const { x, z } = this.toWorld(tr.x, tr.z);
          const y = top(x, z) - 0.05;
          p.trunks.place(take(p.trunks), x, y, z, tr.scale, tr.scale, tr.scale, yaw);
          const slot = take(p.canopies);
          p.canopies.place(slot, x, y, z, tr.scale, tr.scale, tr.scale, yaw);
          p.canopies.setColor(slot, _color.setHSL(0.22 + tr.hue * 0.09, 0.45, 0.16 + tr.hue * 0.08));
          collider(RAPIER.ColliderDesc.cylinder(1.4 * tr.scale, 0.2 * tr.scale).setTranslation(x, y + 1.4 * tr.scale, z));
        }
        for (const l of block.lamps) {
          const { x, z } = this.toWorld(l.x, l.z);
          const yaw = l.yaw + this.layout.warp.angle(l.x, l.z);
          const y = top(x, z) - 0.05;
          p.lamps.place(take(p.lamps), x, y, z, 1, 1, 1, yaw);
          p.lampHeads.place(take(p.lampHeads), x, y, z, 1, 1, 1, yaw);
          // Ground point under the luminaire (over the road): the arm's +X direction after
          // yawing by `yaw`.
          const gx = x + Math.cos(yaw) * LAMP_HEAD_OUT;
          const gz = z - Math.sin(yaw) * LAMP_HEAD_OUT;
          p.lightPools.place(take(p.lightPools), gx, this.terrain.surfaceAt(gx, gz) + 0.06, gz);
          collider(RAPIER.ColliderDesc.cylinder(3.5, 0.12).setTranslation(x, y + 3.5, z));
        }
      }
    }

    // Countryside trees (low-poly pines and broadleaves, one pool).
    for (const tr of c.rural?.trees ?? []) {
      const slot = take(p.forest);
      p.forest.place(slot, tr.x, tr.y - 0.2, tr.z, tr.scale, tr.scale * (0.9 + tr.hue * 0.3), tr.scale, tr.hue * Math.PI * 2);
      p.forest.setColor(slot, _color.setHSL(0.25 + tr.hue * 0.08, 0.55, 0.06 + tr.hue * 0.05));
      collider(RAPIER.ColliderDesc.cylinder(2 * tr.scale, 0.25 * tr.scale).setTranslation(tr.x, tr.y + 2 * tr.scale, tr.z));
    }
    c.near = t;
  }
}

/** Builds flat quads draped over the ground (`height(x, z)` + a small lift), with colours. */
class GeometryBuilder {
  /** `map`: where a layout (grid) point ends up in the world. */
  constructor(private readonly map: (x: number, z: number) => { x: number; z: number }) {}
  private readonly positions: number[] = [];
  private readonly colors: number[] = [];
  private readonly indices: number[] = [];

  get empty(): boolean {
    return this.positions.length === 0;
  }

  quad(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    x3: number,
    z3: number,
    height: (x: number, z: number) => number,
    lift: number,
    color: readonly [number, number, number],
  ): void {
    const base = this.positions.length / 3;
    for (const [x, z] of [
      [x0, z0],
      [x1, z1],
      [x2, z2],
      [x3, z3],
    ]) {
      const w = this.map(x, z);
      this.positions.push(w.x, height(w.x, w.z) + lift, w.z);
      this.colors.push(color[0], color[1], color[2]);
    }
    // Make the face point up whatever order the corners came in: the y component of
    // (p1 − p0) × (p2 − p0) is positive for an upward face.
    const up = (z1 - z0) * (x2 - x0) - (x1 - x0) * (z2 - z0) > 0;
    if (up) this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else this.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }

  /**
   * A vertical face from (x0, z0) to (x1, z1): top edge at `top(x, z)`, `drop` metres deep,
   * facing outward along (nx, nz).
   */
  wall(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    top: (x: number, z: number) => number,
    drop: number,
    nx: number,
    nz: number,
    color: readonly [number, number, number],
  ): void {
    const base = this.positions.length / 3;
    const a = { ...this.map(x0, z0) };
    const b = this.map(x1, z1);
    const t0 = top(a.x, a.z);
    const t1 = top(b.x, b.z);
    this.positions.push(a.x, t0, a.z, b.x, t1, b.z, b.x, t1 - drop, b.z, a.x, t0 - drop, a.z);
    for (let k = 0; k < 4; k++) this.colors.push(color[0], color[1], color[2]);
    // Winding so the face points along (nx, nz): its normal is (p1 − p0) × (p3 − p0).
    // With p1 − p0 = (dx, ·, dz) along the top and p3 − p0 = (0, −drop, 0) downward,
    // that normal is (−dz·drop, 0, dx·drop)… flip the order if it points inward.
    const dx = x1 - x0;
    const dz = z1 - z0;
    const outward = -dz * nx + dx * nz > 0;
    if (outward) this.indices.push(base, base + 3, base + 2, base, base + 2, base + 1);
    else this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
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

