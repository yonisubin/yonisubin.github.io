// First-person view: yaw + pitch from the mouse, plus a leftover tilt after leaving a portal.
//
// Going through a portal rotates the whole view (R · Q). The new forward direction becomes the new
// yaw/pitch; whatever's left over (mostly roll, e.g. leaving a ceiling or wall portal sideways) is
// kept as a residual rotation Δ = Q_upright⁻¹ · Q_new and eased back to identity over ~0.5 s, so the
// camera rolls smoothly upright instead of snapping.
import * as THREE from 'three';
import { CONFIG } from '../core/config';

const IDENTITY = new THREE.Quaternion();
const EULER = new THREE.Euler(0, 0, 0, 'YXZ');

export class CameraRig {
  yaw = 0;
  pitch = 0;
  private residualStart = new THREE.Quaternion();
  private residualT = 1;
  readonly residual = new THREE.Quaternion();

  look(dx: number, dy: number): void {
    const s = CONFIG.camera.mouseSensitivity;
    this.yaw -= dx * s;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * s, -CONFIG.camera.maxPitch, CONFIG.camera.maxPitch);
  }

  /** Upright orientation from yaw/pitch only (what movement uses). */
  upright(out = new THREE.Quaternion()): THREE.Quaternion {
    EULER.set(this.pitch, this.yaw, 0, 'YXZ');
    return out.setFromEuler(EULER);
  }

  /** Full view orientation including the residual tilt. */
  orientation(out = new THREE.Quaternion()): THREE.Quaternion {
    return this.upright(out).multiply(this.residual);
  }

  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(0, 0, -1).applyQuaternion(this.orientation());
  }

  /** Rotate the view by a portal's rotation. */
  applyTeleport(rot: THREE.Quaternion): void {
    const q = rot.clone().multiply(this.orientation());
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const max = CONFIG.camera.maxPitch;
    if (Math.abs(f.y) < 0.999) {
      this.yaw = Math.atan2(-f.x, -f.z);
      this.pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(f.y, -1, 1)), -max, max);
    } else {
      // Looking straight down (up): the camera's up (down) vector points the way you face.
      const h = f.y < 0 ? u : u.clone().negate();
      this.yaw = Math.atan2(-h.x, -h.z);
      this.pitch = f.y < 0 ? -max : max;
    }
    this.residualStart.copy(this.upright().invert().multiply(q));
    this.residual.copy(this.residualStart);
    this.residualT = 0;
  }

  update(dt: number): void {
    if (this.residualT >= 1) return;
    this.residualT = Math.min(1, this.residualT + dt / CONFIG.camera.rollRecoverySeconds);
    const t = this.residualT;
    const ease = t * t * (3 - 2 * t); // smoothstep: starts and ends gently
    this.residual.slerpQuaternions(this.residualStart, IDENTITY, ease);
  }

  /** Remaining tilt angle (radians), for tests and the debug overlay. */
  residualAngle(): number {
    return 2 * Math.acos(Math.min(1, Math.abs(this.residual.w)));
  }

  reset(yaw: number): void {
    this.yaw = yaw;
    this.pitch = 0;
    this.residual.identity();
    this.residualT = 1;
  }
}
