import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Input } from '../input/actions';
import type { PlayerMode, TouchButton } from './state';
import { BodyInterpolator, type SimEntity } from '../sim/entity';
import { findFreeSpot } from '../sim/exit';
import { Sinking } from '../sim/sinking';
import { FlipRecovery, ImpactMeter, placeBody } from '../sim/vehicleBody';
import { ChaseCamera } from '../camera/chaseCamera';
import type { VehicleLight } from '../sim/vehicleLight';
import type { PlayerStats } from '../game/stats';
import { CAR_DIMENSIONS, ambulanceLivery, buildCarBody, buildWheel, type CarType } from '../vehicles/carModel';

// Drivable car built on Rapier's ray-cast vehicle controller.
//
// The chassis is one dynamic rigid body. Instead of wheel bodies, each wheel is a ray cast
// down from the chassis: where it hits the ground, a spring-damper suspension force pushes
// the chassis up, and tyre friction impulses (engine, brakes, sideways grip) are applied at
// the contact point. This is the classic "raycast vehicle" — cheap and very stable.
//
// Chassis space: +X forward, +Y up, +Z right (left-hand drive: the driver sits on −Z).

// Wheel indices.
const FL = 0;
const FR = 1;
const RL = 2;
const RR = 3;

const SUSPENSION_REST = 0.32; // m, spring length at rest
const SUSPENSION_TRAVEL = 0.22; // m
const CONNECTION_HEIGHT = 0.6; // m above the chassis origin where the suspension is mounted
// Spring stiffness and damping are per unit of chassis mass (the controller multiplies by
// mass), so they mean the same thing for a light sedan and a heavy van.
// Static sag = g / (4·k) ≈ 7 cm with k = 35. Damping ≈ 0.4 of critical (2·√k ≈ 11.8).
const SUSPENSION_STIFFNESS = 35;
const SUSPENSION_COMPRESSION = 4.5;
const SUSPENSION_RELAXATION = 3.0;
const MAX_SUSPENSION_FORCE = 60000; // N per wheel
// Tyre grip: the friction impulse cap is suspension force × frictionSlip, so this works like
// a friction coefficient. ~1.6 grips well without letting the car roll over in hard turns.
const FRICTION_SLIP = 1.6;

const ENGINE_ACCEL = 5.5; // m/s² of push at full throttle (force scales with mass)
const REVERSE_ACCEL = 2.5; // m/s²
const REVERSE_TOP_SPEED = 7; // m/s
const BRAKE_DECEL = 9; // m/s² with the brake fully on
const HANDBRAKE_DECEL = 12; // m/s², rear wheels only
const PARK_DECEL = 6; // m/s², holds a parked car still
const COAST_DECEL = 0.4; // m/s², engine braking when you lift off
const TOP_SPEED = 32; // m/s (≈115 km/h): aerodynamic drag balances the engine here
const MAX_STEER = 0.6; // rad of front-wheel lock at standstill
const MIN_STEER = 0.14; // rad at top speed (less lock at speed keeps the car stable)
const STEER_RATE = 2.2; // rad/s, how fast the wheels turn toward the requested angle
const FLIP_DELAY = 2; // s upside down (and slow) before the car is put back on its wheels
// Crash damage to the driver. A crash shows up as a sudden change of velocity within one
// physics step; normal driving changes it by well under 1 m/s per step.
const CRASH_THRESHOLD = 4; // m/s of sudden velocity change before it hurts
const CRASH_DAMAGE = 3.5; // health per m/s above that (a 70 km/h head-on wall hit ≈ 55)

export interface CarOptions {
  type: CarType;
  color: number;
  position: THREE.Vector3; // ground-level position
  yaw: number; // rad; 0 = facing +X
  /** Put it back here after it's lost (sunk); otherwise it's gone for good (jacked cars). */
  respawn?: boolean;
  /** Special markings (an ambulance is a white van with them). */
  livery?: 'ambulance';
}

export class Car implements SimEntity {
  readonly type: CarType;
  readonly body: RAPIER.RigidBody;
  readonly controller: RAPIER.DynamicRayCastVehicleController;
  readonly object = new THREE.Group();
  readonly livery: 'ambulance' | null;
  /** Its own paint material (everything else in the model is shared between cars). */
  private readonly paint: THREE.Material;
  /** Roof light materials (ambulance), flashed while on a job. */
  beacons: { red: THREE.MeshBasicMaterial; blue: THREE.MeshBasicMaterial } | null = null;
  readonly interp: BodyInterpolator;
  /** Set by the game once the player exists (see main.ts). */
  mode: DrivingMode | null = null;
  /** Drove into deep water: sinking (see sim/sinking.ts). */
  readonly sinking = new Sinking();
  /** Called once when the car goes under (the game ejects the driver). */
  onSink: ((car: Car) => void) | null = null;
  /** Sunk and not coming back (a jacked car): hidden, no physics. */
  gone = false;
  private readonly origin: { position: THREE.Vector3; yaw: number } | null;

  // Driver inputs, set each step by DrivingMode (all zero when parked).
  driven = false;
  throttle = 0; // −1..1: forward axis of the stick / W-S keys
  steerInput = 0; // −1..1, positive = right
  handbrake = false;

  private readonly wheels: THREE.Group[] = [];
  private steer = 0;
  private readonly flip = new FlipRecovery(FLIP_DELAY, 1.5);
  /** Largest sudden velocity change (m/s) since takeImpact() was last called. */
  private readonly impacts = new ImpactMeter();
  private readonly mass: number;
  private readonly wheelConnections: THREE.Vector3[] = [];

  constructor(
    private readonly world: RAPIER.World,
    scene: THREE.Scene,
    options: CarOptions,
  ) {
    const d = CAR_DIMENSIONS[options.type];
    this.type = options.type;
    this.mass = d.mass;
    this.origin = options.respawn ? { position: options.position.clone(), yaw: options.yaw } : null;

    // Start slightly above the ground so the suspension settles into place.
    const spawn = options.position.clone().add(new THREE.Vector3(0, 0.15, 0));
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), options.yaw);
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, spawn.y, spawn.z)
        .setRotation(rot)
        .setLinearDamping(0.05)
        .setAngularDamping(0.4)
        .setCcdEnabled(true), // no tunnelling through lamp posts at speed
    );

    // Mass properties set by hand: a box of the car's size, but with the centre of mass
    // pulled down toward the floor pan (engine, battery, people sit low), which is what
    // stops the car from rolling over in turns.
    const [hx, hy, hz] = d.boxHalf;
    const m = d.mass;
    const inertia = {
      x: (m / 3) * (hy * hy + hz * hz), // box inertia: m/12·(a² + b²) with a = 2·half
      y: (m / 3) * (hx * hx + hz * hz),
      z: (m / 3) * (hx * hx + hy * hy),
    };
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(...d.boxCenter)
        .setMassProperties(m, { x: 0, y: 0.38, z: 0 }, inertia, { x: 0, y: 0, z: 0, w: 1 })
        .setFriction(0.4),
      this.body,
    );
    if (options.type !== 'van') {
      // Cabin, massless (the main box carries all the mass).
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.75, 0.22, hz - 0.12).setTranslation(-0.35, 1.2, 0).setDensity(0),
        this.body,
      );
    }

    this.controller = world.createVehicleController(this.body);
    const wx = d.wheelBase / 2;
    const wz = d.track / 2;
    const positions = [
      new THREE.Vector3(wx, CONNECTION_HEIGHT, -wz), // FL
      new THREE.Vector3(wx, CONNECTION_HEIGHT, wz), // FR
      new THREE.Vector3(-wx, CONNECTION_HEIGHT, -wz), // RL
      new THREE.Vector3(-wx, CONNECTION_HEIGHT, wz), // RR
    ];
    for (const p of positions) {
      this.wheelConnections.push(p);
      this.controller.addWheel(p, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, SUSPENSION_REST, d.wheelRadius);
    }
    for (let i = 0; i < 4; i++) {
      this.controller.setWheelSuspensionStiffness(i, SUSPENSION_STIFFNESS);
      this.controller.setWheelSuspensionCompression(i, SUSPENSION_COMPRESSION);
      this.controller.setWheelSuspensionRelaxation(i, SUSPENSION_RELAXATION);
      this.controller.setWheelMaxSuspensionTravel(i, SUSPENSION_TRAVEL);
      this.controller.setWheelMaxSuspensionForce(i, MAX_SUSPENSION_FORCE);
      this.controller.setWheelFrictionSlip(i, FRICTION_SLIP);
    }

    // Visuals.
    const bodyMeshes = buildCarBody(options.type, options.color);
    this.paint = (bodyMeshes.children[0] as THREE.Mesh).material as THREE.Material;
    this.object.add(bodyMeshes);
    this.livery = options.livery ?? null;
    if (options.livery === 'ambulance') {
      const l = ambulanceLivery();
      this.object.add(l.group);
      this.beacons = { red: l.red, blue: l.blue };
    }
    for (let i = 0; i < 4; i++) {
      const wheel = buildWheel(d.wheelRadius);
      this.wheels.push(wheel);
      this.object.add(wheel);
    }
    scene.add(this.object);
    this.interp = new BodyInterpolator(this.body);
  }

  /** Remove the car for good: physics body (with its colliders), vehicle controller, model. */
  dispose(world: RAPIER.World, scene: THREE.Scene): void {
    world.removeVehicleController(this.controller);
    world.removeRigidBody(this.body);
    scene.remove(this.object);
    this.paint.dispose();
    this.gone = true;
  }

  /** Signed speed along the car's forward axis, m/s. */
  get speed(): number {
    return this.controller.currentVehicleSpeed();
  }

  /** World-space forward direction from the latest physics pose. */
  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(1, 0, 0).applyQuaternion(this.interp.currQuat);
  }

  fixedUpdate(dt: number): void {
    if (this.gone) return;
    if (this.sinking.active) {
      // In the water: no engine, no suspension, just sinking.
      this.sinking.apply(this.body, dt);
      if (this.sinking.done) this.clearWreck();
      return;
    }
    // A parked car at rest sleeps; skip it entirely until something bumps it awake.
    if (!this.driven && this.body.isSleeping()) return;
    // The car you're driving must never sleep. Rapier puts a body to sleep ~0.5 s after it
    // comes to rest, and the vehicle controller's wheel impulses (and our drag force) don't
    // wake it: sit still for a moment (getting in, a taxi fare boarding, a red light) and the
    // car would steer but never move again.
    if (this.driven && this.body.isSleeping()) this.body.wakeUp();
    this.impacts.before(this.body);

    const speed = this.speed;
    const absSpeed = Math.abs(speed);

    // --- Steering. Positive steering angle turns the wheels toward −Z (left), so a
    // right-hand input (+1) maps to a negative angle. Less lock at higher speed.
    const lock = THREE.MathUtils.lerp(MAX_STEER, MIN_STEER, Math.min(1, absSpeed / TOP_SPEED));
    const targetSteer = this.driven ? -this.steerInput * lock : 0;
    const maxDelta = STEER_RATE * dt;
    this.steer += THREE.MathUtils.clamp(targetSteer - this.steer, -maxDelta, maxDelta);
    this.controller.setWheelSteering(FL, this.steer);
    this.controller.setWheelSteering(FR, this.steer);

    // --- Engine and brakes. Forces scale with mass so every car type feels similar.
    // Brake values are impulse caps per step (N·s): decel · mass · dt, spread over the wheels.
    const brakeImpulse = (decel: number, wheels: number) => (decel * this.mass * dt) / wheels;
    let engine = 0;
    let brake = 0;
    if (!this.driven) {
      // Nobody at the wheel: brakes full on while it's still rolling (someone bailed out),
      // the parking brake once it has stopped.
      brake = brakeImpulse(absSpeed > 0.5 ? BRAKE_DECEL : PARK_DECEL, 4);
    } else if (this.throttle > 0.05) {
      // Pressing forward while rolling backward brakes first, then drives.
      if (speed < -0.5) brake = brakeImpulse(BRAKE_DECEL * this.throttle, 4);
      else engine = ENGINE_ACCEL * this.mass * this.throttle;
    } else if (this.throttle < -0.05) {
      if (speed > 0.5) brake = brakeImpulse(BRAKE_DECEL * -this.throttle, 4);
      else if (speed > -REVERSE_TOP_SPEED) engine = REVERSE_ACCEL * this.mass * this.throttle; // negative = reverse
    } else {
      brake = brakeImpulse(COAST_DECEL, 4);
    }
    // Rear-wheel drive.
    this.controller.setWheelEngineForce(RL, engine / 2);
    this.controller.setWheelEngineForce(RR, engine / 2);
    const rearBrake = this.handbrake && this.driven ? brakeImpulse(HANDBRAKE_DECEL, 2) : brake;
    this.controller.setWheelBrake(FL, brake);
    this.controller.setWheelBrake(FR, brake);
    this.controller.setWheelBrake(RL, rearBrake);
    this.controller.setWheelBrake(RR, rearBrake);
    // Handbrake also lets the rear slide out (less sideways grip) for handbrake turns.
    const rearGrip = this.handbrake && this.driven ? 0.35 : 1;
    this.controller.setWheelSideFrictionStiffness(RL, rearGrip);
    this.controller.setWheelSideFrictionStiffness(RR, rearGrip);

    // --- Aerodynamic drag, F = −k·|v|·v. k is chosen so drag equals full engine force at
    // TOP_SPEED, which is what limits the top speed.
    const v = this.body.linvel();
    const vLen = Math.hypot(v.x, v.y, v.z);
    const k = (ENGINE_ACCEL * this.mass) / (TOP_SPEED * TOP_SPEED);
    this.body.resetForces(false);
    this.body.addForce({ x: -k * vLen * v.x, y: -k * vLen * v.y, z: -k * vLen * v.z }, false);

    this.controller.updateVehicle(dt);
    this.flip.update(this.body, this.interp, dt, absSpeed);

    // Driven into deep water: the car floor is under the surface.
    if (this.sinking.check(this.body.translation(), 0.4)) {
      this.sinking.wreck(this.object);
      this.driven = false;
      this.onSink?.(this);
    }
  }

  /** The sunken wreck is cleared: back to its parking spot, or gone for good. */
  private clearWreck(): void {
    if (!this.origin) {
      this.gone = true;
      this.object.visible = false;
      this.body.setEnabled(false);
      return;
    }
    const { position, yaw } = this.origin;
    this.sinking.restore(this.body, 0.05, 0.4);
    placeBody(this.body, this.interp, position.x, position.y + 0.15, position.z, yaw);
  }

  afterStep(): void {
    this.interp.capture();
    this.impacts.after(this.body);
  }

  /** Read and reset the biggest crash since the last call (m/s of velocity change). */
  takeImpact(): number {
    return this.impacts.take();
  }

  render(alpha: number): void {
    this.interp.apply(this.object, alpha);
    // Wheels: the suspension length sets the height, steering the yaw, wheelRotation the spin.
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const c = this.wheelConnections[i];
      const len = this.controller.wheelSuspensionLength(i) ?? SUSPENSION_REST;
      w.position.set(c.x, c.y - len, c.z);
      const steer = i < 2 ? this.steer : 0;
      // Spin about the axle (Z); the controller's rotation angle grows as the car rolls forward.
      w.rotation.set(0, steer, -(this.controller.wheelRotation(i) ?? 0), 'YXZ');
    }
  }

  /**
   * A free spot beside the car to put the player when they get out: driver side first,
   * then passenger side, behind, in front, and finally on the roof.
   */
  findExitPoint(shape: RAPIER.Shape, standHeight: number): THREE.Vector3 {
    const d = CAR_DIMENSIONS[this.type];
    const side = d.width / 2 + 0.7;
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
        new THREE.Vector3(-d.length / 2 - 0.8, 0, 0),
        new THREE.Vector3(d.length / 2 + 0.8, 0, 0),
      ],
      this.type === 'van' ? 2.1 : 1.5,
    );
  }
}

/** Player-in-car mode: reads input, drives the car, runs the chase camera. */
export class DrivingMode implements PlayerMode {
  readonly name = 'Driving';
  readonly controlsHint = 'W gas · S brake/reverse · A/D steer · Space handbrake · E get out · J job (taxi, ambulance, van) · R radio';
  readonly touchButtons: TouchButton[];
  private readonly cameraRig: ChaseCamera;
  private readonly fwd = new THREE.Vector3();
  private readonly lightFrom = new THREE.Vector3();
  private readonly lightTo = new THREE.Vector3();

  constructor(
    private readonly car: Car,
    private readonly input: Input,
    camera: THREE.PerspectiveCamera,
    world: RAPIER.World,
    /** Called when the player gets out (the game puts them back on foot beside the car). */
    private readonly onExit: (car: Car) => void,
    /** Headlights at night. */
    private readonly light: VehicleLight,
    private readonly stats: PlayerStats,
  ) {
    this.cameraRig = new ChaseCamera(camera, input, world, { distance: 7.5, pivotHeight: 1.6, pitch: 0.22 }, car.body);
    this.touchButtons = [
      { label: 'BRAKE', action: 'handbrake' },
      { label: 'EXIT', action: 'interact' },
    ];
  }


  enter(): void {
    this.car.takeImpact(); // ignore anything from before we got in
    this.car.driven = true;
    this.car.body.wakeUp();
    this.cameraRig.reset();
  }

  exit(): void {
    this.light.off();
    this.car.driven = false;
    this.car.throttle = 0;
    this.car.steerInput = 0;
    this.car.handbrake = false;
  }

  update(): void {
    const axis = this.input.moveAxis();
    this.car.throttle = axis.y;
    this.car.steerInput = axis.x;
    this.car.handbrake = this.input.isDown('handbrake');
    const impact = this.car.takeImpact();
    if (impact > CRASH_THRESHOLD) this.stats.damage((impact - CRASH_THRESHOLD) * CRASH_DAMAGE);
    if (this.input.consumePressed('interact')) this.onExit(this.car);
  }

  render(_alpha: number, frameDt: number): void {
    // The car's own render() has already placed its mesh at the interpolated pose.
    const obj = this.car.object;
    this.cameraRig.update(obj.position, this.car.forward(this.fwd), frameDt);
    // Headlights: from the front bumper, aimed down the road ahead.
    this.lightFrom.set(2.3, 0.7, 0).applyQuaternion(obj.quaternion).add(obj.position);
    this.lightTo.set(25, -1.5, 0).applyQuaternion(obj.quaternion).add(obj.position);
    this.light.aim(this.lightFrom, this.lightTo, 900);
  }

  focus(): THREE.Vector3 {
    return this.car.interp.currPos;
  }

  prompt(): string | null {
    return null;
  }

  status(): string {
    return `${Math.round(Math.abs(this.car.speed) * 3.6)} km/h`;
  }
}
