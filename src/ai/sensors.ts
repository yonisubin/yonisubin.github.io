import RAPIER from '@dimforge/rapier3d-compat';
import type { RaySensors } from './observe';

/**
 * What an AI driver's sensor rays see in the game world: buildings, poles, trees, people and
 * cars — not the ground (terrain heightfields, road and pavement meshes). In training the
 * world held only roads, buildings and cars; poles and people read as "not a car" obstacles.
 */
export function gameSensors(world: RAPIER.World): RaySensors {
  return {
    world,
    rayFilter: (c) => {
      const t = c.shape.type;
      return t !== RAPIER.ShapeType.HeightField && t !== RAPIER.ShapeType.TriMesh && !c.isSensor();
    },
    // A car: a box over 3 m long on a body that can move (every car body in the game).
    isCar: (c) => {
      const b = c.parent();
      if (!b || b.isFixed() || c.shape.type !== RAPIER.ShapeType.Cuboid) return false;
      return (c.shape as RAPIER.Cuboid).halfExtents.x > 1.5;
    },
    velocity: (c) => {
      const v = c.parent()?.linvel();
      return v ? { x: v.x, z: v.z } : { x: 0, z: 0 };
    },
  };
}
