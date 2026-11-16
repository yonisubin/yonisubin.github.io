import * as THREE from 'three';
import type { TrafficCar, Traffic } from '../npc/traffic';
import type { Pedestrians } from '../npc/pedestrians';
import type { PlayerStats } from '../game/stats';
import type { Wanted } from '../game/wanted';
import type { Router } from '../game/route';
import type { StreetNet } from '../world/streets';
import { ROAD_SPECS } from '../world/streets';
import type { Terrain } from '../world/terrain';
import { GATE_RADIUS, RING_RADIUS, arrowMesh, beaconMesh, buoyMesh, disposeObject, gateMesh, packageMesh, ringMesh } from '../game/objectives';
import type { Spot } from './places';
import type { ChoiceOption, Line, PhoneSpec, PlaceId, StepSpec, StoryState } from './types';

// The building blocks of story missions. Each step kind in the script (story/types.ts
// StepSpec) becomes one of these: start() once, update() every physics step until it says
// 'done' (or fails with a reason), end() to clean up. They reach the game only through
// StoryCtx, which main.ts fills in — so a step never imports the player, the HUD or main.

export type Mode = 'foot' | 'car' | 'boat' | 'heli';
export type VehicleKind = 'car' | 'taxi' | 'boat' | 'heli';
export type StepResult = 'running' | 'done' | { fail: string };

/** What steps can see and do. Filled in by the director from main.ts's hooks. */
export interface StoryCtx {
  scene: THREE.Scene;
  place(id: PlaceId): Spot;
  playerPos(): THREE.Vector3;
  mode(): Mode;
  /** The kind of vehicle you're in, or null on foot. A taxi is also a car. */
  vehicle(): VehicleKind | null;
  /** Your speed, m/s. */
  speed(): number;
  /** The nearest vehicle of this kind you could get into, or null. */
  nearestVehicle(kind: VehicleKind): THREE.Vector3 | null;
  traffic: Traffic;
  wanted: Wanted;
  peds: Pedestrians | null;
  stats: PlayerStats;
  terrain: Terrain;
  net: StreetNet;
  router: Router;
  water(x: number, z: number): number | null;
  /** Taxi fares completed so far (side jobs), and end the current shift. */
  faresDone(): number;
  endJob(): void;
  /** Play a scene: lines (already filtered by their `when`) and an optional choice. */
  playScene(lines: Line[], withChar: string | undefined, choices: ChoiceOption[] | undefined): Promise<number | null>;
  phone(message: PhoneSpec): void;
  state(): StoryState;
  setFlags(flags: Record<string, string | boolean>): void;
  pay(amount: number): void;
  /** Hard crashes (≥ 5 damage in a vehicle) since this step started. */
  crashes: number;
  /** Goons knocked out since this step started. */
  goonsDown: number;
  /** The story's marked traffic cars, by name ('kane', 'tommy'…), with the slot serial at marking. */
  cars: Map<string, { car: TrafficCar; serial: number }>;
}

export abstract class Step {
  /** Objective text for the HUD. */
  abstract text(ctx: StoryCtx): string;
  /** Where to go (route line + map objective), or null. */
  target(_ctx: StoryCtx): THREE.Vector3 | null {
    return null;
  }
  /** Seconds left on this step's clock, or null for none. */
  timeLeft(): number | null {
    return null;
  }
  start(_ctx: StoryCtx): void {}
  abstract update(dt: number, ctx: StoryCtx): StepResult;
  end(_ctx: StoryCtx): void {}
}

const v3 = (s: { x: number; z: number }, y = 0) => new THREE.Vector3(s.x, y, s.z);
const flat = (a: THREE.Vector3, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/** A clock: counts down when a limit is given; fails at zero. */
class Clock {
  left: number;
  constructor(limit: number | undefined) {
    this.left = limit ?? Infinity;
  }
  tick(dt: number): boolean {
    this.left -= dt;
    return this.left <= 0;
  }
  get value(): number | null {
    return Number.isFinite(this.left) ? Math.max(0, this.left) : null;
  }
}

// ------------------------------------------------------------------------- scenes & simple

class SceneStep extends Step {
  private finished = false;
  constructor(private readonly spec: Extract<StepSpec, { kind: 'scene' }>) {
    super();
  }
  text(): string {
    return '';
  }
  start(ctx: StoryCtx): void {
    const s = ctx.state();
    const lines = this.spec.lines.filter((l) => !l.when || l.when(s));
    const choice = this.spec.choice;
    void ctx.playScene(lines, this.spec.with, choice).then(async (k) => {
      if (choice && k !== null && choice[k]) {
        ctx.setFlags(choice[k].set);
        const reply = (choice[k].reply ?? []).filter((l) => !l.when || l.when(ctx.state()));
        if (reply.length) await ctx.playScene(reply, this.spec.with, undefined);
      }
      this.finished = true;
    });
  }
  update(): StepResult {
    return this.finished ? 'done' : 'running';
  }
}

class WaitStep extends Step {
  private t: number;
  constructor(private readonly spec: Extract<StepSpec, { kind: 'wait' }>) {
    super();
    this.t = spec.seconds;
  }
  text(): string {
    return this.spec.text ?? '';
  }
  update(dt: number): StepResult {
    this.t -= dt;
    return this.t <= 0 ? 'done' : 'running';
  }
}

/** Steps that happen at once: phone, set flags, pay, set the wanted level. */
class InstantStep extends Step {
  constructor(private readonly run: (ctx: StoryCtx) => void) {
    super();
  }
  text(): string {
    return '';
  }
  update(_dt: number, ctx: StoryCtx): StepResult {
    this.run(ctx);
    return 'done';
  }
}

// ------------------------------------------------------------------------- getting about

/** A light pillar over a destination, shown while a goto/drive step is running. */
class Beacon {
  private mesh: THREE.Mesh | null = null;
  show(ctx: StoryCtx, at: THREE.Vector3, radius: number): void {
    this.mesh = beaconMesh(Math.min(radius, 6), 0xffd60a);
    this.mesh.position.set(at.x, ctx.terrain.smoothHeight(at.x, at.z), at.z);
    ctx.scene.add(this.mesh);
  }
  hide(): void {
    if (this.mesh) disposeObject(this.mesh);
    this.mesh = null;
  }
}

const MODE_NAMES: Record<Mode, string> = { foot: 'on foot', car: 'in a car', boat: 'in a boat', heli: 'in the helicopter' };

class GotoStep extends Step {
  private readonly beacon = new Beacon();
  constructor(private readonly spec: Extract<StepSpec, { kind: 'goto' }>) {
    super();
  }
  private get radius(): number {
    return this.spec.radius ?? (this.spec.by === 'car' ? 10 : this.spec.by === 'heli' ? 14 : 6);
  }
  text(ctx: StoryCtx): string {
    const by = this.spec.by;
    if (by && ctx.mode() !== by && flat(ctx.playerPos(), ctx.place(this.spec.to)) < 40) return `${this.spec.text} — get there ${MODE_NAMES[by]}`;
    return this.spec.text;
  }
  target(ctx: StoryCtx): THREE.Vector3 {
    const p = ctx.place(this.spec.to);
    // Drivers aim for the road next to the spot; walkers for the spot itself.
    return ctx.mode() === 'car' ? v3(p.road) : v3(p, p.y);
  }
  start(ctx: StoryCtx): void {
    this.beacon.show(ctx, v3(ctx.place(this.spec.to)), this.radius);
  }
  update(_dt: number, ctx: StoryCtx): StepResult {
    const p = ctx.place(this.spec.to);
    const pos = ctx.playerPos();
    const near = Math.min(flat(pos, p), flat(pos, p.road) + 2) < this.radius && (this.spec.by !== 'heli' || Math.abs(pos.y - p.y) < 25);
    if (!near) return 'running';
    if (this.spec.by && ctx.mode() !== this.spec.by) return 'running';
    return 'done';
  }
  end(): void {
    this.beacon.hide();
  }
}

class EnterStep extends Step {
  constructor(private readonly spec: Extract<StepSpec, { kind: 'enter' }>) {
    super();
  }
  text(): string {
    return this.spec.text;
  }
  target(ctx: StoryCtx): THREE.Vector3 | null {
    return ctx.nearestVehicle(this.spec.vehicle);
  }
  update(_dt: number, ctx: StoryCtx): StepResult {
    const v = ctx.vehicle();
    const want = this.spec.vehicle;
    const ok = want === 'car' ? v === 'car' || v === 'taxi' : v === want;
    return ok ? 'done' : 'running';
  }
}

class DriveStep extends Step {
  private readonly clock: Clock;
  private readonly beacon = new Beacon();
  constructor(private readonly spec: Extract<StepSpec, { kind: 'drive' }>) {
    super();
    this.clock = new Clock(spec.time);
  }
  private inCar(ctx: StoryCtx): boolean {
    const v = ctx.vehicle();
    return v === 'car' || v === 'taxi';
  }
  text(ctx: StoryCtx): string {
    const crashes = this.spec.maxCrashes !== undefined && this.spec.maxCrashes > 0 ? ` · crashes ${ctx.crashes}/${this.spec.maxCrashes}` : '';
    return this.inCar(ctx) ? `${this.spec.text}${crashes}` : `Get in a car — ${this.spec.text.charAt(0).toLowerCase()}${this.spec.text.slice(1)}`;
  }
  target(ctx: StoryCtx): THREE.Vector3 {
    return v3(ctx.place(this.spec.to).road);
  }
  timeLeft(): number | null {
    return this.clock.value;
  }
  start(ctx: StoryCtx): void {
    this.beacon.show(ctx, v3(ctx.place(this.spec.to).road), 6);
  }
  update(dt: number, ctx: StoryCtx): StepResult {
    if (this.clock.tick(dt)) return { fail: 'Out of time' };
    if (this.spec.maxCrashes !== undefined && ctx.crashes > this.spec.maxCrashes) {
      return { fail: this.spec.maxCrashes === 0 ? 'You crashed the car' : 'Too many crashes' };
    }
    const spot = ctx.place(this.spec.to);
    const r = this.spec.radius ?? 12;
    if (this.inCar(ctx) && Math.min(flat(ctx.playerPos(), spot.road), flat(ctx.playerPos(), spot)) < r) return 'done';
    return 'running';
  }
  end(): void {
    this.beacon.hide();
  }
}

// ------------------------------------------------------------------------- marked cars

/** An arrow spinning over a marked car. */
class CarArrow {
  private mesh: THREE.Mesh | null = null;
  private spin = 0;
  show(ctx: StoryCtx): void {
    this.mesh = arrowMesh(0xffd60a);
    ctx.scene.add(this.mesh);
  }
  follow(car: TrafficCar, dt: number): void {
    if (!this.mesh) return;
    this.spin += dt;
    this.mesh.position.set(car.currPos.x, car.currPos.y + 3.4 + Math.sin(this.spin * 4) * 0.25, car.currPos.z);
    this.mesh.rotation.y = this.spin * 2;
  }
  hide(): void {
    if (this.mesh) disposeObject(this.mesh);
    this.mesh = null;
  }
}

class MarkCarStep extends Step {
  private waited = 0;
  constructor(private readonly spec: Extract<StepSpec, { kind: 'markCar' }>) {
    super();
  }
  text(): string {
    return 'Looking for the car…';
  }
  update(dt: number, ctx: StoryCtx): StepResult {
    const car = ctx.traffic.pickTarget(ctx.playerPos(), this.spec.min ?? 90, this.spec.max ?? 260);
    if (car) {
      car.pinned = true;
      ctx.cars.set(this.spec.car, { car, serial: car.serial });
      return 'done';
    }
    this.waited += dt;
    return this.waited > 8 ? { fail: 'The car never showed up' } : 'running';
  }
}

/** Shared by the steps about one marked car: is it still the same car? */
function marked(ctx: StoryCtx, name: string): { car: TrafficCar; gone: boolean } | null {
  const m = ctx.cars.get(name);
  if (!m) return null;
  return { car: m.car, gone: !m.car.active || m.car.serial !== m.serial };
}

class JackStep extends Step {
  private readonly arrow = new CarArrow();
  private last = new THREE.Vector3();
  constructor(private readonly spec: Extract<StepSpec, { kind: 'jack' }>) {
    super();
  }
  text(): string {
    return this.spec.text;
  }
  target(ctx: StoryCtx): THREE.Vector3 | null {
    return marked(ctx, this.spec.car)?.car.currPos ?? null;
  }
  start(ctx: StoryCtx): void {
    this.arrow.show(ctx);
  }
  update(dt: number, ctx: StoryCtx): StepResult {
    const m = marked(ctx, this.spec.car);
    if (!m) return { fail: 'The car is gone' };
    if (!m.gone) {
      if (m.car.wrecked >= 0) return { fail: 'You wrecked the car' };
      this.last.copy(m.car.currPos);
      this.arrow.follow(m.car, dt);
      return 'running';
    }
    // The slot was taken: carjacked by you (you're now driving, where it was) or it got away.
    const yours = (ctx.vehicle() === 'car' || ctx.vehicle() === 'taxi') && flat(ctx.playerPos(), this.last) < 15;
    return yours ? 'done' : { fail: 'The car got away' };
  }
  end(ctx: StoryCtx): void {
    this.arrow.hide();
    const m = ctx.cars.get(this.spec.car);
    if (m) m.car.pinned = false;
  }
}

class WreckStep extends Step {
  private readonly arrow = new CarArrow();
  private readonly clock: Clock;
  constructor(private readonly spec: Extract<StepSpec, { kind: 'wreck' }>) {
    super();
    this.clock = new Clock(spec.time);
  }
  text(): string {
    return this.spec.text;
  }
  target(ctx: StoryCtx): THREE.Vector3 | null {
    return marked(ctx, this.spec.car)?.car.currPos ?? null;
  }
  timeLeft(): number | null {
    return this.clock.value;
  }
  start(ctx: StoryCtx): void {
    this.arrow.show(ctx);
  }
  update(dt: number, ctx: StoryCtx): StepResult {
    const m = marked(ctx, this.spec.car);
    if (!m || m.gone) return { fail: 'The car got away' };
    if (m.car.wrecked >= 0) return 'done';
    if (this.clock.tick(dt)) return { fail: 'The car got away' };
    this.arrow.follow(m.car, dt);
    return 'running';
  }
  end(ctx: StoryCtx): void {
    this.arrow.hide();
    const m = ctx.cars.get(this.spec.car);
    if (m) m.car.pinned = false;
  }
}

class FollowStep extends Step {
  private readonly arrow = new CarArrow();
  private held = 0;
  private tooFar = 0;
  private tooClose = 0;
  constructor(private readonly spec: Extract<StepSpec, { kind: 'follow' }>) {
    super();
  }
  text(ctx: StoryCtx): string {
    const m = marked(ctx, this.spec.car);
    const d = m ? flat(ctx.playerPos(), m.car.currPos) : 0;
    const hint = d < this.spec.min ? ' — too close!' : d > this.spec.max ? ' — keep up!' : '';
    return `${this.spec.text} · ${Math.floor(this.held)}/${this.spec.seconds} s${hint}`;
  }
  target(ctx: StoryCtx): THREE.Vector3 | null {
    return marked(ctx, this.spec.car)?.car.currPos ?? null;
  }
  start(ctx: StoryCtx): void {
    this.arrow.show(ctx);
  }
  update(dt: number, ctx: StoryCtx): StepResult {
    const m = marked(ctx, this.spec.car);
    if (!m || m.gone || m.car.wrecked >= 0) return { fail: 'You lost them' };
    this.arrow.follow(m.car, dt);
    const d = flat(ctx.playerPos(), m.car.currPos);
    if (d >= this.spec.min && d <= this.spec.max) this.held += dt;
    this.tooClose = d < this.spec.min ? this.tooClose + dt : 0;
    this.tooFar = d > this.spec.max * 1.6 ? this.tooFar + dt : 0;
    if (this.tooClose > 3) return { fail: 'They spotted you' };
    if (this.tooFar > 6) return { fail: 'You lost them' };
    return this.held >= this.spec.seconds ? 'done' : 'running';
  }
  end(ctx: StoryCtx): void {
    this.arrow.hide();
    const m = ctx.cars.get(this.spec.car);
    if (m) m.car.pinned = false;
  }
}

// ------------------------------------------------------------------------- courses

/** A set of points to visit in order (or any order), each with a mesh that goes when reached. */
abstract class CourseStep extends Step {
  protected points: THREE.Vector3[] = [];
  protected meshes: THREE.Object3D[] = [];
  protected reached = 0;
  protected readonly clock: Clock;
  constructor(limit: number | undefined) {
    super();
    this.clock = new Clock(limit);
  }
  timeLeft(): number | null {
    return this.clock.value;
  }
  target(_ctx: StoryCtx): THREE.Vector3 | null {
    return this.points[this.reached] ?? null;
  }
  protected abstract build(ctx: StoryCtx): void;
  protected abstract hit(ctx: StoryCtx, p: THREE.Vector3): boolean;
  start(ctx: StoryCtx): void {
    this.build(ctx);
    for (const m of this.meshes) ctx.scene.add(m);
  }
  update(dt: number, ctx: StoryCtx): StepResult {
    if (!this.points.length) return { fail: 'No course here' };
    if (this.clock.tick(dt)) return { fail: 'Out of time' };
    const p = this.points[this.reached];
    if (this.hit(ctx, p)) {
      this.meshes[this.reached].visible = false;
      this.reached++;
    }
    return this.reached >= this.points.length ? 'done' : 'running';
  }
  end(): void {
    for (const m of this.meshes) disposeObject(m);
    this.meshes = [];
  }
}

/** Points on the sidewalks around a place, collected in any order (nearest first on the map). */
class PackagesStep extends CourseStep {
  constructor(private readonly spec: Extract<StepSpec, { kind: 'packages' }>) {
    super(spec.time);
  }
  text(): string {
    return `${this.spec.text} (${this.reached}/${this.points.length})`;
  }
  protected build(ctx: StoryCtx): void {
    const c = ctx.place(this.spec.around);
    const net = ctx.net;
    const edges: number[] = [];
    net.index.forEachNear(c.x, c.z, 320, (e) => {
      if (ROAD_SPECS[net.edges[e].cls].sidewalk > 0 && net.edges[e].length > 30) edges.push(e);
    });
    const at = { x: 0, z: 0, tx: 0, tz: 0 };
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let tries = 0; tries < 400 && this.points.length < this.spec.count && edges.length; tries++) {
      const e = net.edges[edges[Math.floor(rnd() * edges.length)]];
      net.pointAt(e, 8 + rnd() * (e.length - 16), at);
      const spec = ROAD_SPECS[e.cls];
      const side = rnd() < 0.5 ? 1 : -1;
      const off = spec.width / 2 + spec.sidewalk * 0.5;
      const x = at.x - at.tz * off * side;
      const z = at.z + at.tx * off * side;
      const d = Math.hypot(x - c.x, z - c.z);
      if (d < 60 || d > 320 || this.points.some((p) => Math.hypot(p.x - x, p.z - z) < 50)) continue;
      this.points.push(new THREE.Vector3(x, ctx.terrain.surfaceAt(x, z), z));
    }
    for (const p of this.points) {
      const box = packageMesh();
      box.position.set(p.x, p.y + 0.45, p.z);
      this.meshes.push(box);
    }
  }
  target(ctx: StoryCtx): THREE.Vector3 | null {
    // The nearest one left.
    const pos = ctx.playerPos();
    let best: THREE.Vector3 | null = null;
    for (let i = 0; i < this.points.length; i++) {
      if (!this.meshes[i]?.visible) continue;
      if (!best || flat(pos, this.points[i]) < flat(pos, best)) best = this.points[i];
    }
    return best;
  }
  update(dt: number, ctx: StoryCtx): StepResult {
    if (!this.points.length) return { fail: 'No deliveries here' };
    if (this.clock.tick(dt)) return { fail: 'The food went cold' };
    const pos = ctx.playerPos();
    for (let i = 0; i < this.points.length; i++) {
      const m = this.meshes[i];
      if (m.visible && flat(pos, this.points[i]) < 3.5 && Math.abs(pos.y - this.points[i].y) < 3) {
        m.visible = false;
        this.reached++;
      }
    }
    return this.reached >= this.points.length ? 'done' : 'running';
  }
  protected hit(): boolean {
    return false;
  }
}

/** Road gates every ~220 m along the A* route between two places (a car race). */
class GatesStep extends CourseStep {
  constructor(private readonly spec: Extract<StepSpec, { kind: 'gates' }>) {
    super(spec.time);
  }
  text(): string {
    return `${this.spec.text} (${this.reached}/${this.points.length})`;
  }
  protected build(ctx: StoryCtx): void {
    const a = ctx.place(this.spec.from).road;
    const b = ctx.place(this.spec.to).road;
    const route = ctx.router.find(a.x, a.z, b.x, b.z, 'drive');
    if (!route) return;
    const pts = route.pts;
    let along = 0;
    let next = 60;
    for (let i = 2; i < pts.length; i += 2) {
      const seg = Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
      while (along + seg >= next) {
        const f = (next - along) / seg;
        const x = pts[i - 2] + (pts[i] - pts[i - 2]) * f;
        const z = pts[i - 1] + (pts[i + 1] - pts[i - 1]) * f;
        this.points.push(new THREE.Vector3(x, ctx.terrain.smoothHeight(x, z), z));
        next += 220;
      }
      along += seg;
    }
    this.points.push(new THREE.Vector3(b.x, ctx.terrain.smoothHeight(b.x, b.z), b.z));
    this.points.forEach((p, i) => {
      const gate = gateMesh();
      const toward = this.points[i + 1] ?? this.points[i - 1] ?? p.clone().add(new THREE.Vector3(1, 0, 0));
      gate.position.set(p.x, p.y + GATE_RADIUS * 0.8 - 0.5, p.z);
      gate.lookAt(toward.x, gate.position.y, toward.z);
      this.meshes.push(gate);
    });
  }
  protected hit(ctx: StoryCtx, p: THREE.Vector3): boolean {
    return flat(ctx.playerPos(), p) < GATE_RADIUS;
  }
}

/** Sky rings in a line from one place to another, the last one over the destination. */
class RingsStep extends CourseStep {
  constructor(private readonly spec: Extract<StepSpec, { kind: 'rings' }>) {
    super(spec.time);
  }
  text(): string {
    return `${this.spec.text} (${this.reached}/${this.points.length})`;
  }
  protected build(ctx: StoryCtx): void {
    const a = ctx.place(this.spec.from);
    const b = ctx.place(this.spec.to);
    const n = this.spec.count;
    for (let k = 1; k <= n; k++) {
      const f = k / n;
      const x = a.x + (b.x - a.x) * f;
      const z = a.z + (b.z - a.z) * f;
      // Climb over the town, then come down to just over the roof.
      const cruise = ctx.terrain.smoothHeight(x, z) + 45;
      const y = k === n ? b.y : Math.max(cruise, b.y + 15);
      this.points.push(new THREE.Vector3(x, y, z));
    }
    this.points.forEach((p, i) => {
      const ring = ringMesh();
      const toward = this.points[i + 1] ?? this.points[i - 1];
      ring.position.copy(p);
      ring.lookAt(toward.x, p.y, toward.z);
      this.meshes.push(ring);
    });
  }
  protected hit(ctx: StoryCtx, p: THREE.Vector3): boolean {
    return ctx.playerPos().distanceTo(p) < RING_RADIUS * 1.2;
  }
}

/** Buoys on the water in a line between two places, passed in order by boat. */
class BuoysStep extends CourseStep {
  constructor(private readonly spec: Extract<StepSpec, { kind: 'buoys' }>) {
    super(spec.time);
  }
  text(): string {
    return `${this.spec.text} (${this.reached}/${this.points.length})`;
  }
  protected build(ctx: StoryCtx): void {
    const a = ctx.place(this.spec.from);
    const b = ctx.place(this.spec.to);
    const n = this.spec.count;
    for (let k = 1; k <= n; k++) {
      const f = 0.12 + (0.88 * k) / n;
      // A gentle zig-zag across the line.
      const side = (k % 2 ? 1 : -1) * 18;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const l = Math.hypot(dx, dz) || 1;
      let x = a.x + dx * f - (dz / l) * side;
      let z = a.z + dz * f + (dx / l) * side;
      // Keep it on the water: slide toward the far point until there's water.
      for (let s = 0; s < 20 && ctx.water(x, z) === null; s++) {
        x += (b.x - x) * 0.15;
        z += (b.z - z) * 0.15;
      }
      const y = ctx.water(x, z);
      if (y !== null) this.points.push(new THREE.Vector3(x, y, z));
    }
    for (const p of this.points) {
      const buoy = buoyMesh();
      buoy.position.copy(p);
      this.meshes.push(buoy);
    }
  }
  protected hit(ctx: StoryCtx, p: THREE.Vector3): boolean {
    return ctx.vehicle() === 'boat' && flat(ctx.playerPos(), p) < 9;
  }
}

// ------------------------------------------------------------------------- police, fights, shopping

class LoseCopsStep extends Step {
  constructor(private readonly spec: Extract<StepSpec, { kind: 'loseCops' }>) {
    super();
  }
  text(ctx: StoryCtx): string {
    return ctx.wanted.stars > 0 ? this.spec.text : '';
  }
  update(_dt: number, ctx: StoryCtx): StepResult {
    return ctx.wanted.stars === 0 ? 'done' : 'running';
  }
}

/** Thugs at a place: get there, then knock out `count` of them (they come in waves). */
class GoonsStep extends Step {
  private readonly clock: Clock;
  private spawned = 0;
  private arrived = false;
  constructor(private readonly spec: Extract<StepSpec, { kind: 'goons' }>) {
    super();
    this.clock = new Clock(spec.time);
  }
  text(ctx: StoryCtx): string {
    return this.arrived ? `${this.spec.text} (${Math.min(ctx.goonsDown, this.spec.count)}/${this.spec.count})` : `${this.spec.text} — get there`;
  }
  target(ctx: StoryCtx): THREE.Vector3 | null {
    const p = ctx.place(this.spec.at);
    return this.arrived ? null : v3(p, p.y);
  }
  timeLeft(): number | null {
    return this.arrived ? this.clock.value : null;
  }
  update(dt: number, ctx: StoryCtx): StepResult {
    const peds = ctx.peds;
    if (!peds) return 'done'; // no people in this build: nothing to fight
    const p = ctx.place(this.spec.at);
    if (!this.arrived) {
      if (flat(ctx.playerPos(), p) > 45) return 'running';
      this.arrived = true;
      ctx.goonsDown = 0;
    }
    if (ctx.goonsDown >= this.spec.count) return 'done';
    if (this.clock.tick(dt)) return { fail: 'They overran the place' };
    // Keep up to 3 on their feet at a time until everyone's come.
    const out = peds.goonsOut;
    if (out < 3 && this.spawned < this.spec.count && peds.goonsFree > 0) {
      const a = (this.spawned * 2.39996) % (Math.PI * 2); // golden-angle spread
      const r = 16 + (this.spawned % 3) * 4;
      if (peds.summonGoon(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r)) this.spawned++;
    }
    return 'running';
  }
  end(ctx: StoryCtx): void {
    ctx.peds?.dismissGoons();
  }
}

class BuyStep extends Step {
  constructor(private readonly spec: Extract<StepSpec, { kind: 'buy' }>) {
    super();
  }
  text(): string {
    return this.spec.text;
  }
  target(ctx: StoryCtx): THREE.Vector3 {
    const p = ctx.place('gunstore');
    return v3(p, p.y);
  }
  update(_dt: number, ctx: StoryCtx): StepResult {
    return ctx.stats.owned.has(this.spec.weapon) ? 'done' : 'running';
  }
}

class FareStep extends Step {
  private base = -1;
  constructor(private readonly spec: Extract<StepSpec, { kind: 'fare' }>) {
    super();
  }
  text(): string {
    return this.spec.text;
  }
  start(ctx: StoryCtx): void {
    this.base = ctx.faresDone();
  }
  update(_dt: number, ctx: StoryCtx): StepResult {
    if (ctx.faresDone() > this.base) {
      ctx.endJob();
      return 'done';
    }
    return 'running';
  }
}

// ------------------------------------------------------------------------- factory

/** Build the runtime step for a step in the script. */
export function makeStep(spec: StepSpec): Step {
  switch (spec.kind) {
    case 'scene':
      return new SceneStep(spec);
    case 'wait':
      return new WaitStep(spec);
    case 'goto':
      return new GotoStep(spec);
    case 'enter':
      return new EnterStep(spec);
    case 'drive':
      return new DriveStep(spec);
    case 'markCar':
      return new MarkCarStep(spec);
    case 'jack':
      return new JackStep(spec);
    case 'wreck':
      return new WreckStep(spec);
    case 'follow':
      return new FollowStep(spec);
    case 'packages':
      return new PackagesStep(spec);
    case 'gates':
      return new GatesStep(spec);
    case 'rings':
      return new RingsStep(spec);
    case 'buoys':
      return new BuoysStep(spec);
    case 'loseCops':
      return new LoseCopsStep(spec);
    case 'goons':
      return new GoonsStep(spec);
    case 'buy':
      return new BuyStep(spec);
    case 'fare':
      return new FareStep(spec);
    case 'phone':
      return new InstantStep((ctx) => ctx.phone(spec.message));
    case 'set':
      return new InstantStep((ctx) => ctx.setFlags(spec.flags));
    case 'pay':
      return new InstantStep((ctx) => ctx.pay(spec.amount));
    case 'stars':
      // The police are on to you: at least this many stars (heat is the star count + a bit).
      return new InstantStep((ctx) => {
        ctx.wanted.heat = Math.max(ctx.wanted.heat, spec.stars + 0.3);
      });
  }
}
