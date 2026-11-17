// Receivers that move: doors, platforms on rails, lifts, wall panels, crushers. Each solid part is a
// kinematic Rapier body moved with setNextKinematic*; its `mover.delta` (this step's displacement)
// lets the player ride it. A surface that moves closes any portal standing on it (placement rule 5),
// and portal shots fizzle on it while it moves.
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../core/config';
import type { ChamberContext } from '../game/context';
import type { Brush, Entity, SurfaceTag, Vec3 } from '../levels/level';
import type { ColliderInfo, Mover } from '../physics/world';
import { MAT } from '../render/models';
import { BaseElement } from './base';

const E = CONFIG.elements;

/** One moving box: kinematic body + mesh + mover delta + portal closing. */
class SolidPart {
  readonly mover: Mover = { delta: { x: 0, y: 0, z: 0 } };
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly mesh: THREE.Mesh;
  readonly pos = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  private readonly prev = new THREE.Vector3();
  private readonly prevQuat = new THREE.Quaternion();
  private readonly info: Extract<ColliderInfo, { kind: 'solid' }>;

  constructor(
    private readonly ctx: ChamberContext,
    owner: BaseElement,
    readonly half: THREE.Vector3,
    at: THREE.Vector3,
    readonly restTag: SurfaceTag,
    material: THREE.Material,
  ) {
    const { body, collider } = owner.kinematicBox(half, at, restTag, this.mover);
    this.body = body;
    this.collider = collider;
    this.info = ctx.physics.infoOf(collider) as Extract<ColliderInfo, { kind: 'solid' }>;
    // The current world box (axis-aligned parts only) lets portals sit on a portalable part.
    // (Exact for parts at rest at multiples of 90°: the AABB of the rotated box.)
    this.info.box = (): Brush => {
      const m = new THREE.Matrix4().makeRotationFromQuaternion(this.quat).elements;
      const e = [0, 1, 2].map((r) => Math.abs(m[r]) * half.x + Math.abs(m[4 + r]) * half.y + Math.abs(m[8 + r]) * half.z);
      return {
        min: [this.pos.x - e[0], this.pos.y - e[1], this.pos.z - e[2]],
        max: [this.pos.x + e[0], this.pos.y + e[1], this.pos.z + e[2]],
        tag: this.info.tag,
      };
    };
    this.pos.copy(at);
    this.prev.copy(at);
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(half.x * 2, half.y * 2, half.z * 2), material);
    this.mesh.position.copy(at);
  }

  /** Move to a new pose this step (applied by the next physics step). */
  moveTo(p: THREE.Vector3, q?: THREE.Quaternion): void {
    this.prev.copy(this.pos);
    this.prevQuat.copy(this.quat);
    const d = p.clone().sub(this.pos);
    this.mover.delta = { x: d.x, y: d.y, z: d.z };
    const turned = !!q && q.angleTo(this.quat) > 1e-6;
    const moving = d.lengthSq() > 1e-12 || turned;
    this.pos.copy(p);
    if (q) this.quat.copy(q);
    this.body.setNextKinematicTranslation(p);
    if (q) this.body.setNextKinematicRotation(q);
    // Moving surfaces don't hold portals and don't take them.
    this.info.tag = moving ? 'metal' : this.restTag;
    if (moving && this.ctx.portals.removeOnSurface(this.collider.handle)) this.ctx.sfx('portalClose', 'Portal closes');
  }

  /** Set the pose immediately (save restore). */
  place(p: THREE.Vector3, q?: THREE.Quaternion): void {
    this.pos.copy(p);
    this.prev.copy(p);
    if (q) this.quat.copy(q), this.prevQuat.copy(q);
    this.body.setTranslation(p, true);
    if (q) this.body.setRotation(q, true);
    this.mover.delta = { x: 0, y: 0, z: 0 };
  }

  render(alpha: number): void {
    this.mesh.position.copy(this.prev).lerp(this.pos, alpha);
    this.mesh.quaternion.copy(this.prevQuat).slerp(this.quat, alpha);
  }
}

abstract class MoverElement extends BaseElement {
  protected parts: SolidPart[] = [];

  protected part(half: THREE.Vector3, at: THREE.Vector3, tag: SurfaceTag, material: THREE.Material): SolidPart {
    const p = new SolidPart(this.ctx, this, half, at, tag, material);
    this.add(p.mesh);
    this.parts.push(p);
    return p;
  }

  render(alpha: number): void {
    for (const p of this.parts) p.render(alpha);
  }
}

function surfaceMaterial(tag: SurfaceTag): THREE.Material {
  return tag === 'portalable' ? MAT.white() : tag === 'glass' ? MAT.glass() : MAT.metal();
}

/** Sliding double door. Input: open (default props.open ?? false). Output: open (fully open). */
export class Door extends MoverElement {
  private f = 0;
  private readonly w: number;
  private readonly rot: THREE.Quaternion;

  constructor(ctx: ChamberContext, entity: Entity) {
    super(ctx, entity);
    this.w = this.prop('width', E.doorWidth);
    const h = this.prop('height', E.doorHeight);
    this.rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw());
    const half = new THREE.Vector3(this.w / 4, h / 2, E.doorThickness / 2);
    for (let i = 0; i < 2; i++) this.part(half, this.leafPos(i, 0), 'metal', MAT.metal());
    // Leaves are rotated with the door's yaw; collider boxes are local, so rotate the bodies too.
    for (const p of this.parts) p.place(p.pos, this.rot);
    // A lit strip over the door shows whether it is open.
    const strip = new THREE.Mesh(new THREE.BoxGeometry(this.w, 0.08, 0.04), new THREE.MeshBasicMaterial({ color: 0x555555 }));
    strip.position.copy(this.origin()).add(new THREE.Vector3(0, h + 0.1, E.doorThickness / 2 + 0.03).applyQuaternion(this.rot));
    strip.quaternion.copy(this.rot);
    this.add(strip);
    this.strip = strip;
    this.f = this.prop('open', false) ? 1 : 0;
    this.outputs.open = this.f >= 1;
    this.parts.forEach((p, i) => p.place(this.leafPos(i, this.f), this.rot));
  }

  private strip: THREE.Mesh;

  private leafPos(i: number, f: number): THREE.Vector3 {
    const side = i === 0 ? -1 : 1;
    const h = this.prop('height', E.doorHeight);
    const local = new THREE.Vector3(side * (this.w / 4 + (f * this.w) / 2), h / 2, 0);
    return local.applyQuaternion(this.rot).add(this.origin());
  }

  isOpen(): boolean {
    return this.f >= 1;
  }

  openness(): number {
    return this.f;
  }

  update(dt: number): void {
    const want = this.input('open', this.prop('open', false)) ? 1 : 0;
    if (want !== this.f) {
      const before = this.f;
      this.f = THREE.MathUtils.clamp(this.f + Math.sign(want - this.f) * (dt / E.doorTime), 0, 1);
      if ((before === 0 || before === 1) && this.f !== before) this.ctx.sfx(want ? 'doorOpen' : 'doorClose', want ? 'Door opens' : 'Door closes');
    }
    this.parts.forEach((p, i) => p.moveTo(this.leafPos(i, this.f), this.rot));
    this.setOutput('open', this.f >= 1);
    (this.strip.material as THREE.MeshBasicMaterial).color.setHex(this.f >= 1 ? 0x4dd2ff : want ? 0x2a6f88 : 0xff6a3d);
  }

  snapshot(): unknown {
    return { ...(super.snapshot() as object), f: this.f };
  }

  restore(state: unknown): void {
    super.restore(state);
    this.f = (state as { f: number }).f;
    this.parts.forEach((p, i) => p.place(this.leafPos(i, this.f), this.rot));
  }
}

/**
 * Platform on rails: props.waypoints (world positions of its centre), speed, loop (cycle; otherwise
 * back and forth), size, portalable. Input: active (default true).
 */
export class Platform extends MoverElement {
  protected points: THREE.Vector3[];
  protected seg = 0;
  protected dir = 1;
  protected t = 0;
  protected readonly speed: number;

  constructor(ctx: ChamberContext, entity: Entity, defaults: { size: [number, number, number]; speed: number } = { size: E.platformSize, speed: E.platformSpeed }) {
    super(ctx, entity);
    this.points = this.makePoints();
    this.speed = this.prop('speed', defaults.speed);
    const size = this.prop<[number, number, number]>('size', defaults.size);
    const tag: SurfaceTag = this.prop('portalable', false) ? 'portalable' : 'metal';
    this.part(new THREE.Vector3(size[0] / 2, size[1] / 2, size[2] / 2), this.points[0].clone(), tag, surfaceMaterial(tag));
  }

  protected makePoints(): THREE.Vector3[] {
    const w = this.prop<Vec3[]>('waypoints', []);
    return w.length ? w.map((p) => new THREE.Vector3(...p)) : [this.origin()];
  }

  protected active(): boolean {
    return this.input('active', true);
  }

  /** Where the platform is along its path right now. */
  current(): THREE.Vector3 {
    const a = this.points[this.seg];
    const b = this.points[this.next()];
    return a.clone().lerp(b, this.t);
  }

  private next(): number {
    const n = this.points.length;
    if (n < 2) return this.seg;
    if (this.prop('loop', false)) return (this.seg + 1) % n;
    return THREE.MathUtils.clamp(this.seg + this.dir, 0, n - 1);
  }

  /** Advance along the path by `dist` metres. */
  protected advance(dist: number): void {
    let guard = 0;
    while (dist > 1e-9 && this.points.length > 1 && guard++ < 16) {
      const a = this.points[this.seg];
      const b = this.points[this.next()];
      const len = a.distanceTo(b);
      const left = (1 - this.t) * len;
      if (len < 1e-6 || dist >= left) {
        dist -= left;
        this.t = 0;
        const loop = this.prop('loop', false);
        if (loop) this.seg = (this.seg + 1) % this.points.length;
        else {
          this.seg = this.next();
          if (this.seg === this.points.length - 1 || this.seg === 0) this.dir = this.seg === 0 ? 1 : -1;
        }
      } else {
        this.t += dist / len;
        dist = 0;
      }
    }
  }

  update(dt: number): void {
    if (this.active()) this.advance(this.speed * dt);
    this.parts[0].moveTo(this.current());
  }

  snapshot(): unknown {
    return { ...(super.snapshot() as object), seg: this.seg, dir: this.dir, t: this.t };
  }

  restore(state: unknown): void {
    super.restore(state);
    const s = state as { seg: number; dir: number; t: number };
    this.seg = s.seg;
    this.dir = s.dir;
    this.t = s.t;
    this.parts[0].place(this.current());
  }
}

/**
 * Vertical lift: props.height, speed. Input: up. Unwired, it rises while the player stands on it
 * and comes back down when they step off. Output: top.
 */
export class Lift extends Platform {
  private h = 0;

  constructor(ctx: ChamberContext, entity: Entity) {
    super(ctx, entity, { size: E.liftSize, speed: E.liftSpeed });
  }

  protected makePoints(): THREE.Vector3[] {
    const o = this.origin();
    return [o, o.clone().setY(o.y + this.prop('height', 4))];
  }

  update(dt: number): void {
    const p = this.parts[0];
    const onIt = this.ctx.player.groundHandle === p.collider.handle;
    const up = this.input('up', onIt);
    const top = this.prop('height', 4);
    this.h = THREE.MathUtils.clamp(this.h + (up ? 1 : -1) * this.speed * dt, 0, top);
    p.moveTo(this.origin().setY(this.entity.position[1] + this.h));
    this.setOutput('top', this.h >= top);
  }

  snapshot(): unknown {
    return { ...(super.snapshot() as object), h: this.h };
  }

  restore(state: unknown): void {
    super.restore(state);
    this.h = (state as { h: number }).h;
    this.parts[0].place(this.origin().setY(this.entity.position[1] + this.h));
  }
}

/**
 * Wall/floor panel that slides by props.to (offset) and/or turns by props.rotate (radians about Y)
 * when its input `active` is on. props.size, props.tag (default portalable).
 */
export class Panel extends MoverElement {
  private f = 0;

  constructor(ctx: ChamberContext, entity: Entity) {
    super(ctx, entity);
    const size = this.prop<[number, number, number]>('size', E.panelSize);
    const tag = this.prop<SurfaceTag>('tag', 'portalable');
    this.part(new THREE.Vector3(size[0] / 2, size[1] / 2, size[2] / 2), this.origin(), tag, surfaceMaterial(tag));
  }

  private pose(f: number): { p: THREE.Vector3; q: THREE.Quaternion } {
    const p = this.origin().add(this.vec('to', [0, 0, 0]).multiplyScalar(f));
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.prop('rotate', 0) * f);
    return { p, q };
  }

  update(dt: number): void {
    const want = this.input('active', false) ? 1 : 0;
    const dist = this.vec('to', [0, 0, 0]).length() + Math.abs(this.prop('rotate', 0));
    const rate = dist > 0 ? (this.prop('speed', E.panelSpeed) * dt) / dist : 1;
    this.f = THREE.MathUtils.clamp(this.f + Math.sign(want - this.f) * rate, 0, 1);
    const { p, q } = this.pose(this.f);
    this.parts[0].moveTo(p, q);
    this.setOutput('moved', this.f >= 1);
  }

  snapshot(): unknown {
    return { ...(super.snapshot() as object), f: this.f };
  }

  restore(state: unknown): void {
    super.restore(state);
    this.f = (state as { f: number }).f;
    const { p, q } = this.pose(this.f);
    this.parts[0].place(p, q);
  }
}

/**
 * Crusher: a heavy block that slams along props.travel and back with props.period. Input: active
 * (default true). Anything it touches while moving dies (the player: `death` crusher).
 */
export class Crusher extends MoverElement {
  private phase = 0;
  private readonly half: THREE.Vector3;

  constructor(ctx: ChamberContext, entity: Entity) {
    super(ctx, entity);
    const size = this.prop<[number, number, number]>('size', CONFIG.hazards.crusherSize);
    this.half = new THREE.Vector3(size[0] / 2, size[1] / 2, size[2] / 2);
    const m = new THREE.MeshLambertMaterial({ color: 0x5a4a3a });
    this.part(this.half, this.origin(), 'metal', m);
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(size[0] * 1.01, size[1] * 0.12, size[2] * 1.01),
      new THREE.MeshBasicMaterial({ color: 0xffc21a }),
    );
    this.parts[0].mesh.add(stripe);
  }

  /** Offset along travel: fast slam out, slower return (smoothstep shaped). */
  private extent(phase: number): number {
    const x = phase < 0.3 ? phase / 0.3 : phase < 0.5 ? 1 : phase < 0.9 ? 1 - (phase - 0.5) / 0.4 : 0;
    return x * x * (3 - 2 * x);
  }

  update(dt: number): void {
    if (this.input('active', true)) this.phase = (this.phase + dt / this.prop('period', CONFIG.hazards.crusherPeriod)) % 1;
    const p = this.origin().add(this.vec('travel', [0, -2, 0]).multiplyScalar(this.extent(this.phase)));
    const part = this.parts[0];
    part.moveTo(p);
    const d = part.mover.delta;
    if (Math.hypot(d.x, d.y, d.z) < 1e-6 || this.ctx.playerDead()) return;
    // The moving block overlaps the player's capsule (as a box) → crushed.
    const pl = this.ctx.player;
    const ph = pl.height / 2;
    const r = CONFIG.player.radius;
    const overlap =
      Math.abs(pl.position.x - p.x) < this.half.x + r - 0.03 &&
      Math.abs(pl.position.y - p.y) < this.half.y + ph - 0.03 &&
      Math.abs(pl.position.z - p.z) < this.half.z + r - 0.03;
    if (overlap) this.ctx.kill('crusher');
  }

  snapshot(): unknown {
    return { ...(super.snapshot() as object), phase: this.phase };
  }

  restore(state: unknown): void {
    super.restore(state);
    this.phase = (state as { phase: number }).phase;
    this.parts[0].place(this.origin().add(this.vec('travel', [0, -2, 0]).multiplyScalar(this.extent(this.phase))));
  }
}
