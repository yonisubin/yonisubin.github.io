import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { SimEntity } from '../sim/entity';
import { Rng } from '../world/rng';
import { CURB_HEIGHT, ROAD_WIDTH, type CityLayout } from '../world/layout';
import {
  DIRS,
  RoadGraph,
  bezierPoint,
  bezierTangent,
  dirVector,
  lightState,
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
// respawned on a lane closer by.
//
// All traffic cars render through a handful of InstancedMeshes (one per car part per type).

const POOL_SIZE = 24;
const SPAWN_MIN = 60; // m from the player (closer spawns would pop in visibly)
const SPAWN_MAX = 220;
const DESPAWN = 260;
const CRUISE_SPEED = 11; // m/s ≈ 40 km/h
const TURN_SPEED = 6; // m/s through intersections
const ACCEL = 2.5; // m/s²
const BRAKE = 7; // m/s², maximum comfortable braking
const MIN_GAP = 2.5; // m bumper-to-bumper when stopped
const LANE_WIDTH_CHECK = 1.8; // m: things closer than this sideways are "in my lane"
const STOP_LINE_BACK = 4.4; // m before the intersection edge (behind the zebra crossing)
const TYPES: CarType[] = ['sedan', 'sedan', 'sedan', 'taxi', 'sedan', 'van'];

export interface TrafficCar {
  type: CarType;
  color: number;
  slot: number; // instance index within its type's meshes
  body: RAPIER.RigidBody;
  piece: Piece;
  /** Distance travelled along the current piece, m. */
  s: number;
  speed: number;
  wheelSpin: number;
  halfLength: number;
  prevPos: THREE.Vector3;
  currPos: THREE.Vector3;
  prevYaw: number;
  currYaw: number;
  active: boolean;
}

/** Things traffic must not drive into: the player (any mode), parked player cars, etc. */
export type ObstacleSource = () => THREE.Vector3[];

export class Traffic implements SimEntity {
  private readonly graph: RoadGraph;
  private readonly cars: TrafficCar[] = [];
  private readonly rng = new Rng(4242);
  private readonly meshes = new Map<CarType, THREE.InstancedMesh[]>();
  private readonly tyres: THREE.InstancedMesh;
  private readonly rims: THREE.InstancedMesh;
  private readonly lights: TrafficLights;
  private time = 0;

  // Scratch.
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly mat = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly one = new THREE.Vector3(1, 1, 1);

  constructor(
    world: RAPIER.World,
    scene: THREE.Scene,
    layout: CityLayout,
    /** Where the player is (cars spawn and despawn around this point). */
    private readonly playerPosition: () => THREE.Vector3,
    private readonly obstacles: ObstacleSource,
  ) {
    this.graph = new RoadGraph(layout);
    this.lights = new TrafficLights(scene, world, this.graph);

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
        piece: this.graph.lane(0, 0, 0)!,
        s: 0,
        speed: 0,
        wheelSpin: 0,
        halfLength: d.length / 2,
        prevPos: new THREE.Vector3(),
        currPos: new THREE.Vector3(),
        prevYaw: 0,
        currYaw: 0,
        active: false,
      });
    }
    // Fill the pool straight away (closer than usual is fine before the first frame).
    for (const car of this.cars) this.respawn(car, 25);
  }

  /** Put a car on a random free lane within spawning distance of the player. */
  private respawn(car: TrafficCar, minDist = SPAWN_MIN): void {
    const player = this.playerPosition();
    for (let attempt = 0; attempt < 40; attempt++) {
      const i = this.rng.int(0, this.graph.size - 1);
      const j = this.rng.int(0, this.graph.size - 1);
      const d = this.rng.pick(DIRS);
      const lane = this.graph.lane(i, j, d);
      if (!lane) continue;
      const s = this.rng.range(4, lane.length - 12);
      const p = bezierPoint(lane, s / lane.length, this.tmp);
      const dist = Math.hypot(p.x - player.x, p.z - player.z);
      if (dist < minDist || dist > SPAWN_MAX) continue;
      if (this.cars.some((o) => o !== car && o.active && o.currPos.distanceToSquared(p) < 15 * 15)) continue;
      car.piece = lane;
      car.s = s;
      car.speed = CRUISE_SPEED * 0.6;
      car.active = true;
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

  /** Update the car's position/heading from its piece and distance. */
  private place(car: TrafficCar): void {
    const t = Math.min(1, car.s / car.piece.length);
    bezierPoint(car.piece, t, car.currPos);
    car.currPos.y = 0;
    const tan = bezierTangent(car.piece, t, this.tmp2);
    car.currYaw = Math.atan2(-tan.z, tan.x); // model forward is +X
  }

  /**
   * Free distance ahead (m) before this car must stop: the gap to the nearest thing in its
   * lane ahead, or to a red light's stop line.
   */
  private freeDistance(car: TrafficCar, obstacles: THREE.Vector3[]): number {
    const fwd = this.tmp2.set(Math.cos(car.currYaw), 0, -Math.sin(car.currYaw));
    let free = Infinity;
    const consider = (p: THREE.Vector3, otherHalfLength: number) => {
      const rx = p.x - car.currPos.x;
      const rz = p.z - car.currPos.z;
      const along = rx * fwd.x + rz * fwd.z;
      if (along <= 0 || along > 40) return;
      const lateral = Math.abs(rx * fwd.z - rz * fwd.x);
      if (lateral > LANE_WIDTH_CHECK) return;
      free = Math.min(free, along - car.halfLength - otherHalfLength - MIN_GAP);
    };
    for (const o of this.cars) if (o !== car && o.active) consider(o.currPos, o.halfLength);
    for (const p of obstacles) consider(p, 1);

    // Red (or late-yellow) light ahead on this lane: stop at the stop line.
    if (car.piece.kind === 'lane') {
      const stopS = car.piece.length - STOP_LINE_BACK - car.halfLength;
      const toStop = stopS - car.s;
      if (toStop > -0.5) {
        const light = lightState(car.piece.toI, car.piece.toJ, car.piece.dir, this.time);
        const canStop = toStop > (car.speed * car.speed) / (2 * BRAKE * 0.6);
        if (light === 'red' || (light === 'yellow' && canStop)) free = Math.min(free, Math.max(0, toStop));
      }
    }
    return free;
  }

  fixedUpdate(dt: number): void {
    this.time += dt;
    this.lights.update(this.time);
    const player = this.playerPosition();
    const obstacles = this.obstacles();

    for (const car of this.cars) {
      if (!car.active) {
        this.respawn(car);
        continue;
      }
      if (Math.hypot(car.currPos.x - player.x, car.currPos.z - player.z) > DESPAWN) {
        this.respawn(car);
        continue;
      }

      // Speed control: cruise (slower in turns), but never faster than lets us stop within
      // the free distance ahead: v_max = √(2·a·d) is the speed you can brake from in d metres.
      const free = this.freeDistance(car, obstacles);
      const cruise = car.piece.kind === 'turn' ? TURN_SPEED : CRUISE_SPEED;
      const target = Math.min(cruise, Math.sqrt(2 * BRAKE * 0.6 * Math.max(0, free)));
      if (target > car.speed) car.speed = Math.min(target, car.speed + ACCEL * dt);
      else car.speed = Math.max(target, car.speed - BRAKE * 1.5 * dt);
      if (free <= 0) car.speed = 0;

      car.prevPos.copy(car.currPos);
      car.prevYaw = car.currYaw;
      car.s += car.speed * dt;
      car.wheelSpin += (car.speed * dt) / CAR_DIMENSIONS[car.type].wheelRadius;

      // Move on to the next piece: lane → turn through the intersection → next lane.
      while (car.s >= car.piece.length) {
        car.s -= car.piece.length;
        const p = car.piece;
        if (p.kind === 'lane') {
          const exits = this.graph.exits(p.toI, p.toJ, p.dir);
          // Mostly straight on, sometimes turn.
          const straight = exits.includes(p.dir) && this.rng.chance(0.55);
          const next: Dir = straight ? p.dir : this.rng.pick(exits);
          car.piece = this.graph.turn(p.toI, p.toJ, p.dir, next);
        } else {
          car.piece = this.graph.lane(p.toI, p.toJ, p.dir)!;
        }
      }
      this.place(car);
      this.quat.setFromAxisAngle(UP, car.currYaw);
      car.body.setNextKinematicTranslation(car.currPos);
      car.body.setNextKinematicRotation(this.quat);
    }
  }

  afterStep(): void {}

  render(alpha: number): void {
    const pos = this.tmp;
    for (const car of this.cars) {
      const meshes = this.meshes.get(car.type)!;
      if (!car.active) {
        // Hidden: zero scale.
        this.mat.makeScale(0, 0, 0);
        for (const m of meshes) m.setMatrixAt(car.slot, this.mat);
        continue;
      }
      pos.lerpVectors(car.prevPos, car.currPos, alpha);
      let dyaw = car.currYaw - car.prevYaw;
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      this.quat.setFromAxisAngle(UP, car.prevYaw + dyaw * alpha);
      this.mat.compose(pos, this.quat, this.one);
      for (const m of meshes) m.setMatrixAt(car.slot, this.mat);
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
      this.meshes.get(car.type)![0].getMatrixAt(car.slot, carMat);
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
    for (const list of this.meshes.values()) {
      for (const m of list) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    }
    this.tyres.instanceMatrix.needsUpdate = true;
    this.rims.instanceMatrix.needsUpdate = true;
  }

  /** The nearest traffic car within `radius` that's slow enough to carjack, if any. */
  jackable(position: THREE.Vector3, radius: number): TrafficCar | null {
    let best: TrafficCar | null = null;
    let bestDist = radius;
    for (const car of this.cars) {
      if (!car.active || car.speed > 4) continue;
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

  /** Positions of active traffic cars (for pedestrians and debugging). */
  positions(): THREE.Vector3[] {
    return this.cars.filter((c) => c.active).map((c) => c.currPos);
  }

  /** For tests: the cars' states. */
  get debugCars(): { pos: THREE.Vector3; speed: number; kind: string; active: boolean }[] {
    return this.cars.map((c) => ({ pos: c.currPos, speed: c.speed, kind: c.piece.kind, active: c.active }));
  }
}

const UP = new THREE.Vector3(0, 1, 0);
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

  constructor(scene: THREE.Scene, world: RAPIER.World, graph: RoadGraph) {
    const half = ROAD_WIDTH / 2;
    for (let i = 0; i < graph.size; i++) {
      for (let j = 0; j < graph.size; j++) {
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
      base.y = CURB_HEIGHT;
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
