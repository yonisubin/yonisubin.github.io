// Rapier world + static level colliders. Each collider is registered with what it is (a level
// brush face set, a portal tunnel wall, the player) so queries can filter and tag hits.
import RAPIER from '@dimforge/rapier3d-compat';
import type { Brush, FaceKey, LevelData, SurfaceTag } from '../levels/level';
import { faceKeyFromNormal, faceTag } from '../levels/level';

export type ColliderInfo =
  | { kind: 'brush'; brush: Brush; index: number }
  | { kind: 'tunnel'; portal: 'a' | 'b' }
  | { kind: 'player' };

export class Physics {
  readonly world: RAPIER.World;
  private info = new Map<number, ColliderInfo>();
  /** Brush colliders by brush index (portals mask the brush they sit on). */
  readonly brushColliders: RAPIER.Collider[] = [];
  level: LevelData | null = null;

  constructor() {
    // The player is kinematic and integrates its own gravity; world gravity is for future props.
    this.world = new RAPIER.World({ x: 0, y: -11.5, z: 0 });
  }

  loadLevel(level: LevelData): void {
    this.level = level;
    level.brushes.forEach((b, index) => {
      const hx = (b.max[0] - b.min[0]) / 2;
      const hy = (b.max[1] - b.min[1]) / 2;
      const hz = (b.max[2] - b.min[2]) / 2;
      const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(b.min[0] + hx, b.min[1] + hy, b.min[2] + hz);
      const c = this.world.createCollider(desc);
      this.register(c, { kind: 'brush', brush: b, index });
      this.brushColliders[index] = c;
    });
    // Make the new colliders visible to scene queries right away.
    this.world.step();
  }

  register(c: RAPIER.Collider, info: ColliderInfo): void {
    this.info.set(c.handle, info);
  }

  unregister(c: RAPIER.Collider): void {
    this.info.delete(c.handle);
  }

  infoOf(c: RAPIER.Collider): ColliderInfo | undefined {
    return this.info.get(c.handle);
  }

  /** Surface tag where a ray hit a brush, by the face normal. */
  surfaceAt(c: RAPIER.Collider, normal: { x: number; y: number; z: number }): { tag: SurfaceTag; face: FaceKey; brush: Brush; index: number } | null {
    const i = this.infoOf(c);
    if (!i || i.kind !== 'brush') return null;
    const face = faceKeyFromNormal(normal);
    if (!face) return null;
    return { tag: faceTag(i.brush, face), face, brush: i.brush, index: i.index };
  }
}
