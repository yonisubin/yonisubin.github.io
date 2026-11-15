import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Input } from '../input/actions';
import type { PlayerMode, TouchButton } from './state';
import { BodyInterpolator, type SimEntity } from '../sim/entity';
import { findFreeSpot } from '../sim/exit';
import { ChaseCamera } from '../camera/chaseCamera';
import type { VehicleLight } from '../sim/vehicleLight';
import type { PlayerStats } from '../game/stats';
import { BOAT_DIMENSIONS, buildBoat, type BoatType } from '../vehicles/boatModel';

// Boats (a speedboat and a jet ski): one dynamic rigid body floating on the water.
//
//  • Buoyancy: five points on the hull bottom (four corners and the middle). Each pushes up
//    in proportion to how deep it is under the water surface at that point (the same waves
//    swimmers feel), like a spring: k = m·g / (5·draft), so the boat floats at its draft and
//    pitches and rolls over the swell. A damper on each point's vertical speed stops it
//    bobbing for ever.
//  • Hull drag, in the boat's own frame: quadratic along it (sets the top speed), strong and
//    linear sideways (the keel: the boat goes where it points instead of skidding), and a
//    damper on the turn rate.
//  • Thrust along the boat, only while the stern (propeller / jet) is in the water; reverse
//    is weaker. Steering is a target turn rate, stronger with speed (a rudder needs flow), and
//    the jet ski can turn a little even when stopped.
//  • Planing: at speed the bow lifts a little (a pitch-up torque), as real hulls do.
//  • On land (driven onto the beach) there's no water force: it rests on its hull and friction
//    stops it.
//
// Body space: +X forward (bow), +Y up, +Z right; origin at the bottom of the keel.

const G = 9.81;
const SPECS: Record<BoatType, { accel: number; topSpeed: number; reverse: number; turnRate: number; idleTurn: number; side: number }> = {
  // accel: thrust ÷ mass (m/s²); topSpeed sets the drag; turnRate (rad/s) at full rudder.
  speedboat: { accel: 4.5, topSpeed: 21, reverse: 0.3, turnRate: 0.75, idleTurn: 0.15, side: 2.2 },
  jetski: { accel: 6, topSpeed: 19, reverse: 0.3, turnRate: 1.5, idleTurn: 0.45, side: 3 },
};
/** Deceleration (m/s²) of a boat with nobody at the helm. */
const IDLE_DECEL = 3;
const CRASH_THRESHOLD = 5; // m/s of sudden velocity change before it hurts the driver
const CRASH_DAMAGE = 3;

export class Boat implements SimEntity {
  readonly type: BoatType;
  readonly body: RAPIER.RigidBody;
  readonly object: THREE.Group;
  readonly interp: BodyInterpolator;
  mode: BoatMode | null = null;

  // Set each step by BoatMode.
  driven = false;
  throttle = 0; // −1 … 1
  steerInput = 0; // −1 (left) … 1 (right)

  /** Speed along the boat's own forward axis, m/s. */
  speed = 0;
  /** True while any part of the hull is in the water. */
  afloat = false;
  private impact = 0;
  private readonly velBefore = new THREE.Vector3();
  private readonly points: THREE.Vector3[];
  private readonly mass: number;

  constructor(
    private readonly world: RAPIER.World,
    scene: THREE.Scene,
    type: BoatType,
    color: number,
    position: THREE.Vector3,
    yaw: number,
    /** Water surface height at (x, z) now, or null over land (Water.surfaceAt). */
    private readonly water: (x: number, z: number) => number | null,
  ) {
    this.type = type;
    const d = BOAT_DIMENSIONS[type];
    this.mass = d.mass;
    this.object = buildBoat(type, color);
    scene.add(this.object);

    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw))
        .setCanSleep(false) // the waves keep it moving
        .setAngularDamping(0.6),
    );
    // A box hull; density gives the wanted mass (Rapier works out the inertia from it).
    const hx = d.length / 2;
    const hy = d.height / 2;
    const hz = d.beam / 2;
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(0, hy, 0)
        .setDensity(d.mass / (8 * hx * hy * hz))
        .setFriction(0.8),
      this.body,
    );
    // Buoyancy points on the hull bottom, slightly in from the ends and sides.
    this.points = [
      new THREE.Vector3(hx * 0.75, 0.05, hz * 0.6),
      new THREE.Vector3(hx * 0.75, 0.05, -hz * 0.6),
      new THREE.Vector3(-hx * 0.8, 0.05, hz * 0.7),
      new THREE.Vector3(-hx * 0.8, 0.05, -hz * 0.7),
      new THREE.Vector3(0, 0.0, 0),
    ];
    this.interp = new BodyInterpolator(this.body);
  }

  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(1, 0, 0).applyQuaternion(this.interp.currQuat);
  }

  fixedUpdate(): void {
    const d = BOAT_DIMENSIONS[this.type];
    const spec = SPECS[this.type];
    const tr = this.body.translation();
    const t = new THREE.Vector3(tr.x, tr.y, tr.z);
    const r = this.body.rotation();
    const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const v = this.body.linvel();
    const w = this.body.angvel();
    this.velBefore.set(v.x, v.y, v.z);
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const right = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const fwdH = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
    const rightH = new THREE.Vector3(right.x, 0, right.z).normalize();
    this.speed = v.x * fwdH.x + v.z * fwdH.z;
    const side = v.x * rightH.x + v.z * rightH.z;

    this.body.resetForces(false);
    this.body.resetTorques(false);

    // --- Buoyancy and heave damping at each hull point.
    const k = (this.mass * G) / (this.points.length * d.draft);
    const c = 2 * Math.sqrt((k * this.mass) / this.points.length) * 0.5; // half critical damping
    let wet = 0;
    let sternWet = false;
    const world = new THREE.Vector3();
    const arm = new THREE.Vector3();
    this.points.forEach((local, i) => {
      world.copy(local).applyQuaternion(q).add(t);
      const surface = this.water(world.x, world.z);
      if (surface === null) return;
      const depth = surface - world.y;
      if (depth <= 0) return;
      wet++;
      if (i === 2 || i === 3) sternWet = true;
      // Velocity of this point: v + ω × r.
      arm.copy(world).sub(t);
      const vy = v.y + (w.z * arm.x - w.x * arm.z);
      const f = k * Math.min(depth, d.height * 1.2) - c * vy;
      this.body.addForceAtPoint({ x: 0, y: Math.max(0, f), z: 0 }, world, false);
    });
    this.afloat = wet > 0;

    if (this.afloat) {
      const wetFraction = wet / this.points.length;
      // --- Hull drag: quadratic along (k chosen so it equals full thrust at top speed),
      // strong linear sideways (the keel), plus some vertical water resistance.
      const kAlong = (spec.accel * this.mass) / (spec.topSpeed * spec.topSpeed);
      const along = -kAlong * this.speed * Math.abs(this.speed) * wetFraction;
      const across = -spec.side * this.mass * side * wetFraction;
      this.body.addForce(
        {
          x: fwdH.x * along + rightH.x * across,
          y: -0.6 * this.mass * v.y * wetFraction,
          z: fwdH.z * along + rightH.z * across,
        },
        false,
      );

      // --- Nobody at the helm (they jumped off): the engine dies and the boat slows to a
      // stop over a few seconds, the way an abandoned car brakes.
      if (!this.driven && Math.abs(this.speed) > 0.05) {
        const f = -Math.sign(this.speed) * Math.min(IDLE_DECEL, Math.abs(this.speed) * 2) * this.mass * wetFraction;
        this.body.addForce({ x: fwdH.x * f, y: 0, z: fwdH.z * f }, false);
      }

      // --- Thrust, only with the propeller in the water.
      if (this.driven && sternWet) {
        const thrust = this.throttle >= 0 ? this.throttle : this.throttle * spec.reverse;
        const f = thrust * spec.accel * this.mass;
        this.body.addForce({ x: fwdH.x * f, y: 0, z: fwdH.z * f }, false);
      }

      // --- Steering: chase a target turn rate (clockwise from above = turning right is a
      // negative rotation about +Y). Rudders need water flowing past; reversing turns the
      // other way, as with a real boat.
      const flow = Math.min(1, Math.abs(this.speed) / 6);
      const authority = Math.max(spec.idleTurn, flow) * (this.speed < -0.5 ? -1 : 1);
      const targetYaw = this.driven ? -this.steerInput * spec.turnRate * authority : 0;
      const inertiaY = this.mass * (d.length * d.length + d.beam * d.beam) / 12;
      this.body.addTorque({ x: 0, y: inertiaY * 3 * (targetYaw - w.y) * wetFraction, z: 0 }, false);

      // --- Planing: bow up a few degrees at speed (a torque about the boat's right axis
      // raises the nose), and a little lean into turns.
      const inertiaZ = this.mass * (d.length * d.length + d.height * d.height) / 12;
      const lift = 0.04 * Math.min(1, Math.max(0, this.speed - 4) / 10);
      const pitch = Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1));
      const pitchRate = w.x * right.x + w.y * right.y + w.z * right.z;
      const tau = inertiaZ * (8 * (lift * 2.2 - pitch) - 3 * pitchRate) * (lift > 0 ? 1 : 0);
      this.body.addTorque({ x: right.x * tau, y: right.y * tau, z: right.z * tau }, false);
    }
  }

  afterStep(): void {
    this.interp.capture();
    const v = this.body.linvel();
    const dv = Math.hypot(v.x - this.velBefore.x, v.y - this.velBefore.y, v.z - this.velBefore.z);
    this.impact = Math.max(this.impact, dv);
  }

  /** Read and reset the biggest jolt since the last call (m/s of velocity change). */
  takeImpact(): number {
    const i = this.impact;
    this.impact = 0;
    return i;
  }

  render(alpha: number): void {
    this.interp.apply(this.object, alpha);
  }

  /** A free spot beside the boat (in the water, usually) to put the player when they get out. */
  findExitPoint(shape: RAPIER.Shape, standHeight: number): THREE.Vector3 {
    const d = BOAT_DIMENSIONS[this.type];
    const side = d.beam / 2 + 0.8;
    return findFreeSpot(
      this.world,
      shape,
      standHeight,
      this.body,
      this.interp.currPos,
      this.interp.currQuat,
      [
        new THREE.Vector3(0, 0, -side),
        new THREE.Vector3(0, 0, side),
        new THREE.Vector3(-d.length / 2 - 1, 0, 0),
        new THREE.Vector3(d.length / 2 + 1, 0, 0),
      ],
      d.height + 0.2,
    );
  }
}

/** Player-at-the-helm mode: reads input, drives the boat, runs the chase camera. */
export class BoatMode implements PlayerMode {
  readonly name = 'Boating';
  readonly controlsHint = 'W throttle · S reverse · A/D steer · E get out';
  readonly touchButtons: TouchButton[] = [{ label: 'EXIT', action: 'interact' }];
  private readonly cameraRig: ChaseCamera;
  private readonly fwd = new THREE.Vector3();
  private readonly lightFrom = new THREE.Vector3();
  private readonly lightTo = new THREE.Vector3();

  constructor(
    private readonly boat: Boat,
    private readonly input: Input,
    camera: THREE.PerspectiveCamera,
    world: RAPIER.World,
    private readonly onExit: (boat: Boat) => void,
    private readonly light: VehicleLight,
    private readonly stats: PlayerStats,
  ) {
    const big = boat.type === 'speedboat';
    this.cameraRig = new ChaseCamera(camera, input, world, { distance: big ? 9 : 6.5, pivotHeight: big ? 1.9 : 1.5, pitch: 0.24 }, boat.body);
  }

  enter(): void {
    this.boat.takeImpact();
    this.boat.driven = true;
    this.cameraRig.reset();
  }

  exit(): void {
    this.light.off();
    this.boat.driven = false;
    this.boat.throttle = 0;
    this.boat.steerInput = 0;
  }

  update(): void {
    const axis = this.input.moveAxis();
    this.boat.throttle = axis.y;
    this.boat.steerInput = axis.x;
    const impact = this.boat.takeImpact();
    if (impact > CRASH_THRESHOLD) this.stats.damage((impact - CRASH_THRESHOLD) * CRASH_DAMAGE);
    if (this.input.consumePressed('interact')) this.onExit(this.boat);
  }

  render(_alpha: number, frameDt: number): void {
    const obj = this.boat.object;
    this.cameraRig.update(obj.position, this.boat.forward(this.fwd), frameDt);
    // A bow light at night, aimed over the water ahead.
    const d = BOAT_DIMENSIONS[this.boat.type];
    this.lightFrom.set(d.length / 2, d.height + 0.3, 0).applyQuaternion(obj.quaternion).add(obj.position);
    this.lightTo.set(30, -2, 0).applyQuaternion(obj.quaternion).add(obj.position);
    this.light.aim(this.lightFrom, this.lightTo, 900);
  }

  focus(): THREE.Vector3 {
    return this.boat.interp.currPos;
  }

  prompt(): string | null {
    return this.boat.afloat ? null : 'Aground: push off into deeper water';
  }

  status(): string {
    return `${Math.round(Math.abs(this.boat.speed) * 3.6)} km/h`;
  }
}
