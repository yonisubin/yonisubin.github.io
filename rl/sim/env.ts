import RAPIER from '@dimforge/rapier3d-compat';
import { CarDynamics, type CarTune } from '../../src/sim/carDynamics';
import { CAR_DIMENSIONS } from '../../src/vehicles/carDimensions';
import { observe, OBS_SIZE, RAYS } from '../../src/ai/observe';
import { DriverView, senseDriver } from '../../src/ai/driver';
import { randomRoute, type Path, type RouteOptions } from '../../src/ai/path';
import { Rng } from '../../src/ai/rng';
import { PHYSICS_DT, type SimWorld } from './world';

// A multi-car driving environment on the game's city. N learning cars share one Rapier world
// (and one policy): every decision gives N training samples, and from stage 5 the cars become
// each other's traffic. Rule-based cars (kinematic, IDM car-following, they stop at red lights)
// add traffic that doesn't learn.
//
// A decision every 4 physics steps (15 Hz at 60 Hz physics). Actions: steering and
// throttle/brake, both −1..1.

export const ACTION_REPEAT = 4;
export const DECISION_DT = ACTION_REPEAT * PHYSICS_DT;

export interface Stage {
  name: string;
  routeLength: [number, number];
  maxTurns: number;
  /** Chance that a slow or stopped car is put on the route ahead of the learner. */
  leaders: number;
  /** Rule-based cars wandering the neighbourhood. */
  traffic: number;
  /** Spawn every car within this radius of a shared hub, so they meet (0 = anywhere). */
  hubRadius: number;
  /** Running a red light ends the episode. */
  lights: boolean;
}

export const STAGES: Stage[] = [
  { name: '1 straight lanes', routeLength: [120, 220], maxTurns: 0, leaders: 0, traffic: 0, hubRadius: 0, lights: false },
  { name: '2 curves + single junctions', routeLength: [150, 300], maxTurns: 2, leaders: 0, traffic: 0, hubRadius: 0, lights: false },
  { name: '3 random city routes', routeLength: [250, 700], maxTurns: 10, leaders: 0, traffic: 0, hubRadius: 0, lights: false },
  { name: '4 stopped cars ahead', routeLength: [250, 700], maxTurns: 10, leaders: 0.6, traffic: 0, hubRadius: 0, lights: false },
  { name: '5 traffic', routeLength: [250, 700], maxTurns: 10, leaders: 0.4, traffic: 10, hubRadius: 220, lights: false },
  // Lights first without the crowd: with 16 learners around one lit junction, the ones still
  // running reds T-boned the ones that waited, so waiting didn't pay (see rl/README.md).
  { name: '6 traffic lights', routeLength: [250, 700], maxTurns: 10, leaders: 0.4, traffic: 0, hubRadius: 0, lights: true },
  { name: '7 traffic + lights', routeLength: [250, 700], maxTurns: 10, leaders: 0.4, traffic: 10, hubRadius: 220, lights: true },
];

/** Reward weights (per decision). See rl/README.md for why each is there. */
export const REWARD = {
  progress: 0.1, // per metre gained along the route
  speeding: 0.05, // per m/s over the road's limit
  lane: 0.02, // per metre from the lane centre
  steerChange: 0.06, // per unit change of the steering command (was 0.02: jittery steering)
  time: 0.01, // every decision
  idle: 0.05, // standing still with no reason to (no red light near, nothing in front)
  crash: 30,
  redApproach: 0.15, // per decision when too fast to stop for a red light ahead (scaled 0…1)
  tailgate: 0.15, // per decision at time-to-collision 0 with a car ahead (linear from TTC_SAFE)
  offroad: 20,
  redLight: 20,
  arrive: 10,
};

/** Per-car outcome flags written to `info` (INFO_SIZE floats per car). */
export const INFO_SIZE = 7;
export const enum Info {
  Success = 0,
  Crash = 1,
  Offroad = 2,
  RedLight = 3,
  Timeout = 4,
  /** Fraction of the route driven at the end. */
  Progress = 5,
  /** Episode length (decisions). */
  Length = 6,
}

/**
 * Leaving the road: the car's centre more than this beyond the kerb of the nearest road
 * (outer wheels well over it), or this far sideways from its route (took a wrong turn).
 * Judged by the road surface, not the lane: on narrow local streets a right turn is tighter
 * than the car's turning circle, and drivers swing wide into the other lane, as in reality.
 */
const KERB_MARGIN = 0.2;
const OFF_ROUTE = 6;
/** Held out of training: routes starting in the south-east of the city are only for evaluation. */
export const heldOut = (x: number, z: number) => x > 450 && z > 450;

export interface EnvOptions {
  cars: number;
  seed: number;
  stage: number;
  /** Randomise car mass / engine / grip and add sensor noise (training). */
  randomize: boolean;
  /** 'train' starts routes outside the held-out area, 'test' inside it, 'any' anywhere. */
  area: 'train' | 'test' | 'any';
}

export class Agent extends DriverView {
  car!: CarDynamics;
  /** Decisions since the episode started. */
  steps = 0;
  maxSteps = 900;
  /** Set during the physics steps when the car touches something. */
  hit = false;
  /** Last decision's reward (for debugging and the viewer). */
  lastReward = 0;
  colliders: number[] = [];
  /** Distance driven this episode, m. */
  driven = 0;
  episodeSeed = 0;
  /**
   * The light ahead turned yellow while this car could still stop comfortably: that yellow
   * counts as red (the rule drivers follow). Remembered per stop line.
   */
  amberStop = false;
  amberLine = -1;
  /** The light at the next stop line counts as red for this car. */
  get mustStop(): boolean {
    return this.light === 'red' || (this.light === 'yellow' && this.amberStop);
  }
}

/** A rule-based car on a route, moved kinematically. */
interface Bot {
  body: RAPIER.RigidBody;
  /** Its velocity in the ground plane, shared with SimWorld.kinematicVel for the radar. */
  vel: { x: number; z: number };
  collider: number;
  path: Path;
  s: number;
  v: number;
  /** Seconds left standing still (a "stalled" car ahead of a learner). */
  wait: number;
  v0: number;
  /** Learner this bot leads (it is removed when that learner's episode ends), or −1. */
  leads: number;
}

const tmpP = { x: 0, z: 0, tx: 0, tz: 0 };

export class DrivingEnv {
  readonly agents: Agent[] = [];
  readonly bots: Bot[] = [];
  readonly obs: Float32Array;
  readonly reward: Float32Array;
  readonly done: Uint8Array;
  readonly info: Float32Array;
  /** Observation at the end of an episode (before the auto-reset), for value bootstrapping. */
  readonly terminalObs: Float32Array;
  time = 0;
  stage: Stage;
  private readonly rng: Rng;
  private hub = { x: 0, z: 0, radius: 0 };
  private hubAge = 0;
  private readonly carColliders = new Map<number, number>(); // collider handle → agent index

  constructor(
    readonly sim: SimWorld,
    readonly opt: EnvOptions,
  ) {
    this.rng = new Rng(opt.seed);
    this.stage = STAGES[opt.stage];
    const n = opt.cars;
    this.obs = new Float32Array(n * OBS_SIZE);
    this.terminalObs = new Float32Array(n * OBS_SIZE);
    this.reward = new Float32Array(n);
    this.done = new Uint8Array(n);
    this.info = new Float32Array(n * INFO_SIZE);
    this.time = this.rng.range(0, 100);
    this.pickHub();
    for (let i = 0; i < n; i++) {
      this.agents.push(new Agent());
      this.spawn(i);
    }
    this.syncBots();
    for (let i = 0; i < n; i++) this.sense(i);
    for (let i = 0; i < n; i++) observe(this.agents[i], this.obs, i * OBS_SIZE);
  }

  setStage(stage: number): void {
    this.stage = STAGES[stage];
    this.pickHub();
  }

  /** Pin the meeting point (the viewer uses this to film one neighbourhood). */
  setHub(x: number, z: number, radius: number): void {
    this.hub = { x, z, radius };
    this.hubAge = -Infinity;
  }

  /** Called after every physics step (the viewer records poses for smooth video). */
  onPhysicsStep: (() => void) | null = null;

  private pickHub(): void {
    const r = this.stage.hubRadius;
    if (!r) {
      this.hub = { x: 0, z: 0, radius: 0 };
      return;
    }
    // Hubs at busy places: a lit junction (they're downtown and on arterials).
    const nodes = this.sim.litNodes
      .map((id) => this.sim.net.nodes[id])
      .filter((n) => (this.opt.area === 'any' ? true : this.opt.area === 'test' ? heldOut(n.x, n.z) : !heldOut(n.x, n.z)));
    const pool = nodes.length ? nodes : this.sim.net.nodes;
    const n = pool[this.rng.int(pool.length)];
    this.hub = { x: n.x, z: n.z, radius: r };
    this.hubAge = 0;
  }

  private routeOptions(): RouteOptions {
    const st = this.stage;
    const area = this.opt.area;
    return {
      length: this.rng.range(st.routeLength[0], st.routeLength[1]),
      maxTurns: st.maxTurns,
      startOk: area === 'any' ? undefined : area === 'test' ? heldOut : (x, z) => !heldOut(x, z),
      near: this.hub.radius ? this.hub : undefined,
    };
  }

  /** Nothing within `r` m of (x, z)? */
  private clear(x: number, z: number, r: number, skipAgent = -1): boolean {
    for (let i = 0; i < this.agents.length; i++) {
      if (i === skipAgent || !this.agents[i].car) continue;
      const t = this.agents[i].car.body.translation();
      if ((t.x - x) ** 2 + (t.z - z) ** 2 < r * r) return false;
    }
    for (const b of this.bots) {
      const t = b.body.translation();
      if ((t.x - x) ** 2 + (t.z - z) ** 2 < r * r) return false;
    }
    return true;
  }

  /** (Re)start learner i on a new random route. */
  spawn(i: number, seed?: number): void {
    const a = this.agents[i];
    const world = this.sim.world;
    if (a.car) {
      for (const h of a.colliders) this.carColliders.delete(h);
      for (const h of a.colliders) this.sim.kind.delete(h);
      a.car.dispose(world);
      // Its leader goes too.
      for (let k = this.bots.length - 1; k >= 0; k--) if (this.bots[k].leads === i) this.removeBot(k);
    }
    a.episodeSeed = seed ?? Math.floor(this.rng.next() * 2 ** 31);
    const rng = new Rng(a.episodeSeed);
    let route = randomRoute(this.sim.graph, rng, this.routeOptions());
    for (let tries = 0; tries < 30; tries++) {
      route.path.at(route.start, tmpP);
      if (this.clear(tmpP.x, tmpP.z, 12, i)) break;
      route = randomRoute(this.sim.graph, rng, this.routeOptions());
    }
    const { path, start } = route;
    path.at(start, tmpP);
    const yaw = Math.atan2(-tmpP.tz, tmpP.tx); // rotation about +Y taking +X onto the tangent
    const tune: CarTune = this.opt.randomize
      ? { mass: rng.range(0.9, 1.1), engine: rng.range(0.9, 1.1), grip: rng.range(0.85, 1.15) }
      : { mass: 1, engine: 1, grip: 1 };
    a.car = new CarDynamics(world, 'sedan', tmpP.x, this.sim.height(tmpP.x, tmpP.z), tmpP.z, yaw, tune);
    // Start rolling at a random fraction of the limit (not always from a standstill).
    const v0 = rng.range(0, 0.6) * path.limit[0];
    a.car.body.setLinvel({ x: tmpP.tx * v0, y: 0, z: tmpP.tz * v0 }, true);
    a.colliders = [];
    for (let c = 0; c < a.car.body.numColliders(); c++) {
      const h = a.car.body.collider(c).handle;
      a.colliders.push(h);
      this.carColliders.set(h, i);
      this.sim.kind.set(h, 1);
    }
    a.path = path;
    a.s = start;
    a.lat = 0;
    a.steps = 0;
    a.driven = 0;
    a.prevAction = [0, 0];
    a.action = [0, 0];
    a.hit = false;
    // Time limit: enough for the route at a careful pace (downtown is all right-angle turns
    // and lights), at most 2 minutes.
    a.maxSteps = Math.round(Math.min(120, 20 + (path.length - start) / 3.5) / DECISION_DT);
    // A stopped or slow car on the route ahead.
    if (this.stage.leaders > 0 && rng.next() < this.stage.leaders) {
      const ahead = start + rng.range(25, 70);
      if (ahead < path.length - 20) {
        const wait = rng.next() < 0.5 ? rng.range(2, 15) : 0;
        this.addBot(path, ahead, rng.range(0.4, 0.9) * path.limit[path.index(ahead)], wait, i);
      }
    }
  }

  private addBot(path: Path, s: number, v0: number, wait: number, leads: number): void {
    path.at(s, tmpP);
    const d = CAR_DIMENSIONS.sedan;
    const body = this.sim.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(tmpP.x, this.sim.height(tmpP.x, tmpP.z), tmpP.z),
    );
    const c = this.sim.world.createCollider(
      RAPIER.ColliderDesc.cuboid(...d.boxHalf).setTranslation(...d.boxCenter),
      body,
    );
    this.sim.kind.set(c.handle, 1);
    const vel = { x: 0, z: 0 };
    this.sim.kinematicVel.set(c.handle, vel);
    this.bots.push({ body, vel, collider: c.handle, path, s, v: wait > 0 ? 0 : v0, wait, v0, leads });
    this.placeBot(this.bots[this.bots.length - 1], true);
  }

  private removeBot(k: number): void {
    const b = this.bots[k];
    for (let c = 0; c < b.body.numColliders(); c++) this.sim.kind.delete(b.body.collider(c).handle);
    this.sim.kinematicVel.delete(b.collider);
    this.sim.world.removeRigidBody(b.body);
    this.bots.splice(k, 1);
  }

  /** Keep the number of wandering rule-based cars at the stage's count. */
  private syncBots(): void {
    let wandering = this.bots.filter((b) => b.leads < 0).length;
    for (let k = this.bots.length - 1; k >= 0 && wandering > this.stage.traffic; k--) {
      if (this.bots[k].leads < 0) {
        this.removeBot(k);
        wandering--;
      }
    }
    for (let tries = 0; wandering < this.stage.traffic && tries < 50; tries++) {
      const { path, start } = randomRoute(this.sim.graph, this.rng, { ...this.routeOptions(), length: 600, maxTurns: 12 });
      path.at(start, tmpP);
      if (!this.clear(tmpP.x, tmpP.z, 15)) continue;
      this.addBot(path, start, path.limit[0] * this.rng.range(0.7, 1.0), 0, -1);
      wandering++;
    }
  }

  private placeBot(b: Bot, snap: boolean): void {
    b.path.at(b.s, tmpP);
    b.vel.x = tmpP.tx * b.v;
    b.vel.z = tmpP.tz * b.v;
    const y = this.sim.height(tmpP.x, tmpP.z);
    const yaw = Math.atan2(-tmpP.tz, tmpP.tx);
    const rot = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    if (snap) {
      b.body.setTranslation({ x: tmpP.x, y, z: tmpP.z }, true);
      b.body.setRotation(rot, true);
    } else {
      b.body.setNextKinematicTranslation({ x: tmpP.x, y, z: tmpP.z });
      b.body.setNextKinematicRotation(rot);
    }
  }

  /**
   * Rule-based driving (Intelligent Driver Model): accelerate toward the desired speed, keep
   * a time gap to whatever is ahead in its lane, and stop at red lights.
   */
  private driveBot(b: Bot, dt: number): void {
    if (b.wait > 0) {
      b.wait -= dt;
      return;
    }
    const v0 = Math.min(b.v0, b.path.curveLimit(b.s, 25));
    b.path.at(b.s, tmpP);
    const hx = tmpP.tx;
    const hz = tmpP.tz;
    const bx = tmpP.x;
    const bz = tmpP.z;
    let gap = Infinity;
    let vLead = 0;
    const consider = (x: number, z: number, vx: number, vz: number) => {
      const dx = x - bx;
      const dz = z - bz;
      const ahead = dx * hx + dz * hz;
      const side = -dx * hz + dz * hx;
      if (ahead > 0.5 && ahead < 60 && Math.abs(side) < 2.2 && ahead - 4.6 < gap) {
        gap = ahead - 4.6;
        vLead = vx * hx + vz * hz;
      }
    };
    for (const a of this.agents) {
      const t = a.car.body.translation();
      const v = a.car.body.linvel();
      consider(t.x, t.z, v.x, v.z);
    }
    for (const o of this.bots) {
      if (o === b) continue;
      const t = o.body.translation();
      o.path.at(o.s, tmpP);
      consider(t.x, t.z, tmpP.tx * o.v, tmpP.tz * o.v);
    }
    // Red (or yellow, if it can still stop) light ahead: a standing "car" at the stop line.
    for (const st of b.path.stops) {
      const d = st.s - b.s;
      if (d < 0 || d > 80) continue;
      const light = this.sim.graph.lightState(st.lane, this.time);
      if (light === 'red' || (light === 'yellow' && d > (b.v * b.v) / 6)) {
        if (d - 1 < gap) {
          gap = Math.max(0.1, d - 1);
          vLead = 0;
        }
      }
      break;
    }
    const A = 2.0;
    const B = 3.0;
    const sStar = 2 + b.v * 1.3 + (b.v * (b.v - vLead)) / (2 * Math.sqrt(A * B));
    const acc = A * (1 - (b.v / Math.max(0.1, v0)) ** 4 - (gap === Infinity ? 0 : (Math.max(0, sStar) / Math.max(0.1, gap)) ** 2));
    b.v = Math.max(0, b.v + Math.max(-8, acc) * dt);
    b.s += b.v * dt;
  }

  /** Read learner i's state: pose, velocities, projection, rays, next light. */
  sense(i: number): void {
    const a = this.agents[i];
    senseDriver(a, a.car.body, a.car.steer, this.sim, this.sim.graph, this.time);
    // Amber: decide once, when it turns yellow (or when the line comes into view on yellow).
    const line = Math.round(a.s + a.stopDist);
    if (a.light !== 'yellow' || line !== a.amberLine) {
      if (a.light === 'yellow') {
        const v = Math.max(0, a.vFwd);
        a.amberStop = a.stopDist > (v * v) / (2 * 4) + 1;
        a.amberLine = line;
      } else {
        a.amberStop = false;
        a.amberLine = -1;
      }
    }
  }

  /**
   * Hit from behind by another car: not the learner's fault. (Counting it as a crash taught
   * the drivers that stopping at a red light gets you rear-ended, so they ran the lights.)
   */
  private rearEnded(a: Agent, other: RAPIER.Collider): boolean {
    if (!this.sim.isCar(other)) return false;
    const o = other.parent();
    if (!o) return false;
    const p = o.translation();
    const t = a.car.body.translation();
    const along = (p.x - t.x) * a.frame.fx + (p.z - t.z) * a.frame.fz;
    return along < -2.5;
  }

  /** A red (or yellow) light close ahead, or something right in front: fine to stand still. */
  reasonToWait(a: Agent): boolean {
    if (a.stopDist < 40 && a.light !== 'green') return true;
    const mid = (RAYS - 1) / 2;
    for (let r = mid - 2; r <= mid + 2; r++) if (a.rays.dist[r] < 12) return true;
    return false;
  }

  /** Apply one decision for every learner (actions: N × [steer, throttle]) and advance. */
  step(actions: ArrayLike<number>): void {
    const n = this.agents.length;
    const world = this.sim.world;
    for (let i = 0; i < n; i++) {
      const a = this.agents[i];
      a.action = [clamp1(actions[i * 2]), clamp1(actions[i * 2 + 1])];
      a.hit = false;
      // Rapier puts a body at rest to sleep, and engine force doesn't wake it (a car waiting
      // at a red light would never move off again).
      a.car.body.wakeUp();
    }
    const sBefore = this.agents.map((a) => a.s);
    // The light at each learner's next stop line, as it was before this decision.
    const lightsBefore = this.agents.map((a) => (a.stopDist < Infinity ? { s: a.s + a.stopDist, stop: a.mustStop } : null));
    for (let k = 0; k < ACTION_REPEAT; k++) {
      for (const a of this.agents) a.car.step({ driven: true, steer: a.action[0], throttle: a.action[1], handbrake: false }, PHYSICS_DT);
      for (const b of this.bots) {
        this.driveBot(b, PHYSICS_DT);
        if (b.s < b.path.length - 1) this.placeBot(b, false);
      }
      world.step();
      this.time += PHYSICS_DT;
      this.onPhysicsStep?.();
      // Anything touching a learner's body (another car, a building, the ground under the
      // chassis after a roll) is a crash.
      for (let i = 0; i < n; i++) {
        const a = this.agents[i];
        if (a.hit) continue;
        for (const h of a.colliders) {
          const col = world.getCollider(h);
          world.contactPairsWith(col, (other) => {
            if (a.hit) return;
            world.contactPair(col, other, (m) => {
              if (m.numContacts() > 0 && !this.rearEnded(a, other)) a.hit = true;
            });
          });
        }
      }
    }
    // Bots that reached the end of their route: wandering ones start a new one.
    for (let k = this.bots.length - 1; k >= 0; k--) {
      if (this.bots[k].s >= this.bots[k].path.length - 1) this.removeBot(k);
    }
    this.hubAge += DECISION_DT;
    if (this.hub.radius && this.hubAge > 120) this.pickHub();
    this.syncBots();

    const st = this.stage;
    for (let i = 0; i < n; i++) {
      const a = this.agents[i];
      this.sense(i);
      a.steps++;
      const ds = a.s - sBefore[i];
      a.driven += Math.max(0, ds);
      const limit = a.path.limit[a.path.index(a.s)];
      let r = REWARD.progress * ds;
      r -= REWARD.speeding * Math.max(0, a.vFwd - limit);
      r -= REWARD.lane * Math.abs(a.lat);
      r -= REWARD.steerChange * Math.abs(a.action[0] - a.prevAction[0]);
      r -= REWARD.time;
      if (a.vFwd < 1 && !this.reasonToWait(a)) r -= REWARD.idle;
      r -= REWARD.tailgate * tailgating(a);
      if (st.lights) r -= REWARD.redApproach * redApproach(a);
      const info = this.info;
      const o = i * INFO_SIZE;
      info.fill(0, o, o + INFO_SIZE);
      let done = false;
      const crashed = a.hit || a.frame.upY < 0.5;
      const road = this.sim.net.nearest(a.frame.x, a.frame.z, 30);
      const off =
        Math.abs(a.lat) > OFF_ROUTE || !road || road.dist > this.sim.net.halfWidth(this.sim.net.edges[road.edge]) + KERB_MARGIN;
      // Ran a red: crossed a stop line that was red the moment before.
      let ranRed = false;
      const lb = lightsBefore[i];
      if (lb && sBefore[i] <= lb.s && a.s > lb.s && lb.stop) ranRed = true;
      if (crashed) {
        r -= REWARD.crash;
        info[o + Info.Crash] = 1;
        done = true;
      } else if (off) {
        r -= REWARD.offroad;
        info[o + Info.Offroad] = 1;
        done = true;
      } else if (ranRed && st.lights) {
        r -= REWARD.redLight;
        info[o + Info.RedLight] = 1;
        done = true;
      } else if (a.s >= a.path.length - 4) {
        r += REWARD.arrive;
        info[o + Info.Success] = 1;
        done = true;
      } else if (a.steps >= a.maxSteps) {
        info[o + Info.Timeout] = 1;
        done = true;
      }
      a.prevAction = a.action;
      a.lastReward = r;
      this.reward[i] = r;
      this.done[i] = done ? 1 : 0;
      if (done) {
        info[o + Info.Progress] = Math.min(1, a.s / a.path.length);
        info[o + Info.Length] = a.steps;
        observe(a, this.terminalObs, i * OBS_SIZE);
        this.spawn(i);
        this.sense(i);
      }
    }
    for (let i = 0; i < n; i++) observe(this.agents[i], this.obs, i * OBS_SIZE);
    if (this.opt.randomize) {
      // Sensor noise.
      for (let k = 0; k < this.obs.length; k++) this.obs[k] += 0.01 * this.rng.gauss();
    }
  }
}

/** Time-to-collision margin with a car ahead (±26°), seconds; below it the driver is penalised. */
const TTC_SAFE = 2.5;

/** 0 (safe) … 1 (about to hit) from the time to collision with the closest car ahead. */
function tailgating(a: Agent): number {
  const mid = (RAYS - 1) / 2;
  let worst = 0;
  for (let r = mid - 2; r <= mid + 2; r++) {
    if (!a.rays.car[r] || a.rays.closing[r] <= 0.5) continue;
    const ttc = Math.max(0, a.rays.dist[r] - 2.5) / a.rays.closing[r];
    worst = Math.max(worst, (TTC_SAFE - ttc) / TTC_SAFE);
  }
  return worst;
}

/**
 * 0 … 1: how far a car is past the point where it could still stop comfortably (4 m/s²) for
 * a red light ahead — a dense warning before the large penalty for running it.
 */
function redApproach(a: Agent): number {
  if (!a.mustStop || a.stopDist > 80) return 0;
  const v = Math.max(0, a.vFwd);
  const excess = (v * v) / (2 * 4) - Math.max(0, a.stopDist - 2);
  return Math.max(0, Math.min(1, excess / 10));
}

function clamp1(v: number): number {
  return Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
}
