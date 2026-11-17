// Rapier world + static level colliders. Each collider is registered with what it is (a level
// brush, a portal tunnel wall, the player, a physics prop, an element's solid part...) so queries
// can filter and tag hits, and so the contact hook can mask walls for props passing through portals.
//
// Wall masking for rigid bodies: every prop collider has the FILTER_CONTACT_PAIRS hook. Before each
// step the prop records which portal surfaces it overlaps (`maskedSurfaces`, collider handles) and
// which portals (`maskedPortals`); the hook then drops contacts with those surfaces and keeps the
// portal's tunnel instead — the same rule the player's character controller uses through its filter.
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG, type PortalId } from '../core/config';
import type { Brush, FaceKey, LevelData, SurfaceTag } from '../levels/level';
import { faceKeyFromNormal, faceTag } from '../levels/level';

/** What a physics prop exposes to the contact hook. */
export interface MaskState {
  readonly id: string;
  /** Collider handles of walls this prop currently passes through (portal surfaces). */
  maskedSurfaces: Set<number>;
  maskedPortals: Set<PortalId>;
  /** Held by the player: no contact with the player's capsule. */
  held: boolean;
}

/** A moving solid (platform, lift, door...): how far it moved during the last step (riders follow). */
export interface Mover {
  delta: { x: number; y: number; z: number };
}

export type ColliderInfo =
  | { kind: 'brush'; brush: Brush; index: number }
  | { kind: 'tunnel'; portal: PortalId }
  | { kind: 'player' }
  | { kind: 'prop'; prop: MaskState }
  /** The kinematic stand-in for the part of a prop sticking out of the other portal. */
  | { kind: 'clone'; prop: MaskState }
  /** An element's solid part. `box` (current world box) makes its faces portalable when `tag` is. */
  | { kind: 'solid'; owner: string; tag: SurfaceTag; box?: () => Brush; mover?: Mover }
  | { kind: 'sensor'; owner: string };

export class Physics {
  world: RAPIER.World;
  private info = new Map<number, ColliderInfo>();
  /** Brush colliders by brush index (portals mask the brush they sit on). */
  brushColliders: RAPIER.Collider[] = [];
  level: LevelData | null = null;

  private readonly hooks: RAPIER.PhysicsHooks = {
    filterContactPair: (h1, h2) => (this.contactAllowed(h1, h2) ? RAPIER.SolverFlags.COMPUTE_IMPULSE : null),
    filterIntersectionPair: () => true,
  };

  constructor() {
    this.world = this.newWorld();
  }

  private newWorld(): RAPIER.World {
    const w = new RAPIER.World({ x: 0, y: -CONFIG.player.gravity, z: 0 });
    w.timestep = 1 / CONFIG.physics.hz;
    return w;
  }

  /** Throw the whole world away (every collider and body of the previous chamber) and start empty. */
  reset(): void {
    this.world.free();
    this.world = this.newWorld();
    this.info.clear();
    this.brushColliders = [];
    this.level = null;
  }

  loadLevel(level: LevelData): void {
    this.level = level;
    level.brushes.forEach((b, index) => {
      const hx = (b.max[0] - b.min[0]) / 2;
      const hy = (b.max[1] - b.min[1]) / 2;
      const hz = (b.max[2] - b.min[2]) / 2;
      const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(b.min[0] + hx, b.min[1] + hy, b.min[2] + hz)
        .setFriction(CONFIG.props.friction);
      const c = this.world.createCollider(desc);
      this.register(c, { kind: 'brush', brush: b, index });
      this.brushColliders[index] = c;
    });
    // Make the new colliders visible to scene queries right away.
    this.world.step();
  }

  /** One fixed step of the rigid-body simulation (props, kinematic solids), with the portal hook. */
  step(): void {
    this.world.step(undefined, this.hooks);
  }

  register(c: RAPIER.Collider, info: ColliderInfo): void {
    this.info.set(c.handle, info);
  }

  unregister(c: RAPIER.Collider): void {
    this.info.delete(c.handle);
  }

  /** Remove a collider (and forget it). */
  removeCollider(c: RAPIER.Collider): void {
    this.unregister(c);
    this.world.removeCollider(c, false);
  }

  /** Remove a rigid body with all its colliders. */
  removeBody(b: RAPIER.RigidBody): void {
    for (let i = 0; i < b.numColliders(); i++) this.unregister(b.collider(i));
    this.world.removeRigidBody(b);
  }

  infoOf(c: RAPIER.Collider): ColliderInfo | undefined {
    return this.info.get(c.handle);
  }

  infoOfHandle(h: number): ColliderInfo | undefined {
    return this.info.get(h);
  }

  /** Surface tag where a ray hit a brush (or a portalable element solid), by the face normal. */
  surfaceAt(c: RAPIER.Collider, normal: { x: number; y: number; z: number }): { tag: SurfaceTag; face: FaceKey; brush: Brush; index: number } | null {
    const i = this.infoOf(c);
    const face = faceKeyFromNormal(normal);
    if (!i || !face) return null;
    if (i.kind === 'brush') return { tag: faceTag(i.brush, face), face, brush: i.brush, index: i.index };
    if (i.kind === 'solid') return { tag: i.box ? i.tag : i.tag === 'glass' ? 'glass' : 'metal', face, brush: i.box ? i.box() : { min: [0, 0, 0], max: [0, 0, 0], tag: 'metal' }, index: -1 };
    return null;
  }

  /** The contact rule (see the header): masked walls and other portals' tunnels don't touch a prop. */
  private contactAllowed(h1: number, h2: number): boolean {
    const a = this.info.get(h1);
    const b = this.info.get(h2);
    if (!a || !b) return true;
    return this.pairAllowed(a, h2, b) && this.pairAllowed(b, h1, a);
  }

  private pairAllowed(a: ColliderInfo, otherHandle: number, b: ColliderInfo): boolean {
    if (a.kind !== 'prop' && a.kind !== 'clone') return true;
    const p = a.prop;
    if (b.kind === 'prop' || b.kind === 'clone') return b.prop !== p;
    if (a.kind === 'clone') return b.kind !== 'brush' && b.kind !== 'tunnel';
    if (b.kind === 'brush' || b.kind === 'solid') return !p.maskedSurfaces.has(otherHandle);
    if (b.kind === 'tunnel') return p.maskedPortals.has(b.portal);
    if (b.kind === 'player') return !p.held;
    return true;
  }
}
