import RAPIER from '@dimforge/rapier3d-compat';
import { buildStreets, generateCity, WORLD_HALF, type Building, type CityLayout } from '../../src/world/layout';
import { Terrain } from '../../src/world/terrain';
import { RoadGraph } from '../../src/world/roadGraph';
import type { StreetNet } from '../../src/world/streets';
import type { RaySensors } from '../../src/ai/observe';

// The game's world, without three.js: the same seeded city, street network and lanes, and a
// Rapier world holding just what a car can touch on the road: the ground (a heightfield of the
// road-level terrain) and every building as a box. Trees, lamps and kerbs are left out: a
// driver that leaves the road ends its episode anyway.

export const CITY_SEED = 1337; // same as src/main.ts
export const PHYSICS_DT = 1 / 60;

/** Collision groups: the ground is in group 1 only, so sensor rays (which look for group 2) skip it. */
export const GROUND_GROUPS = (0x0001 << 16) | 0xffff;
/** Ray query groups: member of everything, sees only colliders in group 2 (cars, buildings). */
export const RAY_GROUPS = (0xffff << 16) | 0x0002;

const TILE = 256; // m per heightfield tile
const STEP = 2; // m between height samples

export class SimWorld implements RaySensors {
  readonly rayGroups = RAY_GROUPS;

  readonly layout: CityLayout;
  readonly terrain: Terrain;
  readonly net: StreetNet;
  readonly graph: RoadGraph;
  readonly world: RAPIER.World;
  /** Collider handles of the ground (not an obstacle). */
  readonly ground = new Set<number>();
  /** What each obstacle collider is: 0 = building/wall, 1 = car. */
  readonly kind = new Map<number, number>();
  /**
   * Velocities of kinematic cars (rule-based traffic), by collider handle; other cars report
   * their rigid body's velocity.
   */
  readonly kinematicVel = new Map<number, { x: number; z: number }>();
  /** Junction centres with traffic lights. */
  readonly litNodes: number[];

  /** Pass `from` to reuse a city the game's renderer already generated (the viewer does). */
  constructor(seed = CITY_SEED, from?: { layout: CityLayout; terrain: Terrain }) {
    if (from) {
      this.layout = from.layout;
      this.terrain = from.terrain;
    } else {
      this.layout = generateCity(seed);
      this.terrain = new Terrain(this.layout);
      buildStreets(this.layout, (x, z) => this.terrain.smoothHeight(x, z));
    }
    this.net = this.layout.streets.net;
    this.graph = new RoadGraph(this.net);
    this.litNodes = this.net.nodes.filter((n) => n.control === 'lights').map((n) => n.id);

    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = PHYSICS_DT;
    this.buildGround();
    this.buildBuildings();
  }

  isCar(c: RAPIER.Collider): boolean {
    return this.kind.get(c.handle) === 1;
  }

  /** Ground-plane velocity of the body a collider belongs to. */
  velocity(c: RAPIER.Collider): { x: number; z: number } {
    const k = this.kinematicVel.get(c.handle);
    if (k) return k;
    const b = c.parent();
    if (!b) return { x: 0, z: 0 };
    const v = b.linvel();
    return { x: v.x, z: v.z };
  }

  /** Road-level height (roads sit on the smooth hills; see terrain.ts). */
  height(x: number, z: number): number {
    return this.terrain.smoothHeight(x, z);
  }

  private buildGround(): void {
    const n = TILE / STEP;
    const half = Math.ceil(WORLD_HALF / TILE) * TILE;
    const hf = new Float32Array((n + 1) * (n + 1));
    for (let x0 = -half; x0 < half; x0 += TILE) {
      for (let z0 = -half; z0 < half; z0 += TILE) {
        // Only tiles with a road in them matter: skip the rest (open sea, deep forest).
        if (this.net.distance(x0 + TILE / 2, z0 + TILE / 2, TILE) >= TILE) continue;
        // Rapier heightfield: column-major, rows along Z, columns along X (see world/chunks.ts).
        for (let ix = 0; ix <= n; ix++) {
          for (let iz = 0; iz <= n; iz++) hf[ix * (n + 1) + iz] = this.height(x0 + ix * STEP, z0 + iz * STEP);
        }
        const c = this.world.createCollider(
          RAPIER.ColliderDesc.heightfield(n, n, hf, { x: TILE, y: 1, z: TILE })
            .setTranslation(x0 + TILE / 2, 0, z0 + TILE / 2)
            .setCollisionGroups(GROUND_GROUPS),
        );
        this.ground.add(c.handle);
      }
    }
  }

  private buildBuildings(): void {
    const all: Building[] = [];
    for (const b of this.layout.blocks) all.push(...b.buildings);
    all.push(...this.layout.streets.houses);
    for (const p of this.layout.streets.parcels) all.push(...p.buildings);
    for (const b of all) {
      const yaw = b.yaw ?? 0;
      const c = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(b.width / 2, b.height / 2, b.depth / 2)
          .setTranslation(b.x, b.y + b.height / 2, b.z)
          .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }),
      );
      this.kind.set(c.handle, 0);
    }
  }
}
