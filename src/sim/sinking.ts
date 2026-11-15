import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';

// Vehicles that end up in deep water (cars driven off the beach, a helicopter landing on the
// lake) are destroyed and sink. This helper is shared by Car and Helicopter:
//
//   check()  — once per step: has the vehicle just gone under? (starts the sinking clock)
//   apply()  — while sinking: water forces instead of the engine/rotor. Heavy drag plus an
//              upward push of 70 % of the weight leaves 30 % of gravity pulling down against
//              strong drag, so it settles at ~1 m/s: a slow sink rather than a drop.
//   wreck()  — swap every material for a dark, waterlogged one; restore() undoes it.

const SINK_TIME = 25; // s from going under until the wreck is cleared away
const SINK_DAMPING = 2.5; // 1/s linear damping in water
const SINK_ANGULAR_DAMPING = 2;
const BUOYANCY = 0.7; // fraction of the weight the water holds up
const GRAVITY = 9.81;

const WRECK_MATERIAL = new THREE.MeshStandardMaterial({ color: 0x1d1c1a, roughness: 1 });

export class Sinking {
  /** Seconds since the vehicle went under, or −1 if it hasn't. */
  time = -1;
  /**
   * Water surface height at a point where the water is deep enough to sink a vehicle, or
   * null (set by the game).
   */
  water: ((x: number, z: number) => number | null) | null = null;
  private readonly saved = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();

  get active(): boolean {
    return this.time >= 0;
  }

  /** The wreck has been under long enough to be cleared away. */
  get done(): boolean {
    return this.time >= SINK_TIME;
  }

  /**
   * True on the step the vehicle goes under: its reference point (ground level of the body)
   * is more than `submerged` metres below the surface of deep water.
   */
  check(position: RAPIER.Vector, submerged: number): boolean {
    if (this.time >= 0 || !this.water) return false;
    const surface = this.water(position.x, position.z);
    if (surface === null || position.y > surface - submerged) return false;
    this.time = 0;
    return true;
  }

  /** Water forces for one step (call instead of the vehicle's own forces). */
  apply(body: RAPIER.RigidBody, dt: number): void {
    this.time += dt;
    body.setLinearDamping(SINK_DAMPING);
    body.setAngularDamping(SINK_ANGULAR_DAMPING);
    body.resetForces(true);
    const p = body.translation();
    const surface = this.water?.(p.x, p.z) ?? null;
    if (surface !== null && p.y < surface) body.addForce({ x: 0, y: BUOYANCY * body.mass() * GRAVITY, z: 0 }, true);
  }

  /** Dark, waterlogged look for everything in `object`. */
  wreck(object: THREE.Object3D): void {
    object.traverse((o) => {
      if (o instanceof THREE.Mesh && !this.saved.has(o)) {
        this.saved.set(o, o.material);
        o.material = WRECK_MATERIAL;
      }
    });
  }

  /** Back to normal (the vehicle has been put back at its parking spot). */
  restore(body: RAPIER.RigidBody, linearDamping: number, angularDamping: number): void {
    for (const [mesh, material] of this.saved) mesh.material = material;
    this.saved.clear();
    this.time = -1;
    body.setLinearDamping(linearDamping);
    body.setAngularDamping(angularDamping);
  }
}
