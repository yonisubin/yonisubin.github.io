// The police: patrol cars, pursuits, officers, roadblocks and a helicopter, scaled by the
// wanted level (game/wanted.ts).
//
//   0 stars  two patrol cars cruise the roads near you (they're also witnesses)
//   1–2      pursuit: 2 cars per star chase you along the roads and ram you; stopped next
//            to you, a car drops two officers who try to arrest you (npc/pedestrians.ts)
//   3+       officers shoot
//   4+       roadblocks: two cars parked across the road ahead of you
//   5        a helicopter circles overhead (it always sees you) and shoots now and then
//
// Police cars aren't physics-driven (like traffic): each is a kinematic body moved along a
// path, so it shoves the player's car around when it rams it. How they drive:
//
//   Far away they follow an A* route to you on the street network (game/route.ts,
//   recomputed every ~1.5 s, staggered between cars). Close (< 45 m) with a clear line of
//   sight they leave the road and steer straight at where you'll be in half a second.
//   Steering is "pure pursuit": aim at a point a speed-dependent distance L ahead on the
//   path. For a car with wheelbase W, reaching a point at angle α off its nose takes a
//   circle of radius R = L / (2 sin α), so the steering angle is atan(W / R) (clamped) and
//   the yaw rate is speed · tan(steer) / W (the bicycle model). Speed is capped so the
//   sideways acceleration v²/R stays under ~7 m/s² — they brake for corners.
//
// Busted: in a vehicle, nearly stopped with a police car within a few metres for
// BUST_TIME seconds; on foot, officers do it (pedestrians.ts).

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { SimEntity } from '../sim/entity';
import type { StreetNet } from '../world/streets';
import type { Terrain } from '../world/terrain';
import { WATER_Y } from '../world/terrain';
import { Router } from '../game/route';
import { buildCarBody, buildWheel, CAR_DIMENSIONS } from '../vehicles/carModel';
import { buildHelicopter, type HeliModel } from '../vehicles/heliModel';
import type { Pedestrians } from './pedestrians';
import type { Smoke } from '../sim/smoke';
import { Rng } from '../world/rng';

const DIM = CAR_DIMENSIONS.sedan;
const POOL = 8;
const PATROLS = 2;
const MAX_PURSUIT = 6;
const SPAWN_MIN = 230; // m from the player
const SPAWN_MAX = 400;
const PURSUIT_SPEED = 30; // m/s (~108 km/h)
const PATROL_SPEED = 13;
const ACCEL = 7; // m/s²
const BRAKE = 11;
const LAT_ACC = 7; // m/s², cornering limit
const MAX_STEER = 0.6; // rad
const DIRECT_RANGE = 45; // m: closer than this (and in sight) they drive straight at you
const SEE_RANGE = 120; // m
const ROUTE_EVERY = 1.5; // s
const HEALTH = 100;
const BUST_TIME = 3; // s
const BUST_RANGE = 6.5; // m
const DROP_RANGE = 22; // m: officers get out when the car stops this close to you on foot
const RESUME_RANGE = 70; // m: you got away from the parked car → it drives on
const ROADBLOCK_EVERY = 25; // s
const ROADBLOCK_AHEAD = 230; // m along the road
const HELI_HEIGHT = 38; // m above the ground
const HELI_SHOT_EVERY = 2.4; // s
const HELI_DAMAGE = 7;

type Role = 'off' | 'patrol' | 'pursuit' | 'block' | 'wreck';

interface Unit {
  group: THREE.Group;
  wheels: THREE.Group[];
  red: THREE.MeshBasicMaterial;
  blue: THREE.MeshBasicMaterial;
  body: RAPIER.RigidBody;
  role: Role;
  prevPos: THREE.Vector3;
  pos: THREE.Vector3;
  prevYaw: number;
  yaw: number;
  pitch: number;
  speed: number;
  wheelSpin: number;
  health: number;
  /** Route to the target (x, z pairs), the index we're near on it, and how old it is. */
  route: number[] | null;
  routeIdx: number;
  routeAge: number;
  /** Patrol destination. */
  goal: { x: number; z: number } | null;
  sees: boolean;
  seeTimer: number;
  /** Officers are out: the car waits where it is. */
  parked: boolean;
  /** Seconds since it was wrecked / became a roadblock. */
  time: number;
  stuck: number;
  smokeTimer: number;
}

export interface PoliceHooks {
  /** Where the player is, how fast they're going, and what they're in. */
  player(): { position: THREE.Vector3; velocity: THREE.Vector3; onFoot: boolean; body: RAPIER.RigidBody | null };
  stars(): number;
  /** Each step: whether any police can see the player. */
  setSeen(seen: boolean): void;
  /** The player hurt the police (shot or rammed a police car). */
  attacked(): void;
  busted(): void;
  /** 0 = day … 1 = night (for the helicopter's searchlight). */
  night(): number;
  /** Something fired at the player (apply damage if `hit`). */
  shoot(from: THREE.Vector3, to: THREE.Vector3, hit: boolean, damage: number): void;
  /** Traffic positions, to slow down behind. */
  traffic(): THREE.Vector3[];
}

const UP = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

export class Police implements SimEntity {
  private readonly units: Unit[] = [];
  private readonly router: Router;
  private readonly rng = new Rng(9110);
  private readonly heli: HeliModel;
  private readonly spot: THREE.SpotLight;
  private heliOn = false;
  private readonly heliPos = new THREE.Vector3(0, -1000, 0);
  private readonly heliPrev = new THREE.Vector3(0, -1000, 0);
  private heliYaw = 0;
  private heliAngle = 0;
  private heliShot = HELI_SHOT_EVERY;
  private roadblockTimer = 10;
  private bustTimer = 0;
  private attackCooldown = 0;
  private flash = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly pitchQuat = new THREE.Quaternion();
  smoke: Smoke | null = null;
  /** For tests: what happened lately. */
  readonly stats = { spawned: 0, roadblocks: 0, dropped: 0, busted: 0 };

  constructor(
    private readonly world: RAPIER.World,
    scene: THREE.Scene,
    private readonly net: StreetNet,
    private readonly terrain: Terrain,
    private readonly camera: THREE.Camera,
    private readonly peds: Pedestrians | null,
    private readonly hooks: PoliceHooks,
  ) {
    this.router = new Router(net);
    for (let k = 0; k < POOL; k++) this.units.push(this.makeUnit(scene));
    this.heli = buildHelicopter(0x1a3a7a);
    this.heli.root.visible = false;
    scene.add(this.heli.root);
    this.spot = new THREE.SpotLight(0xfff4d6, 0, 140, 0.22, 0.6, 1.2);
    this.spot.visible = false;
    scene.add(this.spot, this.spot.target);
  }

  /** A white sedan with navy stripes and a red/blue light bar. */
  private makeUnit(scene: THREE.Scene): Unit {
    const group = new THREE.Group();
    group.add(buildCarBody('sedan', 0xf2f2f0));
    const navy = new THREE.MeshStandardMaterial({ color: 0x1a2f66, roughness: 0.5 });
    for (const side of [-1, 1]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.2, 0.02), navy);
      stripe.position.set(-0.1, 0.78, side * (DIM.width / 2 + 0.005));
      group.add(stripe);
    }
    const red = new THREE.MeshBasicMaterial({ color: 0x551111 });
    const blue = new THREE.MeshBasicMaterial({ color: 0x111a55 });
    const bar = new THREE.Group();
    const left = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.5), red);
    const right = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.5), blue);
    left.position.z = -0.27;
    right.position.z = 0.27;
    bar.add(left, right);
    bar.position.set(-0.25, 1.47, 0);
    group.add(bar);
    const wheels: THREE.Group[] = [];
    for (const [x, z] of [
      [DIM.wheelBase / 2, DIM.track / 2],
      [DIM.wheelBase / 2, -DIM.track / 2],
      [-DIM.wheelBase / 2, DIM.track / 2],
      [-DIM.wheelBase / 2, -DIM.track / 2],
    ]) {
      const w = buildWheel(DIM.wheelRadius);
      w.position.set(x, DIM.wheelRadius, z);
      group.add(w);
      wheels.push(w);
    }
    group.visible = false;
    scene.add(group);
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -500, 0));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(...DIM.boxHalf).setTranslation(...DIM.boxCenter), body);
    body.setEnabled(false);
    return {
      group,
      wheels,
      red,
      blue,
      body,
      role: 'off',
      prevPos: new THREE.Vector3(),
      pos: new THREE.Vector3(),
      prevYaw: 0,
      yaw: 0,
      pitch: 0,
      speed: 0,
      wheelSpin: 0,
      health: HEALTH,
      route: null,
      routeIdx: 0,
      routeAge: 0,
      goal: null,
      sees: false,
      seeTimer: 0,
      parked: false,
      time: 0,
      stuck: 0,
      smokeTimer: 0,
    };
  }

  // ------------------------------------------------------------------ public API

  /** Positions of police cars chasing you or blocking roads (for the maps). */
  markers(): THREE.Vector3[] {
    const out = this.units.filter((u) => u.role === 'pursuit' || u.role === 'block').map((u) => u.pos);
    if (this.heliOn) out.push(this.heliPos);
    return out;
  }

  /** Police cars with sirens on (chasing or blocking), for the sound. */
  sirens(): THREE.Vector3[] {
    return this.units.filter((u) => u.role === 'pursuit' || u.role === 'block').map((u) => u.pos);
  }

  /** The police helicopter's position while it's up, else null. */
  get helicopter(): THREE.Vector3 | null {
    return this.heliOn ? this.heliPos : null;
  }

  /** Can any police (cars, officers, helicopter) see this point right now? */
  witnesses(position: THREE.Vector3): boolean {
    if (this.heliOn) return true;
    if (this.peds?.copNear(position, 40)) return true;
    return this.units.some((u) => u.role !== 'off' && u.role !== 'wreck' && u.pos.distanceTo(position) < SEE_RANGE && this.lineOfSight(u, position));
  }

  /** A bullet hit `collider`: if it's a police car, damage it. Returns true if it was one. */
  damageCollider(collider: RAPIER.Collider, amount: number): boolean {
    const body = collider.parent();
    const unit = body && this.units.find((u) => u.role !== 'off' && u.body.handle === body.handle);
    if (!unit) return false;
    this.attacked();
    if (unit.role === 'wreck') return true;
    unit.health -= amount;
    if (unit.health <= 0) {
      unit.health = 0;
      unit.role = 'wreck';
      unit.speed = 0;
      unit.time = 0;
    }
    return true;
  }

  /** Everyone goes home (busted, died, new game). */
  reset(): void {
    for (const u of this.units) this.despawn(u);
    this.peds?.dismissCops();
    this.heliOn = false;
    this.heli.root.visible = false;
    this.spot.visible = false;
    this.bustTimer = 0;
  }

  // ------------------------------------------------------------------ simulation

  fixedUpdate(dt: number): void {
    const player = this.hooks.player();
    const stars = this.hooks.stars();
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.manageUnits(player.position, stars);
    let seen = false;
    for (const u of this.units) {
      if (u.role === 'off') continue;
      u.prevPos.copy(u.pos);
      u.prevYaw = u.yaw;
      u.time += dt;
      // Line of sight, a few times a second.
      u.seeTimer -= dt;
      if (u.seeTimer <= 0) {
        u.seeTimer = 0.4;
        u.sees = u.role !== 'wreck' && u.pos.distanceTo(player.position) < SEE_RANGE && this.lineOfSight(u, player.position);
      }
      if (u.sees) seen = true;
      if (u.role === 'pursuit' || u.role === 'patrol') this.drive(u, player, dt);
      else u.speed = 0;
      this.pose(u);
      this.checkRam(u, player);
    }
    if (this.peds?.copNear(player.position, 40)) seen = true;
    this.updateHeli(player, stars, dt);
    if (this.heliOn) seen = true;
    this.hooks.setSeen(seen);
    this.updateRoadblock(player, stars, dt);
    this.checkBusted(player, stars, dt);
  }

  afterStep(): void {}

  /** Spawn, retire and re-task cars so the right number are out for the wanted level. */
  private manageUnits(player: THREE.Vector3, stars: number): void {
    const wantPursuit = Math.min(MAX_PURSUIT, stars * 2);
    const chasing = this.units.filter((u) => u.role === 'pursuit').length;
    // Patrols join the chase first.
    if (stars > 0 && chasing < wantPursuit) {
      const patrol = this.units.find((u) => u.role === 'patrol');
      if (patrol) {
        patrol.role = 'pursuit';
        patrol.route = null;
        return;
      }
      const free = this.units.find((u) => u.role === 'off');
      if (free && this.spawn(free, player, 'pursuit')) this.stats.spawned++;
      return;
    }
    if (stars === 0) {
      // Pursuers go back to patrolling (and the ones far away just leave).
      for (const u of this.units) {
        if (u.role !== 'pursuit') continue;
        u.parked = false;
        u.role = 'patrol';
        u.goal = null;
        u.route = null;
      }
      if (this.peds && this.peds.copsOut > 0) this.peds.dismissCops(true, player);
      const patrols = this.units.filter((u) => u.role === 'patrol');
      if (patrols.length < PATROLS) {
        const free = this.units.find((u) => u.role === 'off');
        if (free) this.spawn(free, player, 'patrol');
      }
      for (const u of patrols.slice(PATROLS)) if (!this.visible(u.pos, player)) this.despawn(u);
    }
    for (const u of this.units) {
      if (u.role === 'off') continue;
      const dist = u.pos.distanceTo(player);
      // Too far away to matter: recycle (pursuers get respawned nearer).
      if (dist > 650 || (u.role === 'patrol' && dist > 500)) this.despawn(u);
      else if (u.role === 'wreck' && u.time > 30 && !this.visible(u.pos, player)) this.despawn(u);
      else if (u.role === 'block' && (u.time > 45 || (dist > 160 && u.time > 8)) && !this.visible(u.pos, player)) this.despawn(u);
    }
  }

  /** Put a car on a road SPAWN_MIN–SPAWN_MAX from the player, preferably out of view. */
  private spawn(u: Unit, player: THREE.Vector3, role: Role): boolean {
    const edges: number[] = [];
    this.net.index.forEachNear(player.x, player.z, SPAWN_MAX, (e) => edges.push(e));
    if (!edges.length) return false;
    const at = { x: 0, z: 0, tx: 0, tz: 0 };
    for (let attempt = 0; attempt < 40; attempt++) {
      const edge = this.net.edges[edges[this.rng.int(0, edges.length - 1)]];
      this.net.pointAt(edge, this.rng.range(0, edge.length), at);
      const d = Math.hypot(at.x - player.x, at.z - player.z);
      if (d < SPAWN_MIN || d > SPAWN_MAX) continue;
      if (this.terrain.smoothHeight(at.x, at.z) < WATER_Y + 0.3) continue;
      if (attempt < 30 && this.visible(this.tmp.set(at.x, 0, at.z), player)) continue;
      // Face along the road, whichever way points more toward the player.
      const toward = (player.x - at.x) * at.tx + (player.z - at.z) * at.tz > 0 ? 1 : -1;
      this.place(u, at.x, at.z, Math.atan2(-at.tz * toward, at.tx * toward), role);
      return true;
    }
    return false;
  }

  private place(u: Unit, x: number, z: number, yaw: number, role: Role): void {
    u.role = role;
    u.pos.set(x, this.terrain.smoothHeight(x, z), z);
    u.prevPos.copy(u.pos);
    u.yaw = u.prevYaw = yaw;
    u.speed = role === 'pursuit' ? 10 : 0;
    u.health = HEALTH;
    u.route = null;
    u.routeAge = this.rng.range(0, ROUTE_EVERY); // stagger route searches between cars
    u.goal = null;
    u.parked = false;
    u.time = 0;
    u.stuck = 0;
    u.sees = false;
    u.body.setEnabled(true);
    u.body.setTranslation(u.pos, true);
    u.group.visible = true;
  }

  private despawn(u: Unit): void {
    u.role = 'off';
    u.group.visible = false;
    u.body.setEnabled(false);
    u.parked = false;
  }

  /** Roughly in front of the camera and not too far: the player might be looking at it. */
  private visible(p: THREE.Vector3, player: THREE.Vector3): boolean {
    const d = Math.hypot(p.x - player.x, p.z - player.z);
    if (d < 60) return true;
    if (d > 350) return false;
    const view = this.camera.getWorldDirection(this.tmp2);
    const dx = p.x - this.camera.position.x;
    const dz = p.z - this.camera.position.z;
    return (view.x * dx + view.z * dz) / (Math.hypot(view.x, view.z) * Math.hypot(dx, dz) || 1) > 0.35;
  }
  private readonly tmp2 = new THREE.Vector3();

  /** Clear view from the car's driver seat to the player's chest (hills and buildings block it). */
  private lineOfSight(u: Unit, target: THREE.Vector3): boolean {
    return this.clear(this.tmp3.set(u.pos.x, u.pos.y + 1.4, u.pos.z), target, u.body);
  }
  private readonly tmp3 = new THREE.Vector3();

  /** Nothing solid between `from` and `to` except near `to` (the player or their car). */
  clear(from: THREE.Vector3, to: THREE.Vector3, exclude?: RAPIER.RigidBody): boolean {
    const dir = new THREE.Vector3(to.x - from.x, to.y + 0.4 - from.y, to.z - from.z);
    const dist = dir.length();
    if (dist < 1) return true;
    dir.divideScalar(dist);
    const hit = this.world.castRay(new RAPIER.Ray(from, dir), dist, true, undefined, undefined, undefined, exclude);
    return !hit || hit.timeOfImpact > dist - 3.5;
  }

  // ------------------------------------------------------------------ driving

  private drive(u: Unit, player: ReturnType<PoliceHooks['player']>, dt: number): void {
    const pursuit = u.role === 'pursuit';
    const p = player.position;
    const dist = Math.hypot(p.x - u.pos.x, p.z - u.pos.z);
    // A car that has dropped its officers waits until you've got away from it.
    if (pursuit && u.parked) {
      u.speed = Math.max(0, u.speed - BRAKE * dt);
      if (dist > RESUME_RANGE || !player.onFoot) {
        u.parked = false;
        this.peds?.dismissCops(true, p);
      }
      return;
    }
    if (pursuit && player.onFoot && dist < DROP_RANGE && u.speed < 3 && !u.parked) {
      // Stop and send two officers after you.
      u.parked = true;
      const rx = Math.sin(u.yaw);
      const rz = Math.cos(u.yaw);
      let n = 0;
      for (const side of [-1, 1]) if (this.peds?.summonCop(u.pos.x + rx * side * 2.3, u.pos.z + rz * side * 2.3)) n++;
      this.stats.dropped += n;
      return;
    }
    // Where to aim.
    let tx: number;
    let tz: number;
    let targetSpeed = pursuit ? PURSUIT_SPEED : PATROL_SPEED;
    const direct = pursuit && dist < DIRECT_RANGE && u.sees;
    if (direct) {
      // Straight at where the player will be in half a second.
      tx = p.x + player.velocity.x * 0.5;
      tz = p.z + player.velocity.z * 0.5;
      const playerSpeed = Math.hypot(player.velocity.x, player.velocity.z);
      // On foot, or stopped in a car: pull up beside them and box them in (officers get
      // out / the bust timer runs). Driving: ram, a little faster than they're going.
      if (!player.onFoot && playerSpeed >= 2) targetSpeed = playerSpeed + 5;
    } else {
      if (!pursuit && (!u.goal || Math.hypot(u.goal.x - u.pos.x, u.goal.z - u.pos.z) < 25)) {
        // Patrol: somewhere on the roads 300–600 m away.
        const a = this.rng.range(0, Math.PI * 2);
        const r = this.rng.range(300, 600);
        const near = this.net.nearest(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, 400);
        u.goal = near ? { x: near.x, z: near.z } : { x: p.x, z: p.z };
        u.route = null;
      }
      const goal = pursuit ? p : u.goal!;
      u.routeAge += dt;
      if (!u.route || u.routeAge > ROUTE_EVERY * (pursuit ? 1 : 6)) {
        u.routeAge = 0;
        u.route = this.router.find(u.pos.x, u.pos.z, goal.x, goal.z, 'drive')?.pts ?? null;
        u.routeIdx = 0;
      }
      if (!u.route) {
        tx = goal.x;
        tz = goal.z;
      } else {
        [tx, tz] = this.lookAhead(u, 5 + u.speed * 0.55);
      }
    }
    // Pure pursuit steering toward (tx, tz).
    const fx = Math.cos(u.yaw);
    const fz = -Math.sin(u.yaw);
    const dx = tx - u.pos.x;
    const dz = tz - u.pos.z;
    const L = Math.max(2, Math.hypot(dx, dz));
    // Signed angle from the nose to the target, positive toward increasing yaw (forward is
    // (cos yaw, −sin yaw), so turning that way moves the nose toward (−sin yaw, −cos yaw)).
    const alpha = Math.atan2(fz * dx - fx * dz, fx * dx + fz * dz);
    const sinA = Math.sin(alpha);
    const steer = THREE.MathUtils.clamp(Math.atan((2 * DIM.wheelBase * sinA) / L), -MAX_STEER, MAX_STEER);
    // Cornering limit: v² / R ≤ LAT_ACC, with R = L / (2 |sin α|).
    if (Math.abs(sinA) > 0.02) targetSpeed = Math.min(targetSpeed, Math.sqrt((LAT_ACC * L) / (2 * Math.abs(sinA))));
    if (Math.abs(alpha) > 1.6) targetSpeed = Math.min(targetSpeed, 6); // turning round
    // Slow down behind traffic (unless ramming the player).
    if (!direct) targetSpeed = Math.min(targetSpeed, this.clearAhead(u, fx, fz));
    // Pull up beside a player on foot or one who's stopped (box them in; officers get out /
    // the bust timer runs) rather than ploughing into them: never faster than lets the car
    // stop 5 m short, v = √(2·a·d) with a gentle a. On foot and close: just stop.
    const playerSpeed = Math.hypot(player.velocity.x, player.velocity.z);
    // Near a moving player, close in gently: no faster than the player's speed along our
    // heading plus a margin that shrinks to 5 m/s as we get close. Rams are nudges, not
    // head-on smashes (a kinematic car is immovable, so the player would take it all).
    if (pursuit && dist < 60) {
      const along = Math.max(0, player.velocity.x * fx + player.velocity.z * fz);
      targetSpeed = Math.min(targetSpeed, along + 5 + Math.max(0, dist - 12) * 0.8);
    }
    if (pursuit && (player.onFoot || playerSpeed < 2)) {
      targetSpeed = Math.min(targetSpeed, Math.sqrt(2 * BRAKE * 0.6 * Math.max(0, dist - 5)));
      if (player.onFoot && dist < DROP_RANGE) targetSpeed = 0;
    }
    // Never drive into the water.
    const ahead = 4 + u.speed * 0.6;
    if (this.terrain.smoothHeight(u.pos.x + fx * ahead, u.pos.z + fz * ahead) < WATER_Y + 0.2) targetSpeed = 0;
    const dv = targetSpeed - u.speed;
    u.speed += THREE.MathUtils.clamp(dv, -BRAKE * dt, ACCEL * dt);
    // Bicycle model: yaw rate = v · tan(steer) / wheelbase. (Yaw grows counter-clockwise seen
    // from above, and α > 0 means the target is to that side.)
    u.yaw += ((u.speed * Math.tan(steer)) / DIM.wheelBase) * dt;
    u.pos.x += Math.cos(u.yaw) * u.speed * dt;
    u.pos.z += -Math.sin(u.yaw) * u.speed * dt;
    // Stuck behind something for a while far from the player: try again from elsewhere.
    u.stuck = u.speed < 1 && !direct ? u.stuck + dt : 0;
    if (u.stuck > 6 && dist > 60) {
      if (!this.spawn(u, p, u.role)) this.despawn(u);
    }
  }

  /** The point `L` metres ahead along the route, starting from the nearest route point. */
  private lookAhead(u: Unit, L: number): [number, number] {
    const pts = u.route!;
    const n = pts.length / 2;
    // Advance the index while the next point is closer than the current one.
    let i = u.routeIdx;
    const d2 = (k: number) => (pts[k * 2] - u.pos.x) ** 2 + (pts[k * 2 + 1] - u.pos.z) ** 2;
    for (let k = i + 1; k < Math.min(n, i + 25); k++) if (d2(k) < d2(i)) i = k;
    u.routeIdx = i;
    let left = L;
    let x = pts[i * 2];
    let z = pts[i * 2 + 1];
    for (let k = i + 1; k < n; k++) {
      const nx = pts[k * 2];
      const nz = pts[k * 2 + 1];
      const seg = Math.hypot(nx - x, nz - z);
      if (seg >= left) {
        const f = left / seg;
        return [x + (nx - x) * f, z + (nz - z) * f];
      }
      left -= seg;
      x = nx;
      z = nz;
    }
    return [x, z];
  }

  /** Speed that keeps a safe gap to traffic and other police cars ahead. */
  private clearAhead(u: Unit, fx: number, fz: number): number {
    let limit = Infinity;
    const check = (q: THREE.Vector3) => {
      const dx = q.x - u.pos.x;
      const dz = q.z - u.pos.z;
      const along = dx * fx + dz * fz;
      if (along < 0.5 || along > 25) return;
      if (Math.abs(dx * -fz + dz * fx) > 2.4) return;
      limit = Math.min(limit, Math.max(0, (along - 6) * 1.2));
    };
    for (const q of this.hooks.traffic()) check(q);
    for (const o of this.units) if (o !== u && o.role !== 'off') check(o.pos);
    // Waiting long behind a jam: squeeze past (ghosting slowly through is better than stuck).
    return u.stuck > 2 ? Math.max(limit, 5) : limit;
  }

  /** Height and pitch from the road; move the kinematic body there. */
  private pose(u: Unit): void {
    const fx = Math.cos(u.yaw);
    const fz = -Math.sin(u.yaw);
    const h = DIM.wheelBase / 2;
    const front = this.terrain.smoothHeight(u.pos.x + fx * h, u.pos.z + fz * h);
    const back = this.terrain.smoothHeight(u.pos.x - fx * h, u.pos.z - fz * h);
    u.pos.y = (front + back) / 2;
    u.pitch = Math.atan2(front - back, DIM.wheelBase);
    this.orientation(u.yaw, u.pitch, this.quat);
    u.body.setNextKinematicTranslation(u.pos);
    u.body.setNextKinematicRotation(this.quat);
  }

  private orientation(yaw: number, pitch: number, out: THREE.Quaternion): THREE.Quaternion {
    out.setFromAxisAngle(UP, yaw);
    return out.multiply(this.pitchQuat.setFromAxisAngle(Z_AXIS, pitch));
  }

  /** The player driving hard into a police car counts as attacking the police. */
  private checkRam(u: Unit, player: ReturnType<PoliceHooks['player']>): void {
    if (player.onFoot || u.role === 'off' || u.role === 'wreck') return;
    const dx = u.pos.x - player.position.x;
    const dz = u.pos.z - player.position.z;
    const d = Math.hypot(dx, dz);
    if (d > 4.2 || d < 0.01) return;
    // Player's speed toward the police car, and the police car's toward the player: only
    // count it when the player did the ramming.
    const closing = (player.velocity.x * dx + player.velocity.z * dz) / d;
    const theirs = (u.speed * (Math.cos(u.yaw) * -dx + -Math.sin(u.yaw) * -dz)) / d;
    if (closing > 9 && closing > theirs + 3) this.attacked();
  }

  private attacked(): void {
    if (this.attackCooldown > 0) return;
    this.attackCooldown = 3;
    this.hooks.attacked();
  }

  // ------------------------------------------------------------------ busted, roadblocks, helicopter

  private checkBusted(player: ReturnType<PoliceHooks['player']>, stars: number, dt: number): void {
    if (stars === 0 || player.onFoot) {
      this.bustTimer = 0;
      return;
    }
    const slow = Math.hypot(player.velocity.x, player.velocity.z) < 1;
    const close = this.units.some(
      (u) => (u.role === 'pursuit' || u.role === 'block') && Math.hypot(u.pos.x - player.position.x, u.pos.z - player.position.z) < BUST_RANGE,
    );
    this.bustTimer = slow && close ? this.bustTimer + dt : 0;
    if (this.bustTimer > BUST_TIME) {
      this.bustTimer = 0;
      this.stats.busted++;
      this.hooks.busted();
    }
  }

  /** Seconds left before you're busted (for the HUD), or null. */
  get bustProgress(): number | null {
    return this.bustTimer > 0.3 ? this.bustTimer / BUST_TIME : null;
  }

  private updateRoadblock(player: ReturnType<PoliceHooks['player']>, stars: number, dt: number): void {
    if (stars < 4) return;
    this.roadblockTimer -= dt;
    if (this.roadblockTimer > 0) return;
    const speed = Math.hypot(player.velocity.x, player.velocity.z);
    if (player.onFoot || speed < 8) {
      this.roadblockTimer = 3;
      return;
    }
    this.roadblockTimer = ROADBLOCK_EVERY;
    const at = this.roadAhead(player.position, player.velocity.x / speed, player.velocity.z / speed, ROADBLOCK_AHEAD);
    if (!at) return;
    const free = this.units.filter((u) => u.role === 'off');
    if (free.length < 2) return;
    // Two cars nose to nose across the road.
    const yaw = Math.atan2(-at.tz, at.tx) + Math.PI / 2;
    const px = -at.tz;
    const pz = at.tx;
    for (const [k, side] of [-1, 1].entries()) this.place(free[k], at.x + px * side * 2.4, at.z + pz * side * 2.4, yaw + (side > 0 ? Math.PI : 0), 'block');
    this.stats.roadblocks++;
  }

  /**
   * A point `ahead` metres down the road from `from`, heading (dirX, dirZ): follow the edge
   * you're on, and at each junction take the road that turns least.
   */
  private roadAhead(from: THREE.Vector3, dirX: number, dirZ: number, ahead: number): { x: number; z: number; tx: number; tz: number } | null {
    const hit = this.net.nearest(from.x, from.z, 20);
    if (!hit) return null;
    let edge = this.net.edges[hit.edge];
    const at = { x: 0, z: 0, tx: 0, tz: 0 };
    let s = edge.cum[hit.seg] + (edge.cum[hit.seg + 1] - edge.cum[hit.seg]) * hit.t;
    this.net.pointAt(edge, s, at);
    let forward = at.tx * dirX + at.tz * dirZ > 0; // travelling a → b?
    let left = ahead;
    for (let guard = 0; guard < 12; guard++) {
      const room = forward ? edge.length - s : s;
      if (room >= left) {
        this.net.pointAt(edge, forward ? s + left : s - left, at);
        return at;
      }
      left -= room;
      // At the junction: the next road that keeps closest to the current direction.
      const node = forward ? edge.b : edge.a;
      this.net.pointAt(edge, forward ? edge.length : 0, at);
      const hx = forward ? at.tx : -at.tx;
      const hz = forward ? at.tz : -at.tz;
      let best: { e: number; dot: number; fwd: boolean } | null = null;
      for (const e of this.net.nodes[node].edges) {
        if (e === edge.id) continue;
        const next = this.net.edges[e];
        const fwd = next.a === node;
        this.net.pointAt(next, fwd ? 0 : next.length, at);
        const dot = (fwd ? at.tx : -at.tx) * hx + (fwd ? at.tz : -at.tz) * hz;
        if (!best || dot > best.dot) best = { e, dot, fwd };
      }
      if (!best || best.dot < 0.3) {
        // Dead end or a sharp turn: block at the junction itself.
        const n = this.net.nodes[node];
        return { x: n.x, z: n.z, tx: hx, tz: hz };
      }
      edge = this.net.edges[best.e];
      forward = best.fwd;
      s = forward ? 0 : edge.length;
    }
    return null;
  }

  private updateHeli(player: ReturnType<PoliceHooks['player']>, stars: number, dt: number): void {
    const p = player.position;
    this.heliPrev.copy(this.heliPos);
    if (stars >= 5 && !this.heliOn) {
      // Fly in from 300 m away.
      this.heliOn = true;
      const a = this.rng.range(0, Math.PI * 2);
      this.heliPos.set(p.x + Math.cos(a) * 300, p.y + HELI_HEIGHT + 20, p.z + Math.sin(a) * 300);
      this.heliPrev.copy(this.heliPos);
      this.heli.root.visible = true;
    }
    if (!this.heliOn) return;
    if (stars < 5) {
      // Leave: climb away, then vanish.
      this.heliPos.y += 8 * dt;
      this.heliPos.x += 25 * dt;
      if (this.heliPos.distanceTo(p) > 400) {
        this.heliOn = false;
        this.heli.root.visible = false;
        this.spot.visible = false;
      }
      return;
    }
    // Circle slowly round the player, HELI_HEIGHT above the ground.
    this.heliAngle += dt * 0.15;
    const tx = p.x + Math.cos(this.heliAngle) * 30;
    const tz = p.z + Math.sin(this.heliAngle) * 30;
    const ty = Math.max(this.terrain.smoothHeight(tx, tz), p.y) + HELI_HEIGHT;
    const to = this.tmp.set(tx - this.heliPos.x, ty - this.heliPos.y, tz - this.heliPos.z);
    const d = to.length();
    const step = Math.min(d, 35 * dt);
    if (d > 0.01) this.heliPos.addScaledVector(to, step / d);
    this.heliYaw = Math.atan2(-(p.z - this.heliPos.z), p.x - this.heliPos.x);
    // Shoot now and then when it has a clear shot.
    this.heliShot -= dt;
    if (this.heliShot <= 0) {
      this.heliShot = HELI_SHOT_EVERY;
      const from = this.heliPos.clone();
      from.y -= 1.5;
      const target = new THREE.Vector3(p.x, p.y + 0.3, p.z);
      if (this.clear(from, target)) {
        const hit = this.rng.chance(0.3);
        if (!hit) target.add(new THREE.Vector3(this.rng.range(-2, 2), 0, this.rng.range(-2, 2)));
        this.hooks.shoot(from, target, hit, HELI_DAMAGE);
      }
    }
  }

  // ------------------------------------------------------------------ rendering

  render(alpha: number, frameDt: number): void {
    this.flash += frameDt;
    const phase = Math.floor(this.flash * 4) % 2 === 0;
    for (const u of this.units) {
      if (u.role === 'off') continue;
      u.group.position.lerpVectors(u.prevPos, u.pos, alpha);
      const yaw = u.prevYaw + Math.atan2(Math.sin(u.yaw - u.prevYaw), Math.cos(u.yaw - u.prevYaw)) * alpha;
      this.orientation(yaw, u.pitch, u.group.quaternion);
      u.wheelSpin -= (u.speed / DIM.wheelRadius) * frameDt;
      for (const w of u.wheels) w.rotation.z = u.wheelSpin;
      // Light bar: flashing while chasing or blocking, dark on patrol or wrecked.
      const on = u.role === 'pursuit' || u.role === 'block';
      u.red.color.setHex(on && phase ? 0xff2020 : 0x551111);
      u.blue.color.setHex(on && !phase ? 0x2050ff : 0x111a55);
      // Damaged cars smoke.
      if (this.smoke && u.health < 50) {
        u.smokeTimer -= frameDt;
        if (u.smokeTimer <= 0) {
          const wreck = u.role === 'wreck';
          u.smokeTimer = wreck ? 1 / 14 : 0.25;
          const ahead = wreck ? 0.2 : 1.5;
          const at = this.tmp.set(Math.cos(u.yaw) * ahead, 1.1, -Math.sin(u.yaw) * ahead).add(u.pos);
          this.smoke.emit(at, wreck ? 0.9 : 0.5, wreck ? 1.4 : 0.8);
        }
      }
    }
    if (this.heliOn) {
      const root = this.heli.root;
      root.position.lerpVectors(this.heliPrev, this.heliPos, alpha);
      root.rotation.set(0, this.heliYaw, 0);
      this.heli.mainRotor.rotation.y += frameDt * 40;
      this.heli.tailRotor.rotation.z += frameDt * 60;
      for (const b of this.heli.blades) b.visible = false;
      this.heli.blurDisc.visible = true;
      // Searchlight at night, aimed at the player.
      const night = this.hooks.night();
      this.spot.visible = night > 0.2;
      this.spot.intensity = 400 * night;
      this.spot.position.copy(root.position);
      this.spot.target.position.copy(this.hooks.player().position);
    }
  }
}
