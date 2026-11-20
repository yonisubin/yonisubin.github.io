import RAPIER from '@dimforge/rapier3d-compat';
import { CAR_DIMENSIONS, type CarType } from '../vehicles/carDimensions';

// The drivable car's physics, with no three.js: the player's car (player/car.ts) wraps it with
// a model, sinking and flip recovery, and the headless RL simulator (rl/sim) uses it as is, so
// a trained driver handles exactly like the car the player drives.
//
// Built on Rapier's ray-cast vehicle controller. The chassis is one dynamic rigid body.
// Instead of wheel bodies, each wheel is a ray cast down from the chassis: where it hits the
// ground, a spring-damper suspension force pushes the chassis up, and tyre friction impulses
// (engine, brakes, sideways grip) are applied at the contact point. This is the classic
// "raycast vehicle" — cheap and very stable.
//
// Chassis space: +X forward, +Y up, +Z right (left-hand drive: the driver sits on −Z).

// Wheel indices.
export const FL = 0;
export const FR = 1;
export const RL = 2;
export const RR = 3;

export const SUSPENSION_REST = 0.32; // m, spring length at rest
const SUSPENSION_TRAVEL = 0.22; // m
export const CONNECTION_HEIGHT = 0.6; // m above the chassis origin where the suspension is mounted
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
export const TOP_SPEED = 32; // m/s (≈115 km/h): aerodynamic drag balances the engine here
export const MAX_STEER = 0.6; // rad of front-wheel lock at standstill
export const MIN_STEER = 0.14; // rad at top speed (less lock at speed keeps the car stable)
const STEER_RATE = 2.2; // rad/s, how fast the wheels turn toward the requested angle

/** Small per-car variations (domain randomisation for RL training). All 1 = the game's car. */
export interface CarTune {
  mass: number;
  engine: number;
  grip: number;
}

export const DEFAULT_TUNE: Readonly<CarTune> = { mass: 1, engine: 1, grip: 1 };

/** Driver inputs for one step. */
export interface CarInputs {
  /** Someone is at the wheel (otherwise the brakes go on). */
  driven: boolean;
  /** −1..1: forward axis of the stick / W-S keys. */
  throttle: number;
  /** −1..1, positive = right. */
  steer: number;
  handbrake: boolean;
}

export class CarDynamics {
  readonly body: RAPIER.RigidBody;
  readonly controller: RAPIER.DynamicRayCastVehicleController;
  readonly mass: number;
  /** Front-wheel angle (rad, positive = left), chasing the requested angle at STEER_RATE. */
  steer = 0;
  /** Chassis-space wheel mount points (FL, FR, RL, RR). */
  readonly wheelConnections: { x: number; y: number; z: number }[] = [];
  private readonly engineAccel: number;

  constructor(
    world: RAPIER.World,
    type: CarType,
    x: number,
    y: number,
    z: number,
    yaw: number,
    tune: Readonly<CarTune> = DEFAULT_TUNE,
  ) {
    const d = CAR_DIMENSIONS[type];
    this.mass = d.mass * tune.mass;
    this.engineAccel = ENGINE_ACCEL * tune.engine;

    // Start slightly above the ground so the suspension settles into place.
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, y + 0.15, z)
        .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
        .setLinearDamping(0.05)
        .setAngularDamping(0.4)
        .setCcdEnabled(true), // no tunnelling through lamp posts at speed
    );

    // Mass properties set by hand: a box of the car's size, but with the centre of mass
    // pulled down toward the floor pan (engine, battery, people sit low), which is what
    // stops the car from rolling over in turns.
    const [hx, hy, hz] = d.boxHalf;
    const m = this.mass;
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
    if (type !== 'van') {
      // Cabin, massless (the main box carries all the mass).
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.75, 0.22, hz - 0.12).setTranslation(-0.35, 1.2, 0).setDensity(0),
        this.body,
      );
    }

    this.controller = world.createVehicleController(this.body);
    const wx = d.wheelBase / 2;
    const wz = d.track / 2;
    this.wheelConnections.push(
      { x: wx, y: CONNECTION_HEIGHT, z: -wz }, // FL
      { x: wx, y: CONNECTION_HEIGHT, z: wz }, // FR
      { x: -wx, y: CONNECTION_HEIGHT, z: -wz }, // RL
      { x: -wx, y: CONNECTION_HEIGHT, z: wz }, // RR
    );
    for (const p of this.wheelConnections) {
      this.controller.addWheel(p, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, SUSPENSION_REST, d.wheelRadius);
    }
    for (let i = 0; i < 4; i++) {
      this.controller.setWheelSuspensionStiffness(i, SUSPENSION_STIFFNESS);
      this.controller.setWheelSuspensionCompression(i, SUSPENSION_COMPRESSION);
      this.controller.setWheelSuspensionRelaxation(i, SUSPENSION_RELAXATION);
      this.controller.setWheelMaxSuspensionTravel(i, SUSPENSION_TRAVEL);
      this.controller.setWheelMaxSuspensionForce(i, MAX_SUSPENSION_FORCE);
      this.controller.setWheelFrictionSlip(i, FRICTION_SLIP * tune.grip);
    }
  }

  /** Signed speed along the car's forward axis, m/s. */
  get speed(): number {
    return this.controller.currentVehicleSpeed();
  }

  /** Remove the body (with its colliders) and the vehicle controller. */
  dispose(world: RAPIER.World): void {
    world.removeVehicleController(this.controller);
    world.removeRigidBody(this.body);
  }

  /** Apply one fixed step of steering, engine, brakes and drag, and update the wheels. */
  step(input: CarInputs, dt: number): void {
    const speed = this.speed;
    const absSpeed = Math.abs(speed);

    // --- Steering. Positive steering angle turns the wheels toward −Z (left), so a
    // right-hand input (+1) maps to a negative angle. Less lock at higher speed.
    const t = Math.min(1, absSpeed / TOP_SPEED);
    const lock = (1 - t) * MAX_STEER + t * MIN_STEER;
    const targetSteer = input.driven ? -input.steer * lock : 0;
    const maxDelta = STEER_RATE * dt;
    this.steer += Math.max(-maxDelta, Math.min(maxDelta, targetSteer - this.steer));
    this.controller.setWheelSteering(FL, this.steer);
    this.controller.setWheelSteering(FR, this.steer);

    // --- Engine and brakes. Forces scale with mass so every car type feels similar.
    // Brake values are impulse caps per step (N·s): decel · mass · dt, spread over the wheels.
    const brakeImpulse = (decel: number, wheels: number) => (decel * this.mass * dt) / wheels;
    let engine = 0;
    let brake = 0;
    if (!input.driven) {
      // Nobody at the wheel: brakes full on while it's still rolling (someone bailed out),
      // the parking brake once it has stopped.
      brake = brakeImpulse(absSpeed > 0.5 ? BRAKE_DECEL : PARK_DECEL, 4);
    } else if (input.throttle > 0.05) {
      // Pressing forward while rolling backward brakes first, then drives.
      if (speed < -0.5) brake = brakeImpulse(BRAKE_DECEL * input.throttle, 4);
      else engine = this.engineAccel * this.mass * input.throttle;
    } else if (input.throttle < -0.05) {
      if (speed > 0.5) brake = brakeImpulse(BRAKE_DECEL * -input.throttle, 4);
      else if (speed > -REVERSE_TOP_SPEED) engine = REVERSE_ACCEL * this.mass * input.throttle; // negative = reverse
    } else {
      brake = brakeImpulse(COAST_DECEL, 4);
    }
    // Rear-wheel drive.
    this.controller.setWheelEngineForce(RL, engine / 2);
    this.controller.setWheelEngineForce(RR, engine / 2);
    const handbrake = input.handbrake && input.driven;
    const rearBrake = handbrake ? brakeImpulse(HANDBRAKE_DECEL, 2) : brake;
    this.controller.setWheelBrake(FL, brake);
    this.controller.setWheelBrake(FR, brake);
    this.controller.setWheelBrake(RL, rearBrake);
    this.controller.setWheelBrake(RR, rearBrake);
    // Handbrake also lets the rear slide out (less sideways grip) for handbrake turns.
    const rearGrip = handbrake ? 0.35 : 1;
    this.controller.setWheelSideFrictionStiffness(RL, rearGrip);
    this.controller.setWheelSideFrictionStiffness(RR, rearGrip);

    // --- Aerodynamic drag, F = −k·|v|·v. k is chosen so drag equals full engine force at
    // TOP_SPEED, which is what limits the top speed.
    const v = this.body.linvel();
    const vLen = Math.hypot(v.x, v.y, v.z);
    const k = (this.engineAccel * this.mass) / (TOP_SPEED * TOP_SPEED);
    this.body.resetForces(false);
    this.body.addForce({ x: -k * vLen * v.x, y: -k * vLen * v.y, z: -k * vLen * v.z }, false);

    this.controller.updateVehicle(dt);
  }
}
