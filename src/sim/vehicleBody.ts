import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { BodyInterpolator } from './entity';

// Small helpers every drivable vehicle (car, helicopter, boat) needs, kept in one place so a
// fix to one is a fix to all.

const UP = new THREE.Vector3(0, 1, 0);
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();

/** Heading (rad) of a body whose model faces +X: 0 = +X, growing counter-clockwise from above. */
export function headingOf(body: RAPIER.RigidBody): number {
  const r = body.rotation();
  const fwd = tmpV.set(1, 0, 0).applyQuaternion(tmpQ.set(r.x, r.y, r.z, r.w));
  return Math.atan2(-fwd.z, fwd.x);
}

/**
 * Teleport a body: put it at (x, y, z), level and facing `yaw`, standing still, and snap its
 * interpolation so the model doesn't visibly slide there.
 */
export function placeBody(body: RAPIER.RigidBody, interp: BodyInterpolator, x: number, y: number, z: number, yaw: number): void {
  body.setTranslation({ x, y, z }, true);
  body.setRotation(tmpQ.setFromAxisAngle(UP, yaw), true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  body.resetForces(true);
  interp.snap();
}

/**
 * On its roof or side and (nearly) still for `delay` seconds: lift it `lift` m and set it
 * back upright, keeping its heading. Call every physics step.
 */
export class FlipRecovery {
  private timer = 0;

  constructor(
    private readonly delay: number,
    private readonly lift: number,
  ) {}

  update(body: RAPIER.RigidBody, interp: BodyInterpolator, dt: number, speed: number): void {
    const r = body.rotation();
    const upY = tmpV.set(0, 1, 0).applyQuaternion(tmpQ.set(r.x, r.y, r.z, r.w)).y;
    this.timer = upY < 0.3 && speed < 2 ? this.timer + dt : 0;
    if (this.timer < this.delay) return;
    this.timer = 0;
    const t = body.translation();
    placeBody(body, interp, t.x, t.y + this.lift, t.z, headingOf(body));
  }
}

/**
 * The biggest sudden change of velocity (m/s) since it was last read: how hard the vehicle
 * hit something. `before()` at the start of a physics step, `after()` once the world has
 * stepped, `take()` to read and reset.
 */
export class ImpactMeter {
  private impact = 0;
  private readonly before_ = new THREE.Vector3();

  before(body: RAPIER.RigidBody): void {
    const v = body.linvel();
    this.before_.set(v.x, v.y, v.z);
  }

  after(body: RAPIER.RigidBody): void {
    const v = body.linvel();
    this.impact = Math.max(this.impact, Math.hypot(v.x - this.before_.x, v.y - this.before_.y, v.z - this.before_.z));
    this.before_.set(v.x, v.y, v.z);
  }

  take(): number {
    const i = this.impact;
    this.impact = 0;
    return i;
  }
}
