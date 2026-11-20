import * as THREE from 'three';
import { yawPitchQuaternion } from '../sim/pose';
import RAPIER from '@dimforge/rapier3d-compat';
import type { SimEntity } from '../sim/entity';
import type { Smoke } from '../sim/smoke';
import { Rng } from '../world/rng';
import type { CityLayout } from '../world/layout';
import type { Terrain } from '../world/terrain';
import { ROAD_SPECS } from '../world/streets';
import { LANE_OFFSET, LANE_SPACING, RoadGraph, pieceAt, turnKind, type Light, type Piece } from '../world/roadGraph';
import {
  CAR_DIMENSIONS,
  PAINT_COLORS,
  TAXI_YELLOW,
  carGeometry,
  carMaterials,
  paintMaterial,
  wheelGeometry,
  type CarType,
} from '../vehicles/carModel';
import { CarDynamics } from '../sim/carDynamics';
import type { Policy } from '../ai/policy';
import { DriverView, senseDriver } from '../ai/driver';
import { observe, OBS_SIZE, type RaySensors } from '../ai/observe';
import { gameSensors } from '../ai/sensors';
import { Path, projectOnPiece, shiftPiece } from '../ai/path';

// NPC traffic: cars that follow the street network, obey traffic lights and stop signs, and
// keep their distance.
//
// They aren't physics-driven: each car moves along its path at a speed it chooses, and its
// kinematic body is moved to match, so the player's car bumps into them like solid objects.
// A fixed pool of cars is kept around the player: cars that end up far away are
// respawned on a lane closer by. All traffic cars render through a handful of
// InstancedMeshes (one per car part per type).
//
// How they drive (cheap versions of the standard traffic-simulation models):
//
// - Car following: the Intelligent Driver Model (IDM, Treiber 2000). Each step a car's
//   acceleration is
//       a·[1 − (v/v0)⁴ − (s*/s)²],   s* = s0 + v·T + v·Δv / (2√(a·b))
//   where v0 is the speed it wants, s the gap to whatever is ahead, Δv how fast it's closing
//   on it, T the time gap it likes to keep, s0 the gap it stops at, a its comfortable
//   acceleration and b its comfortable braking. Red lights, stop lines and obstacles are
//   leaders that stand still.
// - Personality: every driver gets their own v0 (85–120 % of the limit, some dawdlers),
//   T, a, b and s0, so traffic spreads out, platoons form behind slow cars and fast ones
//   want to get past.
// - Lane changes (roads with two lanes each way): a simplified MOBIL rule. Change lane if
//   the acceleration you'd have there beats the current one by a threshold, and the car
//   that would be behind you there wouldn't have to brake hard. A bias keeps cars right
//   (pass on the left), and near the end of a block they move into the lane for their turn.
// - Overtaking (country roads, one lane each way): stuck behind something slower, a driver
//   pulls into the oncoming lane if the road ahead is clear for the whole manoeuvre, and
//   aborts if something appears.
// - Junctions: lights (two phases); stop signs on the smaller road (stop, then go when the
//   junction is clear and nothing is coming on the main road); left turns at lights wait for
//   oncoming traffic; U-turns round cul-de-sacs.
// - Routes: cars wander, preferring bigger roads and going straight on, so cul-de-sacs
//   see only the odd car.
// - Curves: a speed limit √(a_lat/κ) from the curvature of the road (precomputed per piece),
//   braked for in advance.
//
// Cost: decisions about lanes run a couple of times a second per car (staggered), the
// per-step work is IDM plus a scan over the other ~28 cars, and pieces are shared objects
// so "same lane?" is an identity check.
//
// AI drivers (src/ai, trained with reinforcement learning in rl/): once a policy is loaded
// (setPolicy), cars near the player are real physics cars — the same ray-cast vehicle the
// player drives (sim/carDynamics.ts) — and the trained network steers and works the pedals,
// 15 decisions a second, from what it sees: its route ahead, 15 sensor rays with a radar-like
// closing speed, the next traffic light. Everything above still runs as the planner (which
// way to turn, which lane, overtaking) and as a safety layer: if the rules want to brake
// harder than the network (a stop sign, a car crossing the junction, the player on foot), the
// rule's braking wins. Far from the player, where nobody can see the difference, or where the
// ground isn't loaded, or if the network loses its way, a car falls back to the kinematic
// driving above.

const POOL_SIZE = 28;
const SPAWN_MIN = 60; // m from the player (closer spawns would pop in visibly)
const SPAWN_MAX = 220;
const DESPAWN = 260;
const STOP_LINE_BACK = 1.0; // m before the end of a lane (the paint is just before the junction)
const SAME_LANE = 2.4; // m: cars whose lateral offsets differ by less than this share a lane
const LANE_CHANGE_SPEED = 1.5; // m/s sideways at most
const LOOKAHEAD = 90; // m of road ahead considered for curves and leaders
/** AI (physics) driving within this distance of the player, m; kinematic beyond. */
export const AI_RADIUS = 130;
const AI_HYSTERESIS = 20; // m, so cars at the edge don't flip between modes
const AI_DECISION_STEPS = 4; // physics steps per decision (15 Hz at 60 Hz, as trained)
/** The rules' braking overrides the network beyond this deceleration, m/s². */
const SHIELD_DECEL = 0.8;
const BRAKE_DECEL = 9; // m/s² at full brake (sim/carDynamics.ts): converts the rules' braking to a pedal
const TYPES: CarType[] = ['sedan', 'sedan', 'sedan', 'taxi', 'sedan', 'van'];
// Gunfire damage. Cars have more health than people; a wreck stays put for a while.
const CAR_HEALTH = 150;
const WRECK_TIME = 20; // s before a wreck is cleared away
// Wrecks swap their glossy paint body for a matte, burnt one (glossy black paint would
// still reflect the sky and read as silver).
const charredMaterial = new THREE.MeshStandardMaterial({ color: 0x161514, roughness: 1, metalness: 0 });
// Lit brake lights: drawn over the tail lights while braking (unlit, so they glow at night).
const brakeMaterial = new THREE.MeshBasicMaterial({
  color: 0xff2414,
  toneMapped: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});

/** One driver's habits (IDM parameters). */
interface Driver {
  /** Fraction of the speed limit they like to drive at. */
  pace: number;
  /** Time gap to the car ahead, s. */
  T: number;
  /** Comfortable acceleration and braking, m/s². */
  a: number;
  b: number;
  /** Gap when stopped, m. */
  s0: number;
}

export interface TrafficCar {
  type: CarType;
  color: number;
  slot: number; // instance index within its type's meshes
  body: RAPIER.RigidBody;
  piece: Piece;
  /** Distance travelled along the current piece, m. */
  s: number;
  speed: number;
  /** Acceleration chosen this step, m/s². */
  acc: number;
  /** Sideways offset from the piece's line, m (+ = right), where the car wants it, and its rate. */
  lat: number;
  latTarget: number;
  latVel: number;
  /** The lane it'll take at the end of the lane it's on (or the lane it's about to join). */
  exit: Piece;
  driver: Driver;
  /** Cache for plannedTurn(). */
  planned: { lane: Piece | null; exit: Piece | null; offIn: number; turn: Piece | null };
  /** The stop-sign junction it has already come to a stop at. */
  stoppedAt: number;
  /** Seconds until the next lane decision. */
  decideIn: number;
  /** Overtaking on a country road: what it's passing, how long it has been at it. */
  passing: THREE.Vector3 | null;
  passTime: number;
  wheelSpin: number;
  halfLength: number;
  prevPos: THREE.Vector3;
  currPos: THREE.Vector3;
  prevYaw: number;
  currYaw: number;
  /** Nose-up angle (rad) from the slope of the road. */
  currPitch: number;
  active: boolean;
  health: number;
  /** Seconds since it was wrecked, or −1 while it's still running. */
  wrecked: number;
  smokeTimer: number;
  /** A mission target: never recycled for being far from the player. */
  pinned: boolean;
  /** Counts respawns of this slot, so a mission can tell its car was replaced (carjacked). */
  serial: number;
  /** Physics (also the kinematic body: switched between the two body types). */
  dyn: CarDynamics;
  /** Driven by the AI policy as a physics car right now (else kinematic). */
  physics: boolean;
  /** The AI driver's view and its current route line. */
  ai: DriverView;
  aiPathKey: string;
  /** Seconds stuck (stopped while the rules say go), and AI disabled until this time. */
  aiStuck: number;
  aiBlockedUntil: number;
  /** Body orientation (physics cars roll and pitch; kinematic ones are set from yaw/pitch). */
  prevQuat: THREE.Quaternion;
  currQuat: THREE.Quaternion;
  /** Index in the pool (staggers decisions). */
  index: number;
}

/** Things traffic must not drive into: the player (any mode), parked player cars, etc. */
export type ObstacleSource = () => THREE.Vector3[];

/** What's ahead of a car in one lane: bumper-to-bumper gap (m) and its speed (m/s). */
interface Leader {
  gap: number;
  speed: number;
  /** The car, when it's a traffic car (not a light, junction or obstacle). */
  car: TrafficCar | null;
}

/** A piece of the road ahead and the lateral offset the car will have on it. */
interface RouteStep {
  piece: Piece;
  lat: number;
  /** Distance from the car to the start of this piece (≤ 0 for the current one). */
  start: number;
}

export class Traffic implements SimEntity {
  private readonly graph: RoadGraph;
  private readonly cars: TrafficCar[] = [];
  private readonly rng = new Rng(4242);
  private readonly meshes = new Map<CarType, THREE.InstancedMesh[]>();
  /** Burnt body per type, shown instead of the painted one for wrecks. */
  private readonly wreckBodies = new Map<CarType, THREE.InstancedMesh>();
  /** Lit brake lights per type. */
  private readonly brakeLights = new Map<CarType, THREE.InstancedMesh>();
  private readonly tyres: THREE.InstancedMesh;
  private readonly rims: THREE.InstancedMesh;
  private readonly lights: TrafficLights;
  private time = 0;
  private lightTimer = 0;
  /** Counters for tests and the debug overlay. */
  readonly stats = {
    laneChanges: 0,
    passStarted: 0,
    passCompleted: 0,
    passAborted: 0,
    /** AI: physics steps driven, of which the rules' braking overrode the network. */
    aiSteps: 0,
    aiShieldSteps: 0,
    /** AI: decisions taken, time spent on them (ms), and hand-backs to kinematic driving. */
    aiDecisions: 0,
    aiMs: 0,
    aiFallbacks: 0,
  };
  /** The trained driving policy (null: every car drives kinematically). */
  private policy: Policy | null = null;
  /** Is there ground (a loaded collider) under (x, z)? Set by the game. */
  groundLoaded: (x: number, z: number) => boolean = () => false;
  /** Turn AI driving off (e.g. for comparisons); cars then drive kinematically. */
  aiEnabled = true;
  private steps = 0;
  /** The clock the traffic lights run on, s. */
  get clock(): number {
    return this.time;
  }
  private readonly obs = new Float32Array(OBS_SIZE);
  private readonly act = new Float32Array(2);
  private readonly sensors: RaySensors;
  private readonly pieceIds = new WeakMap<Piece, number>();
  private nextPieceId = 1;
  private obstacleList: THREE.Vector3[] = [];

  // Scratch.
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly mat = new THREE.Matrix4();
  // Scratch matrices for the wheels (reused every frame).
  private readonly carMat = new THREE.Matrix4();
  private readonly local = new THREE.Matrix4();
  private readonly spin = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly at = { x: 0, z: 0, tx: 0, tz: 0 };
  private readonly route: RouteStep[] = [0, 1, 2].map(() => ({ piece: null as unknown as Piece, lat: 0, start: 0 }));
  private routeLength = 0;
  private readonly opposing: { rev: Piece; end: number; lat: number }[] = [];
  /** Smoke puffs for damaged cars (set by the game). */
  smoke: Smoke | null = null;
  /** Called when gunfire wrecks a car (drop cash, scare people…). */
  onWreck: ((position: THREE.Vector3) => void) | null = null;

  constructor(
    world: RAPIER.World,
    scene: THREE.Scene,
    layout: CityLayout,
    /** Road heights: traffic follows the ground over the hills. */
    private readonly terrain: Terrain,
    /** Where the player is (cars spawn and despawn around this point). */
    private readonly playerPosition: () => THREE.Vector3,
    private readonly obstacles: ObstacleSource,
  ) {
    this.graph = new RoadGraph(layout.streets.net);
    this.lights = new TrafficLights(scene, world, this.graph, terrain);
    this.sensors = gameSensors(world);

    // Instanced meshes per car type and part.
    const counts = new Map<CarType, number>();
    const slots: { type: CarType; slot: number }[] = [];
    for (let k = 0; k < POOL_SIZE; k++) {
      const type = TYPES[k % TYPES.length];
      const slot = counts.get(type) ?? 0;
      counts.set(type, slot + 1);
      slots.push({ type, slot });
    }
    for (const [type, count] of counts) {
      const g = carGeometry(type);
      const paint = paintMaterial(0xffffff); // per-instance colour multiplies this
      const parts: [THREE.BufferGeometry, THREE.Material][] = [
        [g.body, paint],
        [g.glass, carMaterials.glass],
        [g.trim, carMaterials.trim],
        [g.headlights, carMaterials.headlight],
        [g.taillights, carMaterials.taillight],
      ];
      if (g.sign) parts.push([g.sign, carMaterials.sign]);
      const list = parts.map(([geo, mat], index) => {
        const m = new THREE.InstancedMesh(geo, mat, count);
        m.castShadow = index < 2; // body and glass only; small parts aren't worth a shadow pass
        m.receiveShadow = true;
        m.frustumCulled = false; // instances move every frame; bounds would go stale
        scene.add(m);
        return m;
      });
      this.meshes.set(type, list);
      const wreck = new THREE.InstancedMesh(g.body, charredMaterial, count);
      wreck.castShadow = true;
      wreck.frustumCulled = false;
      scene.add(wreck);
      this.wreckBodies.set(type, wreck);
      const brake = new THREE.InstancedMesh(g.taillights, brakeMaterial, count);
      brake.frustumCulled = false;
      scene.add(brake);
      this.brakeLights.set(type, brake);
    }
    const wheel = wheelGeometry(1); // unit radius, scaled per car type
    this.tyres = new THREE.InstancedMesh(wheel.tyre, carMaterials.tyre, POOL_SIZE * 4);
    this.rims = new THREE.InstancedMesh(wheel.rim, carMaterials.rim, POOL_SIZE * 4);
    for (const m of [this.tyres, this.rims]) {
      m.frustumCulled = false;
      scene.add(m);
    }

    const placeholder = this.graph.lane(0, 1);
    slots.forEach(({ type, slot }, index) => {
      const d = CAR_DIMENSIONS[type];
      // A full physics car, kinematic until the AI drives it.
      const dyn = new CarDynamics(world, type, 0, -100, 0, 0);
      const body = dyn.body;
      body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, false);
      const color = type === 'taxi' ? TAXI_YELLOW : PAINT_COLORS[this.rng.int(0, PAINT_COLORS.length - 1)];
      this.meshes.get(type)![0].setColorAt(slot, new THREE.Color(color));
      this.cars.push({
        type,
        color,
        slot,
        body,
        piece: placeholder, // until respawn
        s: 0,
        speed: 0,
        acc: 0,
        lat: 0,
        latTarget: 0,
        latVel: 0,
        exit: placeholder,
        driver: this.newDriver(type),
        planned: { lane: null, exit: null, offIn: 0, turn: null },
        stoppedAt: -1,
        decideIn: this.rng.range(0, 0.5),
        passing: null,
        passTime: 0,
        wheelSpin: 0,
        health: CAR_HEALTH,
        wrecked: -1,
        smokeTimer: 0,
        pinned: false,
        serial: 0,
        halfLength: d.length / 2,
        prevPos: new THREE.Vector3(),
        currPos: new THREE.Vector3(),
        prevYaw: 0,
        currYaw: 0,
        currPitch: 0,
        active: false,
        dyn,
        physics: false,
        ai: new DriverView(),
        aiPathKey: '',
        aiStuck: 0,
        aiBlockedUntil: 0,
        prevQuat: new THREE.Quaternion(),
        currQuat: new THREE.Quaternion(),
        index,
      });
    });
    // Fill the pool straight away (closer than usual is fine before the first frame).
    for (const car of this.cars) this.respawn(car, 25);
  }

  /** A new driver's habits: most near the limit, a few dawdlers and a few in a hurry. */
  private newDriver(type: CarType): Driver {
    const r = this.rng;
    // Average of two uniforms: a triangular spread centred on ~1.0.
    let pace = (r.range(0.85, 1.2) + r.range(0.85, 1.2)) / 2;
    if (r.chance(0.12)) pace = r.range(0.68, 0.8); // a dawdler: everyone wants past them
    if (type === 'van') pace *= 0.93;
    return {
      pace,
      T: r.range(1.0, 2.0),
      a: type === 'van' ? r.range(1.0, 1.6) : r.range(1.3, 2.6),
      b: r.range(2.2, 3.4),
      s0: r.range(1.6, 2.8),
    };
  }

  /** Put a car on a random free lane within spawning distance of the player. */
  private respawn(car: TrafficCar, minDist = SPAWN_MIN): void {
    const player = this.playerPosition();
    // A new car in this slot: not anyone's mission target any more.
    car.pinned = false;
    if (car.physics) this.setPhysics(car, false);
    car.serial++;
    const net = this.graph.net;
    // Roads near the player, weighted toward the busier ones.
    const candidates: number[] = [];
    net.index.forEachNear(player.x, player.z, SPAWN_MAX, (e) => {
      const cls = net.edges[e].cls;
      const w = cls === 'local' ? 1 : cls === 'collector' ? 3 : 5;
      for (let k = 0; k < w; k++) candidates.push(e);
    });
    for (let attempt = 0; attempt < 40 && candidates.length; attempt++) {
      const e = candidates[this.rng.int(0, candidates.length - 1)];
      const lane = this.graph.lane(e, this.rng.chance(0.5) ? 1 : -1);
      if (lane.length < 20) continue;
      const s = this.rng.range(4, lane.length - 12);
      const p = pieceAt(lane, s, this.at);
      const dist = Math.hypot(p.x - player.x, p.z - player.z);
      if (dist < minDist || dist > SPAWN_MAX) continue;
      const px = p.x;
      const pz = p.z;
      if (this.cars.some((o) => o !== car && o.active && Math.hypot(o.currPos.x - px, o.currPos.z - pz) < 15)) continue;
      car.piece = lane;
      car.s = s;
      car.driver = this.newDriver(car.type);
      // Multi-lane roads: mostly the right-hand (outer) lane.
      car.lat = car.latTarget = lane.lanes > 1 && this.rng.chance(0.65) ? LANE_SPACING : 0;
      car.latVel = 0;
      car.passing = null;
      car.stoppedAt = -1;
      car.exit = this.chooseExit(lane);
      car.speed = this.desiredSpeed(car, lane) * 0.7;
      car.acc = 0;
      car.active = true;
      car.health = CAR_HEALTH;
      car.wrecked = -1;
      this.place(car);
      car.prevPos.copy(car.currPos);
      car.prevYaw = car.currYaw;
      yawPitchQuaternion(car.currYaw, car.currPitch, car.currQuat);
      car.prevQuat.copy(car.currQuat);
      car.body.setTranslation(car.currPos, true);
      car.body.setRotation(car.currQuat, true);
      car.body.setEnabled(true);
      return;
    }
    // Nowhere suitable right now: park it out of the way until next time.
    car.active = false;
    car.body.setEnabled(false);
  }

  /**
   * Where to go at the end of a lane: mostly straight on, rather onto a road at least as
   * big as this one; side streets and cul-de-sacs only now and then.
   */
  private chooseExit(lane: Piece): Piece {
    const exits = this.graph.exits(lane);
    if (exits.length === 1) return exits[0];
    let total = 0;
    const weights = exits.map((x) => {
      const kind = turnKind(lane.endDir, x.startDir);
      let w = kind === 'straight' ? 3 : kind === 'uturn' ? 0.05 : 1;
      if (x.rank < lane.rank) w *= 0.35;
      if (x.rank > lane.rank) w *= 1.6;
      total += w;
      return w;
    });
    let r = this.rng.float() * total;
    for (let i = 0; i < exits.length; i++) {
      r -= weights[i];
      if (r <= 0) return exits[i];
    }
    return exits[exits.length - 1];
  }

  /** The speed limit on a piece times this driver's pace. */
  private desiredSpeed(car: TrafficCar, piece: Piece): number {
    return piece.speed * car.driver.pace;
  }

  /**
   * Lane offset after the turn at the end of a lane: right turns into the right-hand lane,
   * left turns into the left-hand one, straight on stays put; one-lane roads have one.
   */
  private exitOffset(lane: Piece, next: Piece, offIn: number): number {
    const kind = turnKind(lane.endDir, next.startDir);
    if (next.lanes < 2) return kind === 'straight' && offIn < 0 && next.rural ? offIn : 0;
    if (kind === 'right' || kind === 'uturn') return LANE_SPACING;
    if (kind === 'left') return 0;
    return Math.max(0, offIn);
  }

  /** The turn a car on a lane will take at its end, from the lane it's aiming for. */
  private plannedTurn(car: TrafficCar, lane: Piece, offIn = car.latTarget, exit = car.exit): Piece {
    const c = car.planned;
    // Cached while the lane, exit and target lane stay the same (most steps).
    if (c.turn && c.lane === lane && c.exit === exit && c.offIn === offIn) return c.turn;
    c.lane = lane;
    c.exit = exit;
    c.offIn = offIn;
    // A two-lane road's outer lane exists only where it has two lanes.
    const off = lane.lanes > 1 || offIn < 0 ? offIn : 0;
    c.turn = this.graph.turn(lane, exit, off, this.exitOffset(lane, exit, off));
    return c.turn;
  }

  /** The next two or three pieces ahead and the lateral offset the car will have on each. */
  private buildRoute(car: TrafficCar): void {
    const r = this.route;
    const p = car.piece;
    r[0].piece = p;
    r[0].lat = car.latTarget;
    r[0].start = -car.s;
    if (p.kind === 'lane') {
      const turn = this.plannedTurn(car, p);
      r[1].piece = turn;
      r[1].lat = 0;
      r[1].start = p.length - car.s;
      r[2].piece = turn.to!;
      r[2].lat = turn.offOut;
      r[2].start = r[1].start + turn.length;
    } else {
      const lane = p.to!;
      r[1].piece = lane;
      r[1].lat = p.offOut;
      r[1].start = p.length - car.s;
      // The car has already picked its exit for that lane; it'll arrive in lane offOut.
      const nextTurn = this.graph.turn(lane, car.exit, lane.lanes > 1 || p.offOut < 0 ? p.offOut : 0, this.exitOffset(lane, car.exit, p.offOut));
      r[2].piece = nextTurn;
      r[2].lat = 0;
      r[2].start = r[1].start + lane.length;
    }
    this.routeLength = 3;
    // A U-turn ahead (a dead end, a cul-de-sac): the lane after it is the reverse of ours,
    // whose cars are oncoming, not leaders. Stop the route at the turn.
    if (p.kind === 'lane' && r[2].piece === this.graph.reverse(p)) this.routeLength = 2;
  }

  /** Update the car's world position, heading and pitch from its piece, distance and offset. */
  private place(car: TrafficCar): void {
    const piece = car.piece;
    // Two points 1.5 m ahead and behind along the path, shifted sideways by the offset:
    // the midpoint is the car, the line between them its heading, the road heights there
    // its pitch.
    const a = pieceAt(piece, car.s + 1.5, this.at);
    let ax = a.x - a.tz * car.lat;
    let az = a.z + a.tx * car.lat;
    // Past the ends of the piece, extrapolate along its end direction.
    const over = car.s + 1.5 - piece.length;
    if (over > 0) {
      ax += a.tx * over;
      az += a.tz * over;
    }
    const b = pieceAt(piece, car.s - 1.5, this.at);
    let bx = b.x - b.tz * car.lat;
    let bz = b.z + b.tx * car.lat;
    const under = car.s - 1.5;
    if (under < 0) {
      bx += b.tx * under;
      bz += b.tz * under;
    }
    const ha = this.terrain.smoothHeight(ax, az);
    const hb = this.terrain.smoothHeight(bx, bz);
    car.currPos.set((ax + bx) / 2, (ha + hb) / 2, (az + bz) / 2);
    // Model forward is +X; yaw from the world direction, nosed toward the side it's
    // drifting to while changing lanes.
    car.currYaw = Math.atan2(-(az - bz), ax - bx) - Math.atan2(car.latVel, Math.max(car.speed, 2));
    car.currPitch = Math.atan2(ha - hb, Math.hypot(ax - bx, az - bz));
  }

  /** IDM acceleration for this driver at speed v wanting v0, with a leader `gap` m ahead closing at dv. */
  private idm(d: Driver, v: number, v0: number, gap: number, dv: number): number {
    const free = 1 - Math.pow(v / Math.max(v0, 0.1), 4);
    if (!Number.isFinite(gap)) return d.a * free;
    const sStar = d.s0 + Math.max(0, v * d.T + (v * dv) / (2 * Math.sqrt(d.a * d.b)));
    const inter = sStar / Math.max(gap, 0.1);
    return Math.max(-9, d.a * (free - inter * inter));
  }

  /**
   * Nearest thing ahead in the lane at lateral offset `lat` (on the current piece): traffic
   * cars along the route (same shared piece objects and a similar offset), oncoming cars
   * coming at it in that lane, other cars close in front (crossing a junction), and
   * obstacles (the player, their cars).
   */
  private leader(car: TrafficCar, lat: number, routeAhead: boolean): Leader {
    const best: Leader = { gap: Infinity, speed: 0, car: null };
    const r = this.route;
    const n = routeAhead ? this.routeLength : 1;
    const fwdX = Math.cos(car.currYaw);
    const fwdZ = -Math.sin(car.currYaw);
    const shift = lat - car.lat; // where that lane is relative to the car, sideways
    // Lanes ahead on our route (straight on) whose reverse carries oncoming traffic, with
    // the distance to their far end and our offset on them.
    const opp = this.opposing;
    opp.length = 0;
    for (let k = 0; k < this.routeLength; k++) {
      const step = r[k];
      if (step.piece.kind !== 'lane') continue;
      const prev = k > 0 ? r[k - 1].piece : null;
      if (prev && prev.kind === 'turn' && turnKind(prev.from!.endDir, prev.to!.startDir) !== 'straight') break;
      opp.push({ rev: this.graph.reverse(step.piece), end: step.start + step.piece.length, lat: k === 0 ? lat : step.lat });
    }
    for (const o of this.cars) {
      if (o === car || !o.active) continue;
      const halfs = car.halfLength + o.halfLength;
      let gap = Infinity;
      let matched = false;
      // Along the route, in the same lane.
      for (let k = 0; k < n; k++) {
        if (o.piece !== r[k].piece) continue;
        matched = true;
        const want = k === 0 ? lat : r[k].lat;
        if (Math.abs(o.lat - want) >= SAME_LANE) break;
        const ahead = r[k].start + o.s;
        if (ahead > 0) gap = ahead - halfs;
        break;
      }
      const facing = matched ? undefined : opp.find((q) => q.rev === o.piece);
      if (facing) {
        // Coming the other way in this lane (an overtaker, or us overtaking): both cars
        // close the gap, so treat it as a stopped car halfway. My offset from the centre
        // line is LANE_OFFSET + lat; theirs, seen from my side, is −(LANE_OFFSET + o.lat).
        if (Math.abs(facing.lat + o.lat + 2 * LANE_OFFSET) < SAME_LANE) {
          const ahead = facing.end - o.s;
          if (ahead > 0 && (ahead - halfs) / 2 < best.gap) {
            best.gap = (ahead - halfs) / 2;
            best.speed = 0;
            best.car = null;
          }
        }
        continue;
      }
      if (!matched) {
        // Not on our route: only if it's right in front (e.g. crossing the junction).
        const rx = o.currPos.x - car.currPos.x;
        const rz = o.currPos.z - car.currPos.z;
        const along = rx * fwdX + rz * fwdZ;
        // Coming straight at us in our lane, wherever it is on the network (an overtaker
        // round a bend, say): measured along our own path so curves don't fool it.
        if (along > 0 && along < 40 && Math.cos(o.currYaw - car.currYaw) < -0.5) {
          const side = this.sideOffset(car, along, o.currPos) - shift;
          if (Math.abs(side) < 1.8 && (along - halfs) / 2 < best.gap) {
            best.gap = (along - halfs) / 2;
            best.speed = 0;
            best.car = null;
          }
          continue;
        }
        if (along > 0 && along < 14) {
          const side = rx * -fwdZ + rz * fwdX - shift; // + = right of the lane's line
          const sameWay = Math.cos(o.currYaw - car.currYaw) > 0.5;
          if ((sameWay && Math.abs(side) < 1.6) || (along < 8 && Math.abs(side) < 1.4)) gap = along - halfs;
        }
      }
      if (gap < best.gap) {
        best.gap = gap;
        best.speed = Math.cos(o.currYaw - car.currYaw) > 0 ? o.speed : 0;
        best.car = o;
      }
    }
    // Obstacles: compare with where the lane will be at that distance (it may curve).
    for (const p of this.obstacleList) {
      const rx = p.x - car.currPos.x;
      const rz = p.z - car.currPos.z;
      if (rx * rx + rz * rz > 34 * 34) continue;
      const along = rx * fwdX + rz * fwdZ;
      if (along <= 0) continue;
      const side = this.sideOffset(car, along, p) - shift;
      if (Math.abs(side) < 1.7 && along - car.halfLength - 1 < best.gap) {
        best.gap = along - car.halfLength - 1;
        best.speed = 0;
        best.car = null;
      }
    }
    return best;
  }

  /**
   * How far right of the car's own path (m) a world point is, measured where the path is
   * `along` m ahead (follows the current piece, then straight on past its end).
   */
  private sideOffset(car: TrafficCar, along: number, p: THREE.Vector3): number {
    const piece = car.piece;
    const s = car.s + along;
    const q = pieceAt(piece, s, this.at);
    const extra = Math.max(0, s - piece.length);
    const qx = q.x + q.tx * extra - q.tz * car.lat;
    const qz = q.z + q.tz * extra + q.tx * car.lat;
    return (p.x - qx) * -q.tz + (p.z - qz) * q.tx;
  }

  /** Highest speed from which the car can still brake to every curve limit ahead. */
  private curveSpeed(car: TrafficCar): number {
    let v = Infinity;
    const b = car.driver.b * 0.8;
    for (let k = 0; k < this.routeLength; k++) {
      const { piece, start } = this.route[k];
      if (start > LOOKAHEAD) break;
      const lim = piece.limits;
      const step = piece.limitStep;
      for (let i = 0; i < lim.length; i++) {
        const dist = start + i * step;
        if (dist < -step) continue;
        if (dist > LOOKAHEAD) break;
        // v² = v_lim² + 2·b·d: the speed that brakes down to v_lim in d metres.
        v = Math.min(v, Math.sqrt(lim[i] * lim[i] + 2 * b * Math.max(0, dist)));
      }
    }
    return v;
  }

  /**
   * Stop lines that apply now: a red (or stoppable yellow) light, a stop sign (stop, then go
   * when clear), a left turn across oncoming traffic. Gap from the front bumper (m), or Infinity.
   */
  private stopGap(car: TrafficCar): number {
    const p = car.piece;
    if (p.kind !== 'lane') return Infinity;
    const toLine = p.length - car.s - car.halfLength - STOP_LINE_BACK;
    if (toLine > LOOKAHEAD || toLine < -1.5) return Infinity;
    // Whatever the rules, don't drive into a car that's crossing our path in the junction.
    if (toLine < 12 && this.crossingInJunction(car, p)) return Math.max(0, toLine);
    if (this.graph.hasLights(p.node)) {
      const light = this.graph.lightState(p, this.time);
      if (light === 'red') return Math.max(0, toLine);
      if (light === 'yellow') {
        // Stop if it can comfortably; otherwise go through.
        return toLine > (car.speed * car.speed) / (2 * car.driver.b) ? Math.max(0, toLine) : Infinity;
      }
      // Green: a left turn waits (at the line) for oncoming cars going straight or right.
      if (turnKind(p.endDir, car.exit.startDir) === 'left' && toLine < 25 && this.oncomingConflict(car, p)) return Math.max(0, toLine);
      return Infinity;
    }
    if (this.graph.mustStop(p)) {
      // Come to a full stop at the line first; then wait while it isn't clear.
      if (car.stoppedAt !== p.node) {
        if (toLine < 1.5 && car.speed < 0.4) car.stoppedAt = p.node;
        else return Math.max(0, toLine);
      }
      if (this.junctionBusy(car, p) || this.crossTraffic(car, p)) return Math.max(0, toLine);
    }
    return Infinity;
  }

  /**
   * A car in the junction at the end of `lane` whose path crosses ours: from another approach,
   * except oncoming traffic going straight on or turning right (it stays on its side).
   */
  private crossingInJunction(car: TrafficCar, lane: Piece): boolean {
    const myKind = turnKind(lane.endDir, car.exit.startDir);
    for (const o of this.cars) {
      if (o === car || !o.active || o.piece.kind !== 'turn' || o.piece.node !== lane.node) continue;
      const from = o.piece.from!;
      if (from === lane) continue;
      const opposite = from.endDir[0] * lane.endDir[0] + from.endDir[1] * lane.endDir[1] < -0.7;
      const theirs = turnKind(from.endDir, o.piece.to!.startDir);
      if (opposite && theirs !== 'left' && myKind !== 'left') continue;
      // Nearly through already: it'll be gone by the time we get there.
      if (o.s > o.piece.length - 3) continue;
      return true;
    }
    return false;
  }

  /** Is another car crossing the junction at the end of `lane` from a different approach? */
  private junctionBusy(car: TrafficCar, lane: Piece): boolean {
    for (const o of this.cars) {
      if (o === car || !o.active || o.piece.kind !== 'turn') continue;
      if (o.piece.node === lane.node && o.piece.from !== lane) return true;
    }
    return false;
  }

  /** Cars coming on the bigger road(s) at a stop-sign junction, close enough to matter. */
  private crossTraffic(car: TrafficCar, lane: Piece): boolean {
    for (const appr of this.graph.approaches(lane)) {
      if (appr.rank <= lane.rank && !this.graph.mustStop(lane)) continue;
      if (this.graph.mustStop(appr)) continue; // they stop too
      for (const o of this.cars) {
        if (o === car || !o.active || o.piece !== appr || o.wrecked >= 0) continue;
        const rem = appr.length - o.s;
        // Coming within ~4 s, or right at the junction.
        if (rem < o.speed * 4 + 6) return true;
      }
    }
    return false;
  }

  /** Oncoming traffic a left turn at the end of `lane` must wait for. */
  private oncomingConflict(car: TrafficCar, lane: Piece): boolean {
    for (const appr of this.graph.approaches(lane)) {
      // Oncoming: arriving head-on (roughly opposite direction).
      if (appr.endDir[0] * lane.endDir[0] + appr.endDir[1] * lane.endDir[1] > -0.7) continue;
      for (const o of this.cars) {
        if (o === car || !o.active || o.wrecked >= 0) continue;
        if (o.piece === appr) {
          if (turnKind(appr.endDir, o.exit.startDir) === 'left') continue; // two left turns pass in front of each other
          const rem = appr.length - o.s;
          if ((rem < 35 && o.speed > 2) || rem < 8) return true;
        } else if (o.piece.kind === 'turn' && o.piece.from === appr) {
          if (turnKind(appr.endDir, o.piece.to!.startDir) !== 'left') return true;
        }
      }
    }
    return false;
  }

  /** The nearest car behind in the lane at offset `lat` on the same piece: gap and the car. */
  private follower(car: TrafficCar, lat: number): { gap: number; car: TrafficCar } | null {
    let best: { gap: number; car: TrafficCar } | null = null;
    const fwdX = Math.cos(car.currYaw);
    const fwdZ = -Math.sin(car.currYaw);
    for (const o of this.cars) {
      if (o === car || !o.active || o.wrecked >= 0) continue;
      let gap = Infinity;
      if (o.piece === car.piece) {
        if (o.s < car.s && Math.abs(o.lat - lat) < SAME_LANE) gap = car.s - o.s - car.halfLength - o.halfLength;
      } else {
        // Just behind on the previous piece: close by, same way, in that lane.
        const rx = o.currPos.x - car.currPos.x;
        const rz = o.currPos.z - car.currPos.z;
        const along = -(rx * fwdX + rz * fwdZ);
        const side = rx * -fwdZ + rz * fwdX - (lat - car.lat);
        if (along > 0 && along < 30 && Math.abs(side) < 1.6 && Math.cos(o.currYaw - car.currYaw) > 0.7) {
          gap = along - car.halfLength - o.halfLength;
        }
      }
      if (gap < (best?.gap ?? Infinity)) best = { gap, car: o };
    }
    return best;
  }

  /**
   * Lane decisions, a couple of times a second. Multi-lane roads: simplified MOBIL (switch
   * if it pays and it's safe; keep right unless passing; get into the lane for the next
   * turn). Country roads: overtake slow cars through the oncoming lane when it's clear.
   */
  private decideLane(car: TrafficCar, v0: number): void {
    const p = car.piece;
    if (p.kind !== 'lane') return;
    if (p.lanes < 2) {
      if (p.rural) this.decideOvertake(car, v0);
      return;
    }
    const remaining = p.length - car.s;
    if (Math.abs(car.lat - car.latTarget) > 0.2 || remaining < 14) return; // mid-change / too late
    const current = car.latTarget;
    const other = current === 0 ? LANE_SPACING : 0;
    // Near the end of the block: the lane for the turn (right → right lane, left → left).
    const kind = turnKind(p.endDir, car.exit.startDir);
    const needed = remaining < 60 ? (kind === 'right' || kind === 'uturn' ? LANE_SPACING : kind === 'left' ? 0 : -1) : -1;
    if (needed === current) return;

    const d = car.driver;
    const here = this.leader(car, current, false);
    const there = this.leader(car, other, false);
    if (there.gap < 3) return;
    const accHere = this.idm(d, car.speed, v0, here.gap, car.speed - here.speed);
    const accThere = this.idm(d, car.speed, v0, there.gap, car.speed - there.speed);
    // Safety: whoever ends up behind us there mustn't have to brake hard.
    const back = this.follower(car, other);
    if (back) {
      if (back.gap < 3) return;
      const f = back.car;
      const accBack = this.idm(f.driver, f.speed, this.desiredSpeed(f, f.piece), back.gap, f.speed - car.speed);
      if (accBack < -3) return;
    }
    // Incentive: a must for the coming turn, otherwise it has to pay. Moving right gets a
    // bonus (keep right), moving left must beat it clearly (only to pass).
    const bias = other > current ? 0.25 : -0.35;
    if (needed === other || accThere - accHere + bias > 0.2) {
      car.latTarget = other;
      this.stats.laneChanges++;
    }
  }

  /** Country roads: pull out to pass a slow car if the oncoming lane is clear long enough. */
  private decideOvertake(car: TrafficCar, v0: number): void {
    if (car.passing) return;
    if (Math.abs(car.lat) > 0.2) return;
    const ahead = this.leader(car, 0, true);
    if (ahead.gap > 40 || ahead.speed > v0 - 3 || (car.speed < 3 && ahead.car && ahead.car.speed > 1)) return;
    // Time to get past: close the gap, pass the car, and leave room in front of it, at a
    // closing speed of v0 − v_leader (at least 3 m/s).
    const pastLength = ahead.gap + 2 * car.halfLength + 14;
    const time = pastLength / Math.max(3, v0 - ahead.speed);
    const distance = time * Math.max(v0, car.speed);
    // It must finish before the next junction or bend: on this lane and any country lanes
    // that carry straight on after it.
    const run = this.straightRun(car);
    const last = run[run.length - 1];
    // Never toward a dead end: cars there turn round and come back.
    if (this.graph.nodes[last.lane.node].edges.length === 1) return;
    const room = last.start + last.lane.length - 10;
    if (distance > room || distance > 260) return;
    // The oncoming lane must be clear for the whole time, for cars coming at up to ~20 m/s.
    const clear = distance + time * 20 + 20;
    if (this.oncomingWithin(car, clear)) return;
    if (this.leader(car, -LANE_SPACING, false).gap < 30) return; // someone's already out there
    car.latTarget = -LANE_SPACING;
    this.stats.passStarted++;
    car.passing = ahead.car ? ahead.car.currPos : this.obstacleNear(car);
    car.passTime = 0;
  }

  /** The obstacle in front of the car (to remember what's being passed). */
  private obstacleNear(car: TrafficCar): THREE.Vector3 {
    let best = car.currPos.clone();
    let bestD = Infinity;
    for (const p of this.obstacleList) {
      const d = p.distanceToSquared(car.currPos);
      if (d < bestD) {
        bestD = d;
        best = p.clone();
      }
    }
    return best;
  }

  /**
   * The car's lane and the country lanes that carry straight on after it, through junctions
   * where the road simply continues (two roads, no lights, no sharp bend), with the distance
   * from the car to the start of each (≤ 0 for its own lane).
   */
  private straightRun(car: TrafficCar): { lane: Piece; start: number }[] {
    const p = car.piece;
    const run = [{ lane: p, start: -car.s }];
    if (p.kind !== 'lane') return run;
    let lane = p;
    let start = -car.s;
    let next: Piece = car.exit;
    while (start + lane.length < 300) {
      const node = this.graph.nodes[lane.node];
      if (node.edges.length !== 2 || node.control !== 'none') break;
      if (turnKind(lane.endDir, next.startDir) !== 'straight' || !next.rural) break;
      const gap = Math.hypot(next.pts[0] - lane.pts[lane.pts.length - 2], next.pts[1] - lane.pts[lane.pts.length - 1]);
      start += lane.length + gap;
      lane = next;
      run.push({ lane, start });
      const exits = this.graph.exits(lane);
      if (exits.length !== 1) break;
      next = exits[0];
    }
    return run;
  }

  /** Any car (or the player) coming the other way within `dist` m ahead along the road? */
  private oncomingWithin(car: TrafficCar, dist: number): boolean {
    const run = this.straightRun(car);
    for (const o of this.cars) {
      if (o === car || !o.active) continue;
      for (const { lane, start } of run) {
        if (start > dist) break;
        // A car on the reverse of this lane, or crossing the junction at its far end.
        const end = start + lane.length;
        let ahead = Infinity;
        if (o.piece === this.graph.reverse(lane)) ahead = end - o.s;
        // Any car in the junction at its far end (crossing, or turning round at a dead end).
        else if (o.piece.kind === 'turn' && o.piece.node === lane.node) ahead = end;
        if (ahead > -5 && ahead < dist) return true;
      }
    }
    const fx = Math.cos(car.currYaw);
    const fz = -Math.sin(car.currYaw);
    // Cars heading our way from beyond what the lanes above cover (round a bend, past a
    // junction) that could arrive in time: anything ahead coming the other way, within the
    // distance and a generous width (a false alarm only cancels an overtake).
    for (const o of this.cars) {
      if (o === car || !o.active || o.wrecked >= 0 || o.speed < 1) continue;
      if (Math.cos(o.currYaw - car.currYaw) > -0.3) continue;
      const rx = o.currPos.x - car.currPos.x;
      const rz = o.currPos.z - car.currPos.z;
      const along = rx * fx + rz * fz;
      if (along > 0 && along < dist && Math.abs(rx * -fz + rz * fx) < 12 + along * 0.25) return true;
    }
    // The player: anything moving in the road ahead counts (straight-line check).
    for (const q of this.obstacleList) {
      const rx = q.x - car.currPos.x;
      const rz = q.z - car.currPos.z;
      const along = rx * fx + rz * fz;
      if (along > 0 && along < dist && Math.abs(rx * -fz + rz * fx) < 8) return true;
    }
    return false;
  }

  /** While overtaking: done once well past, abandoned if something comes the other way. */
  private updateOvertake(car: TrafficCar, dt: number): void {
    const target = car.passing;
    if (!target) return;
    car.passTime += dt;
    const fx = Math.cos(car.currYaw);
    const fz = -Math.sin(car.currYaw);
    const along = (target.x - car.currPos.x) * fx + (target.z - car.currPos.z) * fz;
    const p = car.piece;
    const remaining = p.kind === 'lane' ? p.length - car.s : 0;
    let done = along < -(2 * car.halfLength + 6);
    if (done) {
      // Past it. Pull back in only if there's room in our lane; passing a queue, take on
      // the next car in it (while the road stays clear).
      const next = this.leader(car, 0, true);
      if (next.gap < 10 && next.car) {
        car.passing = next.car.currPos;
        done = false;
      }
    }
    const closing = car.speed + 20;
    const danger = this.oncomingWithin(car, closing * 2.5 + 15);
    const node = this.graph.nodes[p.node];
    const runningOut =
      p.kind === 'lane' &&
      remaining < 15 &&
      (node.edges.length !== 2 || node.control !== 'none' || turnKind(p.endDir, car.exit.startDir) !== 'straight');
    if (done || danger || runningOut || car.passTime > 18 || along > 45) {
      if (done) this.stats.passCompleted++;
      else this.stats.passAborted++;
      car.latTarget = 0;
      car.passing = null;
    }
  }

  fixedUpdate(dt: number): void {
    this.time += dt;
    // Lamp colours only need refreshing ten times a second (cars read the light state
    // directly); there are hundreds of signal heads in the world.
    this.lightTimer -= dt;
    if (this.lightTimer <= 0) {
      this.lightTimer = 0.1;
      this.lights.update(this.time);
    }
    const player = this.playerPosition();
    this.obstacleList = this.obstacles();
    this.steps++;

    for (const car of this.cars) {
      if (!car.active) {
        this.respawn(car);
        continue;
      }
      if (!car.pinned && Math.hypot(car.currPos.x - player.x, car.currPos.z - player.z) > DESPAWN) {
        this.respawn(car);
        continue;
      }
      if (car.wrecked >= 0) {
        // Wrecks sit still (other traffic queues behind or goes round), then get cleared away.
        car.wrecked += dt;
        car.prevPos.copy(car.currPos);
        car.prevYaw = car.currYaw;
        car.prevQuat.copy(car.currQuat);
        car.acc = 0;
        if (car.physics) {
          // Nobody driving: the brakes lock and it slides to a stop.
          car.dyn.step({ driven: false, throttle: 0, steer: 0, handbrake: false }, dt);
        } else car.speed = 0;
        if (car.wrecked > WRECK_TIME) this.respawn(car);
        continue;
      }
      // AI near the player, on loaded ground; kinematic otherwise.
      const dist = Math.hypot(car.currPos.x - player.x, car.currPos.z - player.z);
      const wantAI =
        this.policy !== null &&
        this.aiEnabled &&
        this.time >= car.aiBlockedUntil &&
        dist < AI_RADIUS + (car.physics ? AI_HYSTERESIS : 0) &&
        this.groundLoaded(car.currPos.x, car.currPos.z);
      if (wantAI !== car.physics) this.setPhysics(car, wantAI);
      if (car.physics) this.driveAI(car, dt);
      else this.drive(car, dt);
    }
  }

  /** One fixed step of one car: decide, accelerate (IDM), move, change lanes, place. */
  private drive(car: TrafficCar, dt: number): void {
    const d = car.driver;
    this.buildRoute(car);
    // Wanted speed: the driver's pace on this road, capped by curves ahead.
    const v0 = Math.min(this.desiredSpeed(car, car.piece), this.curveSpeed(car));

    car.decideIn -= dt;
    if (car.decideIn <= 0) {
      car.decideIn = this.rng.range(0.4, 0.7);
      this.decideLane(car, v0);
    }
    if (car.passing) this.updateOvertake(car, dt);

    // Car following: the nearest of the leader in this lane and any stop line.
    const lead = this.leader(car, car.latTarget, true);
    // Mid lane change, the lane being left still counts until the car is clear of it.
    if (Math.abs(car.lat - car.latTarget) > 1.2) {
      const old = this.leader(car, car.lat, true);
      if (old.gap < lead.gap) Object.assign(lead, old);
    }
    let acc = this.idm(d, car.speed, v0, lead.gap, car.speed - lead.speed);
    const stop = this.stopGap(car);
    if (stop < Infinity) acc = Math.min(acc, this.idm(d, car.speed, v0, stop, car.speed));
    car.acc = acc;
    car.speed = Math.max(0, car.speed + acc * dt);

    car.prevPos.copy(car.currPos);
    car.prevYaw = car.currYaw;
    car.prevQuat.copy(car.currQuat);
    car.s += car.speed * dt;
    car.wheelSpin += (car.speed * dt) / CAR_DIMENSIONS[car.type].wheelRadius;

    // Sideways toward the target lane: eased, at most LANE_CHANGE_SPEED, and not into a car
    // that's alongside in that lane (it waits, braking or accelerating to find a gap).
    const dl = car.latTarget - car.lat;
    const blocked = Math.abs(dl) > 0.3 && this.blockedSideways(car, dl);
    const want = blocked ? 0 : Math.sign(dl) * Math.min(LANE_CHANGE_SPEED, Math.abs(dl) * 1.2) * Math.min(1, car.speed / 3 + 0.3);
    car.latVel += (want - car.latVel) * Math.min(1, dt * 4);
    car.lat += car.latVel * dt;
    if (Math.abs(car.latTarget - car.lat) < 0.02 && Math.abs(car.latVel) < 0.05) {
      car.lat = car.latTarget;
      car.latVel = 0;
    }

    // Move on to the next piece: lane → turn through the junction → next lane.
    while (car.s >= car.piece.length) {
      const piece = car.piece;
      if (piece.kind === 'lane') {
        car.s -= piece.length;
        const turn = this.plannedTurn(car, piece);
        car.piece = turn;
        // Offsets are relative to the piece's own line: the turn already starts in the
        // lane it was aiming for, so what's left is only an unfinished lane change.
        car.lat -= turn.offIn;
        car.latTarget = 0;
        car.stoppedAt = -1;
        // Pick the exit for the lane after this turn.
        car.exit = this.chooseExit(turn.to!);
      } else {
        car.s -= piece.length;
        car.piece = piece.to!;
        car.lat += piece.offOut;
        car.latTarget = piece.offOut;
      }
    }
    this.place(car);
    yawPitchQuaternion(car.currYaw, car.currPitch, car.currQuat);
    car.body.setNextKinematicTranslation(car.currPos);
    car.body.setNextKinematicRotation(car.currQuat);
  }

  /** Is a car alongside, on the side the car is moving to (would moving over hit it)? */
  private blockedSideways(car: TrafficCar, dl: number): boolean {
    const fwdX = Math.cos(car.currYaw);
    const fwdZ = -Math.sin(car.currYaw);
    for (const o of this.cars) {
      if (o === car || !o.active) continue;
      const rx = o.currPos.x - car.currPos.x;
      const rz = o.currPos.z - car.currPos.z;
      if (rx * rx + rz * rz > 100) continue;
      const along = rx * fwdX + rz * fwdZ;
      const side = rx * -fwdZ + rz * fwdX;
      // Overlapping lengthwise (plus a little), on the side we're heading to, within reach.
      if (Math.abs(along) < car.halfLength + o.halfLength + 0.8 && side * dl > 0 && Math.abs(side) < Math.abs(dl) + 2.1) return true;
    }
    return false;
  }

  /** Switch a car between AI physics driving and kinematic driving. */
  private setPhysics(car: TrafficCar, on: boolean): void {
    const body = car.body;
    car.physics = on;
    if (on) {
      body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      body.setTranslation({ x: car.currPos.x, y: car.currPos.y + 0.05, z: car.currPos.z }, true);
      body.setRotation(car.currQuat, true);
      const fx = Math.cos(car.currYaw);
      const fz = -Math.sin(car.currYaw);
      body.setLinvel({ x: fx * car.speed, y: 0, z: fz * car.speed }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      car.dyn.steer = 0;
      car.ai.action = [0, 0];
      car.ai.prevAction = [0, 0];
      car.aiPathKey = '';
      car.aiStuck = 0;
    } else {
      body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      // Carry on kinematically from where the physics left it, in its lane.
      car.speed = Math.max(0, car.speed);
    }
  }

  /** Install the trained driving policy (null turns AI driving off). */
  setPolicy(policy: Policy | null): void {
    this.policy = policy;
  }

  get hasPolicy(): boolean {
    return this.policy !== null;
  }

  private pieceId(p: Piece): number {
    let id = this.pieceIds.get(p);
    if (id === undefined) this.pieceIds.set(p, (id = this.nextPieceId++));
    return id;
  }

  /**
   * One fixed step of an AI-driven car: the rules plan (route, lane, overtaking) and work out
   * how hard they'd brake; the network steers and works the pedals; the harder brake wins.
   */
  private driveAI(car: TrafficCar, dt: number): void {
    const d = car.driver;
    // Where the physics has taken it along its pieces (the network steers, so it's never
    // exactly on the line).
    this.trackPieces(car);
    this.buildRoute(car);
    const v0 = Math.min(this.desiredSpeed(car, car.piece), this.curveSpeed(car));
    car.decideIn -= dt;
    if (car.decideIn <= 0) {
      car.decideIn = this.rng.range(0.4, 0.7);
      this.decideLane(car, v0);
    }
    if (car.passing) this.updateOvertake(car, dt);
    const lead = this.leader(car, car.latTarget, true);
    if (Math.abs(car.lat - car.latTarget) > 1.2) {
      const old = this.leader(car, car.lat, true);
      if (old.gap < lead.gap) Object.assign(lead, old);
    }
    let acc = this.idm(d, car.speed, v0, lead.gap, car.speed - lead.speed);
    const stop = this.stopGap(car);
    if (stop < Infinity) acc = Math.min(acc, this.idm(d, car.speed, v0, stop, car.speed));

    // Lane offset the route line follows: eased toward the target lane, as in drive().
    const dl = car.latTarget - car.lat;
    const blocked = Math.abs(dl) > 0.3 && this.blockedSideways(car, dl);
    const want = blocked ? 0 : Math.sign(dl) * Math.min(LANE_CHANGE_SPEED, Math.abs(dl) * 1.2) * Math.min(1, car.speed / 3 + 0.3);
    car.latVel += (want - car.latVel) * Math.min(1, dt * 4);
    car.lat += car.latVel * dt;
    if (Math.abs(car.latTarget - car.lat) < 0.02 && Math.abs(car.latVel) < 0.05) {
      car.lat = car.latTarget;
      car.latVel = 0;
    }

    // The network decides 15 times a second (cars staggered across steps).
    if ((this.steps + car.index) % AI_DECISION_STEPS === 0) {
      if (!this.decide(car)) return;
    }
    // Safety layer: the rules' braking, as a brake pedal, overrides a lighter foot.
    const ai = car.ai;
    let throttle = ai.action[1];
    let handbrake = false;
    if (acc < -SHIELD_DECEL) {
      // Real braking (a stop line, a car crossing, someone in the road): as a brake pedal.
      const rule = Math.max(-1, acc / BRAKE_DECEL);
      if (rule < throttle - 0.02) {
        throttle = rule;
        this.stats.aiShieldSteps++;
      }
    } else if (car.speed > v0 + 0.5 && throttle > 0) {
      // Faster than this driver likes (a dawdler, a van): just lift off.
      throttle = 0;
    }
    // Told to wait and (nearly) stopped: hold it there, even on a hill.
    if (acc < -0.3 && car.speed < 0.6) {
      throttle = 0;
      handbrake = true;
    }
    this.stats.aiSteps++;
    car.acc = throttle < -0.05 ? -BRAKE_DECEL * -throttle : acc;
    car.prevPos.copy(car.currPos);
    car.prevYaw = car.currYaw;
    car.prevQuat.copy(car.currQuat);
    car.dyn.step({ driven: true, steer: ai.action[0], throttle, handbrake }, dt);

    // Stuck: stopped although the rules say go (wedged on something). Hand it back.
    car.aiStuck = car.speed < 0.3 && acc > 0.3 ? car.aiStuck + dt : 0;
    if (car.aiStuck > 6) this.fallBack(car);
  }

  /** Move a physics car's piece / distance along on from its actual position. */
  private trackPieces(car: TrafficCar): void {
    for (let guard = 0; guard < 4; guard++) {
      car.s = projectOnPiece(car.piece, car.currPos.x, car.currPos.z, guard === 0 ? car.s : undefined);
      if (car.s < car.piece.length) break;
      const piece = car.piece;
      if (piece.kind === 'lane') {
        const turn = this.plannedTurn(car, piece);
        car.piece = turn;
        car.lat -= turn.offIn;
        car.latTarget = 0;
        car.stoppedAt = -1;
        car.exit = this.chooseExit(turn.to!);
      } else {
        car.piece = piece.to!;
        car.lat += piece.offOut;
        car.latTarget = piece.offOut;
      }
    }
  }

  /** The network's next action for a car. False if the car had to be handed back. */
  private decide(car: TrafficCar): boolean {
    const policy = this.policy!;
    const ai = car.ai;
    const t0 = performance.now();
    // The route line: the next pieces at the car's lane offset (rebuilt when they change).
    const r = this.route;
    const lat0 = Math.round(car.lat * 20) / 20;
    let key = `${lat0}`;
    for (let k = 0; k < this.routeLength; k++) key += `|${this.pieceId(r[k].piece)}:${r[k].lat}`;
    if (key !== car.aiPathKey) {
      const pieces: Piece[] = [];
      for (let k = 0; k < this.routeLength; k++) {
        const step = r[k];
        pieces.push(step.piece.kind === 'turn' ? step.piece : shiftPiece(step.piece, k === 0 ? car.lat : step.lat));
      }
      ai.path = new Path(pieces, this.graph);
      ai.s = car.s; // the route line starts at the current piece's start
      car.aiPathKey = key;
    }
    senseDriver(ai, car.body, car.dyn.steer, this.sensors, this.graph, this.time);
    // Lost (spun out, shoved off the road): hand back to kinematic driving.
    if (Math.abs(ai.lat) > 5 || ai.frame.upY < 0.5) {
      this.fallBack(car);
      return false;
    }
    ai.prevAction = ai.action;
    observe(ai, this.obs);
    policy.act1(this.obs, this.act);
    ai.action = [this.act[0], this.act[1]];
    this.stats.aiDecisions++;
    this.stats.aiMs += performance.now() - t0;
    return true;
  }

  /** The AI lost its way: drive this car kinematically for a while (out of sight: respawn). */
  private fallBack(car: TrafficCar): void {
    this.stats.aiFallbacks++;
    car.aiBlockedUntil = this.time + 15;
    const player = this.playerPosition();
    if (!car.pinned && Math.hypot(car.currPos.x - player.x, car.currPos.z - player.z) > 70) {
      this.respawn(car);
      return;
    }
    this.setPhysics(car, false);
  }

  afterStep(): void {
    // Physics cars: read the pose back from the body.
    for (const car of this.cars) {
      if (!car.active || !car.physics) continue;
      const t = car.body.translation();
      const q = car.body.rotation();
      car.currPos.set(t.x, t.y, t.z);
      car.currQuat.set(q.x, q.y, q.z, q.w);
      // Forward (+X) in the world: heading and pitch.
      const fx = 1 - 2 * (q.y * q.y + q.z * q.z);
      const fy = 2 * (q.x * q.y + q.w * q.z);
      const fz = 2 * (q.x * q.z - q.w * q.y);
      car.currYaw = Math.atan2(-fz, fx);
      car.currPitch = Math.asin(Math.max(-1, Math.min(1, fy)));
      const v = car.body.linvel();
      car.speed = Math.max(0, (v.x * fx + v.z * fz) / (Math.hypot(fx, fz) || 1));
      car.wheelSpin += (car.speed * (1 / 60)) / CAR_DIMENSIONS[car.type].wheelRadius;
    }
  }

  render(alpha: number, frameDt: number): void {
    const pos = this.tmp;
    this.emitSmoke(frameDt);
    for (const car of this.cars) {
      const meshes = this.meshes.get(car.type)!;
      if (!car.active) {
        // Hidden: zero scale.
        this.mat.makeScale(0, 0, 0);
        for (const m of meshes) m.setMatrixAt(car.slot, this.mat);
        this.wreckBodies.get(car.type)!.setMatrixAt(car.slot, this.mat);
        this.brakeLights.get(car.type)!.setMatrixAt(car.slot, this.mat);
        continue;
      }
      pos.lerpVectors(car.prevPos, car.currPos, alpha);
      this.quat.slerpQuaternions(car.prevQuat, car.currQuat, alpha);
      this.mat.compose(pos, this.quat, this.one);
      for (const m of meshes) m.setMatrixAt(car.slot, this.mat);
      // Brake lights: on while slowing down or standing.
      const braking = car.wrecked < 0 && (car.acc < -0.8 || car.speed < 0.3);
      this.brakeLights.get(car.type)!.setMatrixAt(car.slot, braking ? this.mat : HIDDEN);
      // Wrecked: show the burnt body in place of the painted one.
      const wreck = this.wreckBodies.get(car.type)!;
      if (car.wrecked >= 0) {
        wreck.setMatrixAt(car.slot, this.mat);
        meshes[0].setMatrixAt(car.slot, HIDDEN);
      } else {
        wreck.setMatrixAt(car.slot, HIDDEN);
      }
    }
    // Wheels: four per car, positioned in the car's frame and spun about their axle.
    const { carMat, local, spin } = this;
    this.cars.forEach((car, k) => {
      const d = CAR_DIMENSIONS[car.type];
      if (!car.active) {
        this.mat.makeScale(0, 0, 0);
        for (let w = 0; w < 4; w++) {
          this.tyres.setMatrixAt(k * 4 + w, this.mat);
          this.rims.setMatrixAt(k * 4 + w, this.mat);
        }
        return;
      }
      // Wheels follow whichever body is showing (the burnt one for wrecks).
      (car.wrecked >= 0 ? this.wreckBodies.get(car.type)! : this.meshes.get(car.type)![0]).getMatrixAt(car.slot, carMat);
      spin.makeRotationZ(-car.wheelSpin);
      for (let w = 0; w < 4; w++) {
        const x = w < 2 ? d.wheelBase / 2 : -d.wheelBase / 2;
        const z = w % 2 === 0 ? -d.track / 2 : d.track / 2;
        local.compose(this.tmp2.set(x, d.wheelRadius, z), IDENTITY_QUAT, SCALE.set(d.wheelRadius, d.wheelRadius, 1));
        this.mat.multiplyMatrices(carMat, local).multiply(spin);
        this.tyres.setMatrixAt(k * 4 + w, this.mat);
        this.rims.setMatrixAt(k * 4 + w, this.mat);
      }
    });
    for (const m of this.wreckBodies.values()) m.instanceMatrix.needsUpdate = true;
    for (const m of this.brakeLights.values()) m.instanceMatrix.needsUpdate = true;
    for (const list of this.meshes.values()) {
      for (const m of list) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    }
    this.tyres.instanceMatrix.needsUpdate = true;
    this.rims.instanceMatrix.needsUpdate = true;
  }

  /** A running traffic car between `minDist` and `maxDist` from `from` (for missions). */
  pickTarget(from: THREE.Vector3, minDist: number, maxDist: number): TrafficCar | null {
    const options = this.cars.filter((c) => {
      if (!c.active || c.wrecked >= 0 || c.pinned) return false;
      const d = Math.hypot(c.currPos.x - from.x, c.currPos.z - from.z);
      return d >= minDist && d <= maxDist;
    });
    return options.length ? options[Math.floor(Math.random() * options.length)] : null;
  }

  /** The traffic car this collider belongs to (e.g. what a bullet hit), if any. */
  carForCollider(collider: RAPIER.Collider): TrafficCar | null {
    const body = collider.parent();
    if (!body) return null;
    return this.cars.find((c) => c.active && c.body.handle === body.handle) ?? null;
  }

  /** Gunfire hit a car. At zero health it's wrecked: stops dead, charred, smoking. */
  damage(car: TrafficCar, amount: number): void {
    if (!car.active || car.wrecked >= 0) return;
    car.health -= amount;
    if (car.health > 0) return;
    car.health = 0;
    car.wrecked = 0;
    car.speed = 0;
    this.onWreck?.(car.currPos);
  }

  /** The nearest traffic car within `radius` that's slow enough to carjack, if any. */
  jackable(position: THREE.Vector3, radius: number): TrafficCar | null {
    let best: TrafficCar | null = null;
    let bestDist = radius;
    for (const car of this.cars) {
      if (!car.active || car.speed > 4 || car.wrecked >= 0) continue;
      const d = Math.hypot(car.currPos.x - position.x, car.currPos.z - position.z);
      if (d < bestDist) {
        best = car;
        bestDist = d;
      }
    }
    return best;
  }

  /**
   * Take a car out of traffic (it's been carjacked): returns its look and pose so a
   * drivable car can replace it. The slot is recycled as a new traffic car elsewhere.
   */
  take(car: TrafficCar): { type: CarType; color: number; position: THREE.Vector3; yaw: number } {
    const taken = { type: car.type, color: car.color, position: car.currPos.clone(), yaw: car.currYaw };
    if (car.physics) this.setPhysics(car, false);
    car.active = false;
    car.body.setEnabled(false);
    return taken;
  }

  /** Damaged cars smoke from the bonnet: more and darker the worse the damage. */
  private emitSmoke(frameDt: number): void {
    if (!this.smoke) return;
    for (const car of this.cars) {
      if (!car.active) continue;
      const damage = car.wrecked >= 0 ? 1 : 1 - car.health / CAR_HEALTH;
      if (damage < 0.35) continue;
      // Puffs per second grow with damage; a wreck billows.
      const rate = car.wrecked >= 0 ? 14 : 3 + damage * 8;
      car.smokeTimer -= frameDt;
      if (car.smokeTimer > 0) continue;
      car.smokeTimer = 1 / rate;
      const ahead = car.wrecked >= 0 ? 0.2 : 1.5; // engine bay, or the whole car when wrecked
      const p = this.tmp2.set(Math.cos(car.currYaw) * ahead, 1.1, -Math.sin(car.currYaw) * ahead).add(car.currPos);
      p.x += (Math.random() - 0.5) * 0.8;
      p.z += (Math.random() - 0.5) * 0.8;
      this.smoke.emit(p, car.wrecked >= 0 ? 0.9 : damage * 0.7, car.wrecked >= 0 ? 1.4 : 0.8);
    }
  }

  /** Positions of active traffic cars (for pedestrians and debugging). */
  positions(): THREE.Vector3[] {
    return this.cars.filter((c) => c.active).map((c) => c.currPos);
  }

  /** For tests: the cars' states. */
  get debugCars(): {
    pos: THREE.Vector3;
    speed: number;
    kind: string;
    active: boolean;
    rural: boolean;
    lat: number;
    latTarget: number;
    pace: number;
    passing: boolean;
    acc: number;
    yaw: number;
    physics: boolean;
  }[] {
    return this.cars.map((c) => ({
      pos: c.currPos,
      speed: c.speed,
      kind: c.piece.kind,
      active: c.active,
      rural: c.piece.rural,
      lat: c.lat,
      latTarget: c.latTarget,
      pace: c.driver.pace,
      passing: c.passing !== null,
      acc: c.acc,
      yaw: c.currYaw,
      physics: c.physics,
    }));
  }
}

/** Zero scale: hides an instance. Shared, never modified. */
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const IDENTITY_QUAT = new THREE.Quaternion();
const SCALE = new THREE.Vector3();

/**
 * Traffic signals: a pole on the kerb at each approach to a lit junction, with a three-lamp
 * head facing the oncoming traffic. Lamps are unlit-material instances whose colour is
 * switched between bright (on) and dark (off).
 */
class TrafficLights {
  private readonly approaches: Piece[] = [];
  private readonly lamps: Record<Light, THREE.InstancedMesh>;
  private readonly state: Light[] = [];

  constructor(scene: THREE.Scene, world: RAPIER.World, private readonly graph: RoadGraph, terrain: Terrain) {
    const net = graph.net;
    for (const n of net.nodes) {
      if (n.control !== 'lights') continue;
      for (const e of n.edges) this.approaches.push(graph.lane(e, net.edges[e].b === n.id ? 1 : -1));
    }
    const count = Math.max(1, this.approaches.length);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.5, metalness: 0.6 });
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.09, 3.6, 8).translate(0, 1.8, 0), poleMat, count);
    const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 1.0, 0.32).translate(0, 3.25, 0), poleMat, count);
    pole.castShadow = head.castShadow = true;
    pole.count = head.count = this.approaches.length;
    const lampGeo = new THREE.CircleGeometry(0.11, 12);
    const makeLamps = () => {
      const m = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), count);
      m.count = this.approaches.length;
      scene.add(m);
      return m;
    };
    this.lamps = { red: makeLamps(), yellow: makeLamps(), green: makeLamps() };
    const lampY: Record<Light, number> = { red: 3.55, yellow: 3.25, green: 2.95 };

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    this.approaches.forEach((lane, k) => {
      const [tx, tz] = lane.endDir;
      const edge = net.edges[lane.edge];
      const hw = ROAD_SPECS[edge.cls].width / 2;
      // On the kerb to the right, level with the end of the lane (just before the junction).
      const end = lane.pts.length - 2;
      const out = hw - LANE_OFFSET + 0.8;
      const x = lane.pts[end] - tz * out;
      const z = lane.pts[end + 1] + tx * out;
      const base = new THREE.Vector3(x, terrain.surfaceAt(x, z) - 0.05, z);
      // Face the head toward the oncoming traffic (−travel). Circles face +Z by default.
      const back = new THREE.Vector3(-tx, 0, -tz);
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), back);
      m.compose(base, q, s);
      pole.setMatrixAt(k, m);
      head.setMatrixAt(k, m);
      for (const light of ['red', 'yellow', 'green'] as Light[]) {
        const lampPos = base.clone().addScaledVector(back, 0.17);
        lampPos.y += lampY[light];
        m.compose(lampPos, q, s);
        this.lamps[light].setMatrixAt(k, m);
      }
      world.createCollider(RAPIER.ColliderDesc.cylinder(1.8, 0.1).setTranslation(base.x, base.y + 1.8, base.z));
      this.state.push('green');
    });
    scene.add(pole, head);
    this.update(0, true);
  }

  private static readonly ON: Record<Light, THREE.Color> = {
    red: new THREE.Color(1, 0.1, 0.05).multiplyScalar(2),
    yellow: new THREE.Color(1, 0.6, 0.05).multiplyScalar(2),
    green: new THREE.Color(0.1, 1, 0.35).multiplyScalar(2),
  };
  private static readonly OFF = new THREE.Color(0.05, 0.05, 0.05);

  update(time: number, force = false): void {
    let changed = false;
    this.approaches.forEach((lane, k) => {
      const light = this.graph.lightState(lane, time);
      if (!force && light === this.state[k]) return;
      this.state[k] = light;
      changed = true;
      for (const l of ['red', 'yellow', 'green'] as Light[]) {
        this.lamps[l].setColorAt(k, l === light ? TrafficLights.ON[l] : TrafficLights.OFF);
      }
    });
    if (changed) for (const l of ['red', 'yellow', 'green'] as Light[]) if (this.lamps[l].instanceColor) this.lamps[l].instanceColor!.needsUpdate = true;
  }
}

