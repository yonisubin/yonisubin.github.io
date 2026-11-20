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
import { CarDynamics, SUSPENSION_REST } from '../sim/carDynamics';

// Drivable car: the physics (ray-cast vehicle, engine, brakes, steering, drag) is in
// sim/carDynamics.ts, shared with the headless RL simulator; this adds the model, sinking,
// flip recovery and crash damage.

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

  private readonly dynamics: CarDynamics;
  private readonly wheels: THREE.Group[] = [];
  private readonly flip = new FlipRecovery(FLIP_DELAY, 1.5);
  /** Largest sudden velocity change (m/s) since takeImpact() was last called. */
  private readonly impacts = new ImpactMeter();

  constructor(
    private readonly world: RAPIER.World,
    scene: THREE.Scene,
    options: CarOptions,
  ) {
    const d = CAR_DIMENSIONS[options.type];
    this.type = options.type;
    this.origin = options.respawn ? { position: options.position.clone(), yaw: options.yaw } : null;

    this.dynamics = new CarDynamics(world, options.type, options.position.x, options.position.y, options.position.z, options.yaw);
    this.body = this.dynamics.body;
    this.controller = this.dynamics.controller;

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
    this.dynamics.dispose(world);
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
    this.impacts.before(this.body);

    this.dynamics.step({ driven: this.driven, throttle: this.throttle, steer: this.steerInput, handbrake: this.handbrake }, dt);
    const absSpeed = Math.abs(this.speed);
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
      const c = this.dynamics.wheelConnections[i];
      const len = this.controller.wheelSuspensionLength(i) ?? SUSPENSION_REST;
      w.position.set(c.x, c.y - len, c.z);
      const steer = i < 2 ? this.dynamics.steer : 0;
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
