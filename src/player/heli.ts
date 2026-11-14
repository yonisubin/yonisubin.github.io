import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Input } from '../input/actions';
import type { PlayerMode, TouchButton } from './state';
import { BodyInterpolator, type SimEntity } from '../sim/entity';
import { findFreeSpot } from '../sim/exit';
import { ChaseCamera } from '../camera/chaseCamera';
import type { VehicleLight } from '../sim/vehicleLight';
import { buildHelicopter, type HeliModel } from '../vehicles/heliModel';

// Helicopter: one dynamic rigid body pushed around by three kinds of force, like the real thing.
//
//  • Collective (main rotor lift): a force along the helicopter's own up axis. Tilting the
//    helicopter tilts this force, and its horizontal part is what moves it forward/sideways.
//  • Cyclic (pitch / roll): torques that tilt the rotor disc — here, the whole body.
//  • Tail rotor (yaw): a torque about the vertical axis that turns the nose.
//
// On top of that sits an "arcade" flight assist, so it's easy to fly and hovers hands-off:
//  • the collective holds a target climb rate (0 with no input → altitude hold);
//  • the cyclic aims for a target tilt: from the stick when it's pushed, otherwise a tilt
//    that cancels horizontal drift (position hold), so it settles into a stable hover.
// The assist only *chooses* the forces; motion comes from physics.
//
// Body space: +X forward, +Y up, +Z right (same as the cars).

const MASS = 1500; // kg
const G = 9.81;
const SPINUP_TIME = 3; // s for the rotor to reach full speed after you get in
const SPINDOWN_TIME = 7; // s to wind down after you get out
const CLIMB_RATE = 7; // m/s with Space held
const DESCENT_RATE = 5; // m/s with Shift held
const CLIMB_GAIN = 2.2; // 1/s, how hard the collective chases the target climb rate
const MAX_LIFT = 2.4; // × weight, rotor's maximum thrust
const MAX_TILT = 0.38; // rad (~22°) of pitch from the stick
const MAX_BANK = 0.32; // rad (~18°) of auto-bank into turns
const HOLD_GAIN = 0.05; // rad of counter-tilt per m/s of drift when the stick is centred
const TILT_STIFFNESS = 14; // 1/s², attitude spring (PD controller)
const TILT_DAMPING = 6.5; // 1/s, ≈ 0.85 of critical damping (2·√14 ≈ 7.5)
const YAW_RATE = 1.1; // rad/s turn rate at full stick
const YAW_GAIN = 4; // 1/s
const TOP_SPEED = 42; // m/s (~150 km/h) at full tilt; sets the drag coefficient
// Principal moments of inertia (kg·m²) about the body's X (roll), Y (yaw), Z (pitch) axes.
// Rough figures for a 1.5 t light helicopter; the long tail boom makes yaw and pitch heavier.
const INERTIA = { x: 1400, y: 6500, z: 6000 };
const ROTOR_SPIN = 28; // rad/s of the main rotor at full speed (~270 rpm), visual only

export class Helicopter implements SimEntity {
  readonly body: RAPIER.RigidBody;
  readonly interp: BodyInterpolator;
  readonly model: HeliModel;
  mode: FlyingMode | null = null;

  // Pilot inputs, set each step by FlyingMode.
  piloted = false;
  stickForward = 0; // −1..1 (W/S)
  stickTurn = 0; // −1..1 (A/D), positive = right
  climb = 0; // −1 (Shift), 0, +1 (Space)

  /** Rotor speed, 0 (stopped) … 1 (flight rpm). Lift scales with rpm². */
  rotor = 0;
  /** Height of the skids above whatever is below, m. */
  altitude = 0;

  private rotorAngle = 0;
  private tailAngle = 0;

  constructor(
    private readonly world: RAPIER.World,
    scene: THREE.Scene,
    position: THREE.Vector3,
    yaw: number,
  ) {
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y + 0.05, position.z)
        .setRotation(rot)
        .setLinearDamping(0.05)
        .setAngularDamping(1.5)
        .setCcdEnabled(true),
    );
    // Cabin carries all the mass, centre of mass a little below the rotor mast.
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(1.9, 0.7, 0.9)
        .setTranslation(0.2, 1.45, 0)
        .setMassProperties(MASS, { x: 0, y: 1.3, z: 0 }, INERTIA, { x: 0, y: 0, z: 0, w: 1 }),
      this.body,
    );
    const massless = (desc: RAPIER.ColliderDesc) => world.createCollider(desc.setDensity(0), this.body);
    massless(RAPIER.ColliderDesc.cuboid(2.6, 0.22, 0.22).setTranslation(-3.6, 1.8, 0)); // tail boom
    massless(RAPIER.ColliderDesc.cuboid(0.4, 0.6, 0.1).setTranslation(-6.05, 2.2, 0)); // fin
    for (const z of [-0.95, 0.95]) {
      massless(RAPIER.ColliderDesc.cuboid(1.7, 0.06, 0.07).setTranslation(0.25, 0.06, z).setFriction(0.9)); // skids
    }

    this.model = buildHelicopter(0x1f3a5a);
    scene.add(this.model.root);
    this.interp = new BodyInterpolator(this.body);
  }

  get landed(): boolean {
    const v = this.body.linvel();
    return this.altitude < 0.35 && Math.hypot(v.x, v.y, v.z) < 1.5;
  }

  /** Horizontal speed, m/s. */
  get groundSpeed(): number {
    const v = this.body.linvel();
    return Math.hypot(v.x, v.z);
  }

  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(1, 0, 0).applyQuaternion(this.interp.currQuat);
  }

  fixedUpdate(dt: number): void {
    // Rotor spins up while someone is flying, winds down otherwise.
    this.rotor = THREE.MathUtils.clamp(this.rotor + (this.piloted ? dt / SPINUP_TIME : -dt / SPINDOWN_TIME), 0, 1);
    if (this.rotor === 0 && !this.piloted && this.body.isSleeping()) return;

    const r = this.body.rotation();
    const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const right = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const v = this.body.linvel();
    const w = this.body.angvel();
    const angVel = new THREE.Vector3(w.x, w.y, w.z);
    this.altitude = this.measureAltitude();
    const airborne = this.altitude > 0.6;
    const thrust = this.rotor * this.rotor; // rotor thrust ∝ rpm²

    this.body.resetForces(false);
    this.body.resetTorques(false);

    // --- Collective: lift along the body's up axis, sized to reach the target climb rate.
    // Dividing by up.y (= cos of the tilt) keeps the *vertical* part of the lift constant
    // when the helicopter tilts, so tilting to fly forward doesn't make it sink.
    const targetVy = this.piloted ? this.climb * (this.climb > 0 ? CLIMB_RATE : DESCENT_RATE) : -3;
    let lift = (MASS * (G + CLIMB_GAIN * (targetVy - v.y))) / Math.max(up.y, 0.6);
    lift = THREE.MathUtils.clamp(lift, 0, MAX_LIFT * MASS * G) * thrust;
    this.body.addForce({ x: up.x * lift, y: up.y * lift, z: up.z * lift }, false);

    // --- Cyclic: choose a target pitch and roll.
    // Horizontal forward/right directions, and how fast we're drifting along each.
    const fwdH = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
    const rightH = new THREE.Vector3(right.x, 0, right.z).normalize();
    const vFwd = v.x * fwdH.x + v.z * fwdH.z;
    const vSide = v.x * rightH.x + v.z * rightH.z;
    let targetPitch = 0; // rad, nose up positive
    let targetRoll = 0; // rad, right side down positive
    if (airborne && this.piloted) {
      // Stick forward → nose down; centred → tilt against the drift to stop (position hold).
      targetPitch = Math.abs(this.stickForward) > 0.05
        ? -this.stickForward * MAX_TILT
        : THREE.MathUtils.clamp(HOLD_GAIN * vFwd, -MAX_TILT, MAX_TILT);
      // Bank into turns, and always lean against sideways drift.
      targetRoll = THREE.MathUtils.clamp(
        this.stickTurn * MAX_BANK * Math.min(1, Math.abs(vFwd) / 10) - HOLD_GAIN * vSide,
        -MAX_BANK,
        MAX_BANK,
      );
    }
    // Current attitude. Pitch: how far the nose points above the horizon. Roll: a rotation
    // about +X by θ moves the right axis to y = −sin θ, so θ = asin(−right.y).
    const pitch = Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1));
    const roll = Math.asin(THREE.MathUtils.clamp(-right.y, -1, 1));
    // PD controller per axis: torque = I · (k·error − c·rate). Rotation about +Z (the right
    // axis) raises the nose; rotation about +X (forward) lowers the right side.
    const pitchRate = angVel.dot(right);
    const rollRate = angVel.dot(fwd);
    const tauPitch = INERTIA.z * (TILT_STIFFNESS * (targetPitch - pitch) - TILT_DAMPING * pitchRate) * thrust;
    const tauRoll = INERTIA.x * (TILT_STIFFNESS * (targetRoll - roll) - TILT_DAMPING * rollRate) * thrust;

    // --- Tail rotor: torque about the vertical axis toward the requested turn rate.
    // Turning right (clockwise seen from above) is a negative rotation about +Y.
    const targetYawRate = this.piloted && airborne ? -this.stickTurn * YAW_RATE : 0;
    const tauYaw = INERTIA.y * YAW_GAIN * (targetYawRate - w.y) * thrust;

    const torque = right.multiplyScalar(tauPitch).add(fwd.multiplyScalar(tauRoll));
    torque.y += tauYaw;
    this.body.addTorque(torque, false);

    // --- Drag, F = −k·|v|·v. k makes drag equal the horizontal lift at full tilt at TOP_SPEED.
    const speed = Math.hypot(v.x, v.y, v.z);
    const k = (MASS * G * Math.tan(MAX_TILT)) / (TOP_SPEED * TOP_SPEED);
    this.body.addForce({ x: -k * speed * v.x, y: -k * speed * v.y, z: -k * speed * v.z }, false);
    if (lift > 0) this.body.wakeUp();
  }

  /** Distance from the skids to the first thing below (ground, roof), excluding ourselves. */
  private measureAltitude(): number {
    const t = this.body.translation();
    const hit = this.world.castRay(
      new RAPIER.Ray({ x: t.x, y: t.y + 0.5, z: t.z }, { x: 0, y: -1, z: 0 }),
      500,
      true,
      undefined,
      undefined,
      undefined,
      this.body,
    );
    return hit ? hit.timeOfImpact - 0.5 : 500;
  }

  afterStep(): void {
    this.interp.capture();
  }

  render(alpha: number, frameDt: number): void {
    this.interp.apply(this.model.root, alpha);
    // Rotor animation (visual only): spin rate follows rotor speed; at speed the blades fade
    // into a translucent blur disc.
    this.rotorAngle = (this.rotorAngle + this.rotor * ROTOR_SPIN * frameDt) % (Math.PI * 2);
    this.tailAngle = (this.tailAngle + this.rotor * ROTOR_SPIN * 4 * frameDt) % (Math.PI * 2);
    this.model.mainRotor.rotation.y = -this.rotorAngle;
    this.model.tailRotor.rotation.z = this.tailAngle;
    const blur = THREE.MathUtils.smoothstep(this.rotor, 0.45, 0.9);
    for (const b of this.model.blades) (b.material as THREE.MeshStandardMaterial).opacity = 1 - 0.8 * blur;
    (this.model.blurDisc.material as THREE.MeshBasicMaterial).opacity = 0.32 * blur;
  }

  findExitPoint(shape: RAPIER.Shape, standHeight: number): THREE.Vector3 {
    return findFreeSpot(
      this.world,
      shape,
      standHeight,
      this.body,
      this.interp.currPos,
      this.interp.currQuat,
      [
        new THREE.Vector3(0.3, 0, -2.2), // pilot door (left)
        new THREE.Vector3(0.3, 0, 2.2),
        new THREE.Vector3(3.3, 0, 0),
      ],
      2.1,
    );
  }
}

/** Player-flying mode: reads input, flies the helicopter, runs the chase camera. */
export class FlyingMode implements PlayerMode {
  readonly name = 'Flying';
  readonly controlsHint = 'W/S tilt forward/back · A/D turn · Space climb · Shift descend · E get out (landed)';
  readonly touchButtons: TouchButton[];
  private readonly cameraRig: ChaseCamera;
  private readonly fwd = new THREE.Vector3();
  private readonly lightFrom = new THREE.Vector3();
  private readonly lightTo = new THREE.Vector3();

  constructor(
    private readonly heli: Helicopter,
    private readonly input: Input,
    camera: THREE.PerspectiveCamera,
    world: RAPIER.World,
    private readonly onExit: (heli: Helicopter) => void,
    /** Searchlight at night. */
    private readonly light: VehicleLight,
  ) {
    this.cameraRig = new ChaseCamera(camera, input, world, { distance: 15, pivotHeight: 2.6, pitch: 0.28 }, heli.body);
    this.touchButtons = [
      { label: 'DOWN', action: 'descend' },
      { label: 'UP', action: 'ascend' },
      { label: 'EXIT', action: 'interact', visible: () => this.heli.landed },
    ];
  }

  enter(): void {
    this.heli.piloted = true;
    this.heli.body.wakeUp();
    this.cameraRig.reset();
  }

  exit(): void {
    this.light.off();
    this.heli.piloted = false;
    this.heli.stickForward = 0;
    this.heli.stickTurn = 0;
    this.heli.climb = 0;
  }

  update(): void {
    const axis = this.input.moveAxis();
    this.heli.stickForward = axis.y;
    this.heli.stickTurn = axis.x;
    this.heli.climb = Number(this.input.isDown('ascend')) - Number(this.input.isDown('descend'));
    if (this.input.consumePressed('interact') && this.heli.landed) this.onExit(this.heli);
  }

  render(_alpha: number, frameDt: number): void {
    const root = this.heli.model.root;
    this.cameraRig.update(root.position, this.heli.forward(this.fwd), frameDt);
    // Searchlight under the nose, pointing ahead and steeply down.
    this.lightFrom.set(1.6, 0.4, 0).applyQuaternion(root.quaternion).add(root.position);
    this.lightTo.copy(this.lightFrom).addScaledVector(this.fwd.setY(0).normalize(), 18);
    this.lightTo.y -= 30;
    this.light.aim(this.lightFrom, this.lightTo, 6000);
  }

  focus(): THREE.Vector3 {
    return this.heli.interp.currPos;
  }

  prompt(): string | null {
    if (this.heli.rotor < 1) return `Rotor spinning up… ${Math.round(this.heli.rotor * 100)}%`;
    return null;
  }

  status(): string {
    return `${Math.round(this.heli.altitude)} m · ${Math.round(this.heli.groundSpeed * 3.6)} km/h`;
  }
}
