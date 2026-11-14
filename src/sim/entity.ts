import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';

// Things that live in the world and are simulated every physics step (vehicles, NPCs).
// The game loop calls, per physics step:  fixedUpdate → world.step() → afterStep,
// and once per rendered frame: render(alpha) to interpolate meshes between steps.
export interface SimEntity {
  /** Apply controls/forces for the coming step. Called before world.step(). */
  fixedUpdate(dt: number): void;
  /** Record the post-step physics state (for interpolation). */
  afterStep(): void;
  /** Update meshes, interpolating between the last two physics states by `alpha`. */
  render(alpha: number, frameDt: number): void;
}

/**
 * Remembers a rigid body's last two physics poses and blends between them at render time.
 * Meshes copy the result — physics stays the source of truth.
 */
export class BodyInterpolator {
  readonly prevPos = new THREE.Vector3();
  readonly currPos = new THREE.Vector3();
  readonly prevQuat = new THREE.Quaternion();
  readonly currQuat = new THREE.Quaternion();

  constructor(private readonly body: RAPIER.RigidBody) {
    this.capture();
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
  }

  /** Call after each world.step(). */
  capture(): void {
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
    const t = this.body.translation();
    const r = this.body.rotation();
    this.currPos.set(t.x, t.y, t.z);
    this.currQuat.set(r.x, r.y, r.z, r.w);
  }

  /** Forget the previous pose (after a teleport), so we don't interpolate across the jump. */
  snap(): void {
    this.capture();
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
  }

  apply(target: THREE.Object3D, alpha: number): void {
    target.position.lerpVectors(this.prevPos, this.currPos, alpha);
    target.quaternion.slerpQuaternions(this.prevQuat, this.currQuat, alpha);
  }
}
