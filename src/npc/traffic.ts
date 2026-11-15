import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { SimEntity } from '../sim/entity';
import type { Smoke } from '../sim/smoke';
import { Rng } from '../world/rng';
import { ROAD_WIDTH, cellOf, type CityLayout } from '../world/layout';
import type { Terrain } from '../world/terrain';
import type { Warp } from '../world/warp';
import {
  DIRS,
  LANE_OFFSET,
  LANE_SPACING,
  RoadGraph,
  bezierPoint,
  bezierTangent,
  dirVector,
  lightState,
  turnKind,
  type Dir,
  type Light,
  type Piece,
} from '../world/roadGraph';
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

// NPC traffic: cars that follow the road graph, obey traffic lights and keep their distance.
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
//   acceleration and b its comfortable braking. Red lights, junctions it must give way at
//   and obstacles are leaders that stand still.
// - Personality: every driver gets their own v0 (85–120 % of the limit, some dawdlers),
//   T, a, b and s0, so traffic spreads out, platoons form behind slow cars and fast ones
//   want to get past.
// - Lane changes (town roads, two lanes each way): a simplified MOBIL rule. Change lane if
//   the acceleration you'd have there beats the current one by a threshold, and the car
//   that would be behind you there wouldn't have to brake hard. A bias keeps cars right
//   (pass on the left), and near the end of a block they move into the lane for their turn.
// - Overtaking (country roads, one lane each way): stuck behind something slower, a driver
//   pulls into the oncoming lane if the road ahead is clear for the whole manoeuvre, and
//   aborts if something appears.
// - Curves: a speed limit √(a_lat/κ) from the curvature of the road (precomputed per piece),
//   braked for in advance. Unsignalled country junctions: slow down and wait while another
//   car is crossing. Left turns at lights wait for oncoming traffic.
//
// Cost: decisions about lanes run a couple of times a second per car (staggered), the
// per-step work is IDM plus a scan over the other ~28 cars, and pieces are shared objects
// so "same lane?" is an identity check.

const POOL_SIZE = 28;
const SPAWN_MIN = 60; // m from the player (closer spawns would pop in visibly)
const SPAWN_MAX = 220;
const DESPAWN = 260;
const TOWN_SPEED = 12.5; // m/s ≈ 45 km/h speed limit in town
const RURAL_SPEED = 19; // m/s ≈ 70 km/h on country roads
const JUNCTION_SPEED = 12; // m/s going straight over an unsignalled junction (turns are slower anyway)
const STOP_LINE_BACK = 4.4; // m before the intersection edge (behind the zebra crossing)
const JUNCTION_WAIT = 2.5; // m before an unsignalled junction's edge when giving way
const SAME_LANE = 2.4; // m: cars whose lateral offsets differ by less than this share a lane
const LANE_CHANGE_SPEED = 1.5; // m/s sideways at most
const LOOKAHEAD = 90; // m of road ahead considered for curves and leaders
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
  /** Where it'll turn at the end of the lane it's on (or the lane it's about to join). */
  exit: Dir;
  driver: Driver;
  /** Cache for plannedTurn(). */
  planned: { lane: Piece | null; exit: Dir; offIn: number; turn: Piece | null };
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
  private readonly warp: Warp;
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
  readonly stats = { laneChanges: 0, passStarted: 0, passCompleted: 0, passAborted: 0 };
  private obstacleList: THREE.Vector3[] = [];

  // Scratch.
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly tmp3 = new THREE.Vector3();
  private readonly mat = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly one = new THREE.Vector3(1, 1, 1);
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
    this.graph = new RoadGraph(layout);
    this.warp = layout.warp;
    this.lights = new TrafficLights(scene, world, this.graph, terrain);

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

    for (const { type, slot } of slots) {
      const d = CAR_DIMENSIONS[type];
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(d.boxHalf[0], d.boxHalf[1], d.boxHalf[2]).setTranslation(...d.boxCenter),
        body,
      );
      const color = type === 'taxi' ? TAXI_YELLOW : PAINT_COLORS[this.rng.int(0, PAINT_COLORS.length - 1)];
      this.meshes.get(type)![0].setColorAt(slot, new THREE.Color(color));
      this.cars.push({
        type,
        color,
        slot,
        body,
        piece: this.graph.lane(26, 26, 0)!, // placeholder until respawn (downtown always has roads)
        s: 0,
        speed: 0,
        acc: 0,
        lat: 0,
        latTarget: 0,
        latVel: 0,
        exit: 0,
        driver: this.newDriver(type),
        planned: { lane: null, exit: 0, offIn: 0, turn: null },
        decideIn: this.rng.range(0, 0.5),
        passing: null,
        passTime: 0,
        wheelSpin: 0,
        health: CAR_HEALTH,
        wrecked: -1,
        smokeTimer: 0,
        pinned: false,
        halfLength: d.length / 2,
        prevPos: new THREE.Vector3(),
        currPos: new THREE.Vector3(),
        prevYaw: 0,
        currYaw: 0,
        currPitch: 0,
        active: false,
      });
    }
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
    // Try intersections within a few blocks of the player (on the grid, before the warp).
    const g = this.warp.inverse(player.x, player.z);
    const pi = cellOf(g.x);
    const pj = cellOf(g.z);
    for (let attempt = 0; attempt < 40; attempt++) {
      const i = Math.min(this.graph.size - 1, Math.max(0, pi + this.rng.int(-3, 3)));
      const j = Math.min(this.graph.size - 1, Math.max(0, pj + this.rng.int(-3, 3)));
      const d = this.rng.pick(DIRS);
      const lane = this.graph.lane(i, j, d);
      if (!lane || lane.length < 20) continue;
      const s = this.rng.range(4, lane.length - 12);
      const gp = bezierPoint(lane, s / lane.length, this.tmp);
      const w = this.warp.forward(gp.x, gp.z);
      const dist = Math.hypot(w.x - player.x, w.z - player.z);
      if (dist < minDist || dist > SPAWN_MAX) continue;
      const wx = w.x;
      const wz = w.z;
      if (this.cars.some((o) => o !== car && o.active && Math.hypot(o.currPos.x - wx, o.currPos.z - wz) < 15)) continue;
      car.piece = lane;
      car.s = s;
      car.driver = this.newDriver(car.type);
      // Town roads: mostly the right-hand (outer) lane.
      car.lat = car.latTarget = lane.rural ? 0 : this.rng.chance(0.65) ? LANE_SPACING : 0;
      car.latVel = 0;
      car.passing = null;
      car.exit = this.chooseExit(lane);
      car.speed = this.desiredSpeed(car, lane) * 0.7;
      car.acc = 0;
      car.active = true;
      car.health = CAR_HEALTH;
      car.wrecked = -1;
      this.place(car);
      car.prevPos.copy(car.currPos);
      car.prevYaw = car.currYaw;
      car.body.setTranslation(car.currPos, true);
      car.body.setEnabled(true);
      return;
    }
    // Nowhere suitable right now: park it out of the way until next time.
    car.active = false;
    car.body.setEnabled(false);
  }

  /** Where to turn at the end of a lane: mostly straight on. */
  private chooseExit(lane: Piece): Dir {
    const exits = this.graph.exits(lane.toI, lane.toJ, lane.dir);
    if (exits.includes(lane.dir) && this.rng.chance(0.55)) return lane.dir;
    return this.rng.pick(exits);
  }

  /** The speed limit on a piece times this driver's pace. */
  private desiredSpeed(car: TrafficCar, piece: Piece): number {
    return (piece.rural ? RURAL_SPEED : TOWN_SPEED) * car.driver.pace;
  }

  /**
   * Lane offset after the turn at the end of a lane: right turns into the right-hand lane,
   * left turns into the left-hand one, straight on stays put; country roads have one lane.
   */
  private exitOffset(lane: Piece, exit: Dir, offIn: number): number {
    const next = this.graph.lane(lane.toI, lane.toJ, exit);
    const kind = turnKind(lane.dir, exit);
    if (!next || next.rural) return kind === 'straight' && offIn < 0 ? offIn : 0;
    if (kind === 'right' || kind === 'uturn') return LANE_SPACING;
    if (kind === 'left') return 0;
    return Math.max(0, offIn);
  }

  /** The turn a car on a lane will take at its end, from the lane it's aiming for. */
  private plannedTurn(car: TrafficCar, lane: Piece): Piece {
    const offIn = car.latTarget;
    const c = car.planned;
    // Cached while the lane, exit and target lane stay the same (most steps).
    if (c.turn && c.lane === lane && c.exit === car.exit && c.offIn === offIn) return c.turn;
    c.lane = lane;
    c.exit = car.exit;
    c.offIn = offIn;
    c.turn = this.graph.turn(lane.toI, lane.toJ, lane.dir, car.exit, offIn, this.exitOffset(lane, car.exit, offIn));
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
      r[2].piece = this.graph.lane(turn.toI, turn.toJ, turn.dir)!;
      r[2].lat = turn.offOut;
      r[2].start = r[1].start + turn.length;
    } else {
      const lane = this.graph.lane(p.toI, p.toJ, p.dir)!;
      r[1].piece = lane;
      r[1].lat = p.offOut;
      r[1].start = p.length - car.s;
      // The car has already picked its exit for that lane; it'll arrive in lane offOut.
      const target = car.latTarget;
      car.latTarget = p.offOut;
      r[2].piece = this.plannedTurn(car, lane);
      car.latTarget = target;
      r[2].lat = 0;
      r[2].start = r[1].start + lane.length;
    }
    this.routeLength = 3;
  }

  /** Update the car's world position, heading and pitch from its piece, distance and offset. */
  private place(car: TrafficCar): void {
    const piece = car.piece;
    const t = Math.min(1, car.s / piece.length);
    const g = bezierPoint(piece, t, this.tmp);
    const tan = bezierTangent(piece, t, this.tmp2).normalize();
    // Sideways offset on the grid: the right of the tangent is (−tz, tx).
    g.x += -tan.z * car.lat;
    g.z += tan.x * car.lat;
    // Two points 1.5 m ahead and behind, bent into the world: the midpoint is the car,
    // the line between them its heading, and the road heights there its pitch.
    const ax = g.x + tan.x * 1.5;
    const az = g.z + tan.z * 1.5;
    const bx = g.x - tan.x * 1.5;
    const bz = g.z - tan.z * 1.5;
    let w = this.warp.forward(ax, az);
    const awx = w.x;
    const awz = w.z;
    w = this.warp.forward(bx, bz);
    const bwx = w.x;
    const bwz = w.z;
    const ha = this.terrain.roadHeight(awx, awz, ax, az);
    const hb = this.terrain.roadHeight(bwx, bwz, bx, bz);
    car.currPos.set((awx + bwx) / 2, (ha + hb) / 2, (awz + bwz) / 2);
    // Model forward is +X; yaw from the world direction, nosed toward the side it's
    // drifting to while changing lanes.
    car.currYaw = Math.atan2(-(awz - bwz), awx - bwx) - Math.atan2(car.latVel, Math.max(car.speed, 2));
    car.currPitch = Math.atan2(ha - hb, Math.hypot(awx - bwx, awz - bwz));
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
   * coming at it in that lane, other cars close in front (crossing an intersection), and
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
      if (k > 0 && r[k - 1].piece.kind === 'turn' && r[k - 1].piece.from !== r[k - 1].piece.dir) break;
      const rev = this.graph.lane(step.piece.toI, step.piece.toJ, ((step.piece.dir + 2) % 4) as Dir);
      if (rev) opp.push({ rev, end: step.start + step.piece.length, lat: k === 0 ? lat : step.lat });
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
      // Coming the other way in this lane (an overtaker, or us overtaking): both cars
      // close the gap, so treat it as a stopped car halfway.
      const facing = matched ? undefined : opp.find((q) => q.rev === o.piece);
      if (facing) {
        // My offset from the centre line is LANE_OFFSET + lat; theirs, seen from my side,
        // is −(LANE_OFFSET + o.lat): same spot across the road when these cancel.
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
        // Not on our route: only if it's right in front (e.g. crossing the intersection).
        const rx = o.currPos.x - car.currPos.x;
        const rz = o.currPos.z - car.currPos.z;
        const along = rx * fwdX + rz * fwdZ;
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
    const t = Math.min(1, s / piece.length);
    const g = bezierPoint(piece, t, this.tmp3);
    const tan = bezierTangent(piece, t, this.tmp2).normalize();
    const extra = Math.max(0, s - piece.length);
    const gx = g.x + tan.x * extra - tan.z * car.lat;
    const gz = g.z + tan.z * extra + tan.x * car.lat;
    let w = this.warp.forward(gx, gz);
    const qx = w.x;
    const qz = w.z;
    w = this.warp.forward(gx + tan.x, gz + tan.z);
    const fx = w.x - qx;
    const fz = w.z - qz;
    const len = Math.hypot(fx, fz) || 1;
    return ((p.x - qx) * -fz + (p.z - qz) * fx) / len;
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
   * Stop lines that apply now: a red (or stoppable yellow) light, an unsignalled junction
   * with someone crossing, or a left turn across oncoming traffic. Gap from the front
   * bumper (m), or Infinity.
   */
  private stopGap(car: TrafficCar): number {
    const p = car.piece;
    if (p.kind !== 'lane') return Infinity;
    const i = p.toI;
    const j = p.toJ;
    const toEdge = p.length - car.s - car.halfLength;
    if (toEdge > LOOKAHEAD) return Infinity;
    if (this.graph.hasLights(i, j)) {
      const toLine = toEdge - STOP_LINE_BACK;
      if (toLine < -0.5) return Infinity; // already over the line: carry on
      const light = lightState(i, j, p.dir, this.time);
      if (light === 'red') return Math.max(0, toLine);
      if (light === 'yellow') {
        // Stop if it can comfortably; otherwise go through.
        return toLine > (car.speed * car.speed) / (2 * car.driver.b) ? Math.max(0, toLine) : Infinity;
      }
      // Green: a left turn waits (at the line) for oncoming cars going straight or right.
      if (turnKind(p.dir, car.exit) === 'left' && toLine < 25 && this.oncomingConflict(car, i, j, p.dir)) return Math.max(0, toLine);
      return Infinity;
    }
    // Give way a couple of metres back from the junction, clear of cars turning across it.
    if (this.graph.isJunction(i, j) && this.junctionBusy(car, i, j, p.dir)) return Math.max(0, toEdge - JUNCTION_WAIT);
    return Infinity;
  }

  /** Is another car crossing junction (i, j) from a different direction? */
  private junctionBusy(car: TrafficCar, i: number, j: number, from: Dir): boolean {
    for (const o of this.cars) {
      if (o === car || !o.active || o.piece.kind !== 'turn') continue;
      if (o.piece.toI === i && o.piece.toJ === j && o.piece.from !== from) return true;
    }
    return false;
  }

  /** Oncoming traffic a left turn at (i, j) must wait for. */
  private oncomingConflict(car: TrafficCar, i: number, j: number, dir: Dir): boolean {
    const back = ((dir + 2) % 4) as Dir;
    const beyond = this.graph.neighbor(i, j, dir);
    const oncoming = beyond ? this.graph.lane(beyond[0], beyond[1], back) : null;
    const theirLeft = ((back + 3) % 4) as Dir;
    for (const o of this.cars) {
      if (o === car || !o.active || o.wrecked >= 0) continue;
      if (o.piece === oncoming) {
        if (o.exit === theirLeft) continue; // two left turns pass in front of each other
        const rem = o.piece.length - o.s;
        if ((rem < 35 && o.speed > 2) || rem < 8) return true;
      } else if (o.piece.kind === 'turn' && o.piece.toI === i && o.piece.toJ === j && o.piece.from === back) {
        if (turnKind(o.piece.from, o.piece.dir) !== 'left') return true;
      }
    }
    return false;
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
      // Overlapping lengthwise (plus a little), and on the side we're heading to, within
      // reach of where we're going.
      if (Math.abs(along) < car.halfLength + o.halfLength + 0.8 && side * dl > 0 && Math.abs(side) < Math.abs(dl) + 2.1) return true;
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
   * Lane decisions, a couple of times a second. Town roads: simplified MOBIL (switch if it
   * pays and it's safe; keep right unless passing; get into the lane for the next turn).
   * Country roads: overtake slow cars through the oncoming lane when it's clear.
   */
  private decideLane(car: TrafficCar, v0: number): void {
    const p = car.piece;
    if (p.kind !== 'lane') return;
    const remaining = p.length - car.s;
    if (p.rural) {
      this.decideOvertake(car, v0);
      return;
    }
    if (Math.abs(car.lat - car.latTarget) > 0.2 || remaining < 14) return; // mid-change / too late
    const current = car.latTarget;
    const other = current === 0 ? LANE_SPACING : 0;
    // Near the end of the block: the lane for the turn (right → right lane, left → left).
    const kind = turnKind(p.dir, car.exit);
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
   * The car's lane and the country lanes that carry straight on after it, through nodes
   * where the road simply continues (no junction, no lights, no bend), with the distance
   * from the car to the start of each (≤ 0 for its own lane).
   */
  private straightRun(car: TrafficCar): { lane: Piece; start: number }[] {
    const p = car.piece;
    const run = [{ lane: p, start: -car.s }];
    if (p.kind !== 'lane') return run;
    let lane = p;
    let start = -car.s;
    let first = true;
    while (start + lane.length < 300) {
      const { toI: i, toJ: j, dir } = lane;
      if (this.graph.isJunction(i, j) || this.graph.hasLights(i, j)) break;
      if (first ? car.exit !== dir : !this.graph.exits(i, j, dir).every((d) => d === dir)) break;
      const next = this.graph.lane(i, j, dir);
      if (!next || !next.rural) break;
      start += lane.length + 2 * this.graph.nodeHalf(i, j);
      lane = next;
      run.push({ lane, start });
      first = false;
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
        // A car on the reverse of this lane, or crossing the node at its far end.
        const end = start + lane.length;
        let ahead = Infinity;
        if (o.piece === this.graph.lane(lane.toI, lane.toJ, ((lane.dir + 2) % 4) as Dir)) ahead = end - o.s;
        else if (o.piece.kind === 'turn' && o.piece.toI === lane.toI && o.piece.toJ === lane.toJ && o.piece.from !== lane.dir) ahead = end;
        if (ahead > -5 && ahead < dist) return true;
      }
    }
    // The player: anything moving in the road ahead counts (straight-line check).
    const fx = Math.cos(car.currYaw);
    const fz = -Math.sin(car.currYaw);
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
    const runningOut =
      p.kind === 'lane' &&
      remaining < 15 &&
      (car.exit !== p.dir || this.graph.isJunction(p.toI, p.toJ) || this.graph.hasLights(p.toI, p.toJ));
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
    // directly); there are thousands of signal heads in the world.
    this.lightTimer -= dt;
    if (this.lightTimer <= 0) {
      this.lightTimer = 0.1;
      this.lights.update(this.time);
    }
    const player = this.playerPosition();
    this.obstacleList = this.obstacles();

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
        car.speed = 0;
        car.acc = 0;
        if (car.wrecked > WRECK_TIME) this.respawn(car);
        continue;
      }
      this.drive(car, dt);
    }
  }

  /** One fixed step of one car: decide, accelerate (IDM), move, change lanes, place. */
  private drive(car: TrafficCar, dt: number): void {
    const d = car.driver;
    this.buildRoute(car);
    // Wanted speed: the driver's pace on this road, capped by curves ahead and, near an
    // unsignalled junction, by the speed to enter it.
    let v0 = Math.min(this.desiredSpeed(car, car.piece), this.curveSpeed(car));
    const p = car.piece;
    if (p.kind === 'lane' && car.exit === p.dir && this.graph.isJunction(p.toI, p.toJ)) {
      const toEdge = Math.max(0, p.length - car.s - car.halfLength - 3);
      v0 = Math.min(v0, Math.sqrt(JUNCTION_SPEED * JUNCTION_SPEED + 2 * d.b * 0.8 * toEdge));
    }

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

    // Move on to the next piece: lane → turn through the intersection → next lane.
    while (car.s >= car.piece.length) {
      const piece = car.piece;
      if (piece.kind === 'lane') {
        // Unsignalled junction still busy: wait at its edge.
        if (this.graph.isJunction(piece.toI, piece.toJ) && this.junctionBusy(car, piece.toI, piece.toJ, piece.dir)) {
          car.s = piece.length - 0.01;
          car.speed = 0;
          break;
        }
        car.s -= piece.length;
        const turn = this.plannedTurn(car, piece);
        car.piece = turn;
        // Offsets are relative to the piece's own line: the turn already starts in the
        // lane it was aiming for, so what's left is only an unfinished lane change.
        car.lat -= turn.offIn;
        car.latTarget = 0;
        // Pick the exit for the lane after this turn.
        const next = this.graph.lane(turn.toI, turn.toJ, turn.dir)!;
        car.exit = this.chooseExit(next);
      } else {
        car.s -= piece.length;
        car.piece = this.graph.lane(piece.toI, piece.toJ, piece.dir)!;
        car.lat += piece.offOut;
        car.latTarget = piece.offOut;
      }
    }
    this.place(car);
    this.orientation(car.currYaw, car.currPitch, this.quat);
    car.body.setNextKinematicTranslation(car.currPos);
    car.body.setNextKinematicRotation(this.quat);
  }

  afterStep(): void {}

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
      let dyaw = car.currYaw - car.prevYaw;
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      this.orientation(car.prevYaw + dyaw * alpha, car.currPitch, this.quat);
      this.mat.compose(pos, this.quat, this.one);
      for (const m of meshes) m.setMatrixAt(car.slot, this.mat);
      // Brake lights: on while slowing down or standing.
      const braking = car.wrecked < 0 && (car.acc < -0.8 || car.speed < 0.3);
      this.brakeLights.get(car.type)!.setMatrixAt(car.slot, braking ? this.mat : this.mat.clone().scale(ZERO));
      // Wrecked: show the burnt body in place of the painted one.
      const wreck = this.wreckBodies.get(car.type)!;
      if (car.wrecked >= 0) {
        wreck.setMatrixAt(car.slot, this.mat);
        meshes[0].setMatrixAt(car.slot, this.mat.clone().scale(ZERO));
      } else {
        wreck.setMatrixAt(car.slot, this.mat.clone().scale(ZERO));
      }
    }
    // Wheels: four per car, positioned in the car's frame and spun about their axle.
    const carMat = new THREE.Matrix4();
    const local = new THREE.Matrix4();
    const spin = new THREE.Matrix4();
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

  /** Yaw about Y, then pitch about the car's own Z axis (its forward is +X, so +pitch = nose up). */
  private orientation(yaw: number, pitch: number, out: THREE.Quaternion): THREE.Quaternion {
    out.setFromAxisAngle(UP, yaw);
    return out.multiply(this.pitchQuat.setFromAxisAngle(Z_AXIS, pitch));
  }
  private readonly pitchQuat = new THREE.Quaternion();

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
    }));
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const ZERO = new THREE.Vector3(0, 0, 0);
const IDENTITY_QUAT = new THREE.Quaternion();
const SCALE = new THREE.Vector3();

/**
 * Traffic signals: a pole on the sidewalk corner before each intersection approach, with a
 * three-lamp head facing the oncoming lane. Lamps are unlit-material instances whose colour
 * is switched between bright (on) and dark (off).
 */
class TrafficLights {
  private readonly approaches: { i: number; j: number; d: Dir }[] = [];
  private readonly lamps: Record<Light, THREE.InstancedMesh>;
  private readonly state: Light[] = [];

  constructor(scene: THREE.Scene, world: RAPIER.World, graph: RoadGraph, terrain: Terrain) {
    const half = ROAD_WIDTH / 2;
    for (let i = 0; i < graph.size; i++) {
      for (let j = 0; j < graph.size; j++) {
        if (!graph.hasLights(i, j)) continue;
        for (const d of DIRS) {
          // An approach exists if a road arrives here travelling in direction d.
          if (graph.neighbor(i, j, ((d + 2) % 4) as Dir)) this.approaches.push({ i, j, d });
        }
      }
    }
    const n = this.approaches.length;
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.5, metalness: 0.6 });
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.09, 3.6, 8).translate(0, 1.8, 0), poleMat, n);
    const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 1.0, 0.32).translate(0, 3.25, 0), poleMat, n);
    pole.castShadow = head.castShadow = true;
    const lampGeo = new THREE.CircleGeometry(0.11, 12);
    const makeLamps = () => {
      const m = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
      scene.add(m);
      return m;
    };
    this.lamps = { red: makeLamps(), yellow: makeLamps(), green: makeLamps() };
    const lampY: Record<Light, number> = { red: 3.55, yellow: 3.25, green: 2.95 };

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    this.approaches.forEach(({ i, j, d }, k) => {
      const fwd = dirVector(d);
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      // On the sidewalk at the corner, on the right before the intersection.
      const base = graph
        .node(i, j)
        .addScaledVector(fwd, -(half + 0.8))
        .addScaledVector(right, half + 0.9);
      const turn = terrain.warpAngle(base.x, base.z);
      const w = terrain.toWorld(base.x, base.z);
      base.set(w.x, terrain.surfaceAt(w.x, w.z) - 0.05, w.z);
      fwd.applyAxisAngle(new THREE.Vector3(0, 1, 0), turn);
      // Face the head toward the oncoming traffic (−fwd). Circles face +Z by default.
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), fwd.clone().negate());
      m.compose(base, q, s);
      pole.setMatrixAt(k, m);
      head.setMatrixAt(k, m);
      for (const light of ['red', 'yellow', 'green'] as Light[]) {
        const lampPos = base.clone().addScaledVector(fwd, -0.17);
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
    this.approaches.forEach(({ i, j, d }, k) => {
      const light = lightState(i, j, d, time);
      if (!force && light === this.state[k]) return;
      this.state[k] = light;
      changed = true;
      for (const l of ['red', 'yellow', 'green'] as Light[]) {
        this.lamps[l].setColorAt(k, l === light ? TrafficLights.ON[l] : TrafficLights.OFF);
      }
    });
    if (changed) for (const l of ['red', 'yellow', 'green'] as Light[]) this.lamps[l].instanceColor!.needsUpdate = true;
  }
}
