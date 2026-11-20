import RAPIER from '@dimforge/rapier3d-compat';
import type { RaySensors } from './observe';

/**
 * What an AI driver's sensor rays see in the game world: buildings, poles, trees, people and
 * cars — not the ground (terrain heightfields, road and pavement meshes). In training the
 * world held only roads, buildings and cars; poles and people read as "not a car" obstacles.
 *
 * Reading a collider's shape crosses into WebAssembly and builds a new object, and the ray
 * filter runs for every collider a ray passes, so the answers are cached per collider handle
 * (a handle includes a generation, so a recycled slot gets a new handle).
 */
export function gameSensors(world: RAPIER.World): RaySensors {
  const seen = new Map<number, boolean>();
  const car = new Map<number, boolean>();
  const trim = () => {
    if (seen.size > 40000) seen.clear();
    if (car.size > 40000) car.clear();
  };
  return {
    world,
    rayFilter: (c) => {
      let v = seen.get(c.handle);
      if (v === undefined) {
        trim();
        const t = c.shape.type;
        v = t !== RAPIER.ShapeType.HeightField && t !== RAPIER.ShapeType.TriMesh && !c.isSensor();
        seen.set(c.handle, v);
      }
      return v;
    },
    // A car: a box over 3 m long on a body that can move (every car body in the game).
    isCar: (c) => {
      let v = car.get(c.handle);
      if (v === undefined) {
        trim();
        const b = c.parent();
        v = !!b && !b.isFixed() && c.shape.type === RAPIER.ShapeType.Cuboid && (c.shape as RAPIER.Cuboid).halfExtents.x > 1.5;
        car.set(c.handle, v);
      }
      return v;
    },
    velocity: (c) => {
      const v = c.parent()?.linvel();
      return v ? { x: v.x, z: v.z } : { x: 0, z: 0 };
    },
  };
}
