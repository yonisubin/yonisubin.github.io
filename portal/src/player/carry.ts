// Carrying props (spec "Carrying"): the held prop is driven toward a hold point ~1 m in front of
// the camera by a velocity servo (not parented), so it still collides with the world; its yaw is
// locked to the view; it drops if it's forced too far from the hold point; the player can't stand
// on it (the KCC ignores it) and it doesn't push the player.
//
// Through portals: `holdM` maps the player's side of a portal pair to the prop's side. When the
// prop passes through a portal with transform M, holdM ← M · holdM; when the player passes with M,
// holdM ← holdM · M⁻¹. Both passed (or neither): holdM is the identity again. The hold point is
// holdM · (eye + forward · d), so it follows the camera's transformed position.
import * as THREE from 'three';
import { CONFIG, STEP_DT } from '../core/config';
import type { PhysProp } from '../elements/prop';
import type { Player } from './controller';

const C = CONFIG.carry;
const UP = new THREE.Vector3(0, 1, 0);

export class Carry {
  held: PhysProp | null = null;
  readonly holdM = new THREE.Matrix4();
  /** Prop yaw relative to the view yaw at pickup (kept while carried). */
  private yawOffset = 0;
  /** Distance from the hold point in the last step (tests, drop rule). */
  gap = 0;

  constructor(
    private readonly player: Player,
    private readonly onDrop: (prop: PhysProp, forced: boolean) => void,
  ) {}

  pickup(prop: PhysProp): void {
    if (!prop.body || !prop.alive) return;
    this.held = prop;
    prop.held = true;
    this.holdM.identity();
    this.yawOffset = yawOf(prop.quaternion()) - this.player.rig.yaw;
    prop.body.setGravityScale(0, true);
    this.player.heldHandle = prop.collider!.handle;
    prop.onTeleport = (t) => {
      this.holdM.premultiply(t.matrix);
      this.normalise();
    };
  }

  yawOffsetValue(): number {
    return this.yawOffset;
  }

  setYawOffset(v: number): void {
    this.yawOffset = v;
  }

  /** Let go. The prop keeps (a capped version of) its velocity. */
  drop(forced = false): PhysProp | null {
    const p = this.held;
    if (!p) return null;
    this.held = null;
    p.held = false;
    p.onTeleport = null;
    this.player.heldHandle = -1;
    if (p.body) {
      p.body.setGravityScale(1, true);
      const v = p.velocity();
      if (v.length() > C.releaseMaxSpeed) p.body.setLinvel(v.setLength(C.releaseMaxSpeed), true);
    }
    this.onDrop(p, forced);
    return p;
  }

  /** The player went through a portal with transform m. */
  onPlayerTeleport(m: THREE.Matrix4): void {
    if (!this.held) return;
    this.holdM.multiply(m.clone().invert());
    this.normalise();
  }

  private normalise(): void {
    const e = this.holdM.elements;
    const id = new THREE.Matrix4().elements;
    if (e.every((v, i) => Math.abs(v - id[i]) < 1e-4)) this.holdM.identity();
  }

  /** The hold point in the prop's world. */
  target(out = new THREE.Vector3()): THREE.Vector3 {
    const fwd = this.player.rig.forward();
    return out
      .copy(this.player.eye())
      .addScaledVector(fwd, C.holdDistance)
      .addScaledVector(UP, -C.holdDrop)
      .applyMatrix4(this.holdM);
  }

  /** Before the physics step: steer the prop to the hold point; drop it if it's stuck too far. */
  update(): void {
    const p = this.held;
    if (!p) return;
    if (!p.body || !p.alive) {
      this.drop(true);
      return;
    }
    const target = this.target();
    const pos = p.position();
    const gap = target.clone().sub(pos);
    this.gap = gap.length();
    if (this.gap > C.dropDistance) {
      this.drop(true);
      return;
    }
    // Linear: move at gain·gap (critically fast but capped) — reaches the point in a few steps.
    const v = gap.multiplyScalar(C.gain);
    if (v.length() > C.maxSpeed) v.setLength(C.maxSpeed);
    p.body.setLinvel(v, true);
    // Angular: upright, yaw = view yaw (+ offset), seen through holdM's rotation.
    const holdRot = new THREE.Quaternion().setFromRotationMatrix(this.holdM);
    const want = holdRot.multiply(new THREE.Quaternion().setFromAxisAngle(UP, this.player.rig.yaw + this.yawOffset));
    const dq = want.multiply(p.quaternion().invert());
    if (dq.w < 0) dq.set(-dq.x, -dq.y, -dq.z, -dq.w);
    const angle = 2 * Math.acos(Math.min(1, dq.w));
    const s = Math.sqrt(Math.max(0, 1 - dq.w * dq.w));
    const w = s < 1e-6 ? new THREE.Vector3() : new THREE.Vector3(dq.x / s, dq.y / s, dq.z / s).multiplyScalar(Math.min(angle * C.turnGain, C.maxTurn));
    // Never overshoot within one step.
    if (w.length() * STEP_DT > angle) w.setLength(angle / STEP_DT);
    p.body.setAngvel(w, true);
  }
}

function yawOf(q: THREE.Quaternion): number {
  const f = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  return Math.atan2(f.x, f.z);
}
