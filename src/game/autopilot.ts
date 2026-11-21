import type RAPIER from '@dimforge/rapier3d-compat';
import type { Input } from '../input/actions';
import type { Car } from '../player/car';
import type { SimEntity } from '../sim/entity';
import type { Policy } from '../ai/policy';
import { RoadGraph } from '../world/roadGraph';
import type { StreetNet } from '../world/streets';
import { DriverView, senseDriver } from '../ai/driver';
import { observe, OBS_SIZE, RAY_LENGTH, RAYS, type RaySensors } from '../ai/observe';
import { laneRoute } from '../ai/path';
import { gameSensors } from '../ai/sensors';
import type { Navigator } from './route';

// The car autopilot: an item bought at the stores. Set a destination on the map, press O (or
// AUTO) in any car, and the trained AI driver (the same network as the NPC traffic) takes you
// there along the fastest lanes, then stops. Touching the controls hands the car back.
//
// On top of the network, a safety layer brakes for whatever the radar sees ahead (cars,
// people, poles) when the network brakes too gently, for red lights, and to stop at the
// destination.

/** Price at the stores. Kept cheap for testing; raise it here when balancing the economy. */
export const AUTOPILOT_PRICE = 50;

const DECISION_STEPS = 4; // 15 decisions a second at 60 Hz physics, as trained
const SAFE_DECEL = 4.5; // m/s²: the safety layer brakes when stopping needs more than this
const ARRIVE_DECEL = 2.2; // m/s²: gentle stop at the destination
const FRONT_CLEARANCE = 3.2; // m from the car's centre to a safe gap in front
const TAKEOVER = 0.35; // stick / key deflection that hands control back
const MAX_REROUTES = 3;
const LANE_HALF = 1.6; // m from the lane centre that counts as "in our lane"

export interface AutopilotDeps {
  world: RAPIER.World;
  net: StreetNet;
  input: Input;
  navigator: Navigator;
  /** Owns the autopilot. */
  owned: () => boolean;
  /** The car the player is driving, or null. */
  car: () => Car | null;
  /** Traffic lights' clock (the traffic system's). */
  lightClock: () => number;
  policy: () => Policy | null;
  toast: (text: string, seconds?: number) => void;
}

export class Autopilot implements SimEntity {
  private car: Car | null = null;
  private readonly view = new DriverView();
  private readonly graph: RoadGraph;
  private readonly sensors: RaySensors;
  private readonly obs = new Float32Array(OBS_SIZE);
  private readonly out = new Float32Array(2);
  private goal = 0;
  private steps = 0;
  private reroutes = 0;
  private readonly controls = { steer: 0, throttle: 0, handbrake: false };
  private readonly hit = { s: 0, lat: 0 };
  /** For tests and the debug overlay. */
  readonly stats = { engaged: 0, arrived: 0, shieldSteps: 0, steps: 0, reroutes: 0 };

  constructor(private readonly deps: AutopilotDeps) {
    this.graph = new RoadGraph(deps.net);
    this.sensors = gameSensors(deps.world);
  }

  get engaged(): boolean {
    return this.car !== null;
  }

  /** Remaining distance to the destination along the route, m (null when off). */
  get remaining(): number | null {
    return this.car ? Math.max(0, this.goal - this.view.s) : null;
  }

  toggle(): void {
    if (this.car) {
      this.disengage('Autopilot off');
      return;
    }
    const d = this.deps;
    const car = d.car();
    if (!car) return;
    if (!d.owned()) {
      d.toast('No autopilot — buy one at a gun store', 2.5);
      return;
    }
    if (!d.policy()) {
      d.toast('Autopilot unavailable (AI driver not loaded)', 2.5);
      return;
    }
    if (!d.navigator.waypoint) {
      d.toast('Set a destination on the map first (M, then click)', 2.5);
      return;
    }
    this.reroutes = 0;
    if (!this.plan(car)) {
      d.toast('Autopilot: no road route from here', 2.5);
      return;
    }
    this.car = car;
    car.autoDrive = this.controls;
    this.controls.steer = 0;
    this.controls.throttle = 0;
    this.controls.handbrake = false;
    this.view.action = [0, 0];
    this.view.prevAction = [0, 0];
    this.stats.engaged++;
    d.toast('🤖 Autopilot on — touch the controls to take over', 2.5);
  }

  /** Route from where the car is to the waypoint. */
  private plan(car: Car): boolean {
    const w = this.deps.navigator.waypoint;
    if (!w) return false;
    const p = car.body.translation();
    const q = car.body.rotation();
    const fx = 1 - 2 * (q.y * q.y + q.z * q.z);
    const fz = 2 * (q.x * q.z - q.w * q.y);
    const r = laneRoute(this.graph, p.x, p.z, fx, fz, w.x, w.z);
    if (!r) return false;
    this.view.path = r.path;
    this.view.s = r.start;
    this.goal = r.goal;
    return true;
  }

  private disengage(message: string | null): void {
    if (this.car) this.car.autoDrive = null;
    this.car = null;
    if (message) this.deps.toast(message, 2);
  }

  fixedUpdate(): void {
    const car = this.car;
    if (!car) return;
    const d = this.deps;
    // Got out, wrecked, or switched vehicle.
    if (d.car() !== car || !car.driven) {
      this.disengage(null);
      return;
    }
    // The player takes over.
    const axis = d.input.moveAxis();
    if (Math.abs(axis.x) > TAKEOVER || Math.abs(axis.y) > TAKEOVER || d.input.isDown('handbrake')) {
      this.disengage('Autopilot off — you have control');
      return;
    }
    // The destination was cleared on the map (the navigator also clears it within 15 m of
    // arriving: then carry on and stop).
    if (!d.navigator.waypoint && this.goal - this.view.s > 30) {
      this.disengage('Autopilot off');
      return;
    }
    const policy = d.policy();
    if (!policy) return;
    this.steps++;
    this.stats.steps++;
    if (this.steps % DECISION_STEPS === 0) {
      const v = this.view;
      senseDriver(v, car.body, car.wheelSteer, this.sensors, this.graph, d.lightClock());
      // Off the route (shoved, or a wrong turn): plan again from here.
      if (Math.abs(v.lat) > 6) {
        if (++this.reroutes > MAX_REROUTES || !this.plan(car)) {
          this.disengage('Autopilot lost the route — you have control');
          return;
        }
        this.stats.reroutes++;
        senseDriver(v, car.body, car.wheelSteer, this.sensors, this.graph, d.lightClock());
      }
      v.prevAction = v.action;
      observe(v, this.obs);
      policy.act1(this.obs, this.out);
      v.action = [this.out[0], this.out[1]];
      this.applySafety(v);
    }
    // Arrived: stopped at the destination.
    const left = this.goal - this.view.s;
    if (left < 6 && Math.abs(car.speed) < 0.5) {
      this.stats.arrived++;
      this.controls.throttle = 0;
      this.controls.handbrake = true;
      this.disengage('🏁 Autopilot: arrived');
      if (d.navigator.owner === 'user') d.navigator.clear();
    }
  }

  /** The network's action, braked harder when the situation needs it. */
  private applySafety(v: DriverView): void {
    const speed = Math.max(0, v.vFwd);
    let throttle = v.action[1];
    let need = 0; // deceleration needed to stop in time, m/s²
    // Whatever the rays see straight ahead (±20°): cars, people, poles.
    const mid = (RAYS - 1) / 2;
    for (let r = mid - 2; r <= mid + 2; r++) {
      // Only what's in our lane on the route (not a car waiting in the next lane, not a lamp
      // post beside the road): where the ray hit, measured from the route's lane centre.
      const angle = (Math.PI * (r - mid)) / (RAYS - 1);
      const d = v.rays.dist[r];
      if (d >= RAY_LENGTH) continue;
      const f = v.frame;
      const hx = f.x + d * (Math.cos(angle) * f.fx + Math.sin(angle) * f.rx);
      const hz = f.z + d * (Math.cos(angle) * f.fz + Math.sin(angle) * f.rz);
      v.path.project(hx, hz, v.s + d, this.hit);
      if (Math.abs(this.hit.lat) > LANE_HALF) continue;
      const gap = v.rays.dist[r] * Math.cos(angle) - FRONT_CLEARANCE;
      const closing = v.rays.car[r] ? v.rays.closing[r] : speed;
      if (closing <= 0.3) continue;
      need = Math.max(need, (closing * closing) / (2 * Math.max(0.3, gap)));
    }
    // Red light (or a yellow we can still stop for).
    if (v.stopDist < 80 && (v.light === 'red' || (v.light === 'yellow' && v.stopDist > (speed * speed) / (2 * SAFE_DECEL)))) {
      need = Math.max(need, (speed * speed) / (2 * Math.max(0.3, v.stopDist - 1)));
    }
    // The destination.
    const left = this.goal - v.s;
    const arrive = (speed * speed) / (2 * Math.max(0.3, left - 2));
    let handbrake = false;
    if (left < 60 && arrive > ARRIVE_DECEL * 0.6) {
      need = Math.max(need, arrive);
      if (left < 4) handbrake = true;
    }
    if (need > SAFE_DECEL * 0.6 || (left < 60 && arrive > ARRIVE_DECEL * 0.6)) {
      const brake = -Math.min(1, need / 9 + 0.1);
      if (brake < throttle) {
        throttle = brake;
        this.stats.shieldSteps++;
      }
    }
    this.controls.steer = v.action[0];
    this.controls.throttle = throttle;
    this.controls.handbrake = handbrake;
  }

  afterStep(): void {}
  render(): void {}
}
