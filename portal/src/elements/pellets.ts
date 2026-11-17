// Energy pellets: a launcher fires one pellet along props.direction. The pellet flies straight,
// bounces off every solid surface (perfect reflection), passes through portals (centre crossing
// inside the opening, like props; masked walls don't bounce it), kills the player on contact,
// expires after props.life seconds and then the launcher fires a new one. A catcher latches when a
// pellet reaches its mouth; the launcher that fed it stops for good.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../core/config';
import type { ChamberContext } from '../game/context';
import type { Entity } from '../levels/level';
import type { Portal } from '../portals/portals';
import { signedDistance, teleportMatrix, teleportRotation, toLocal } from '../portals/transform';
import { MAT } from '../render/models';
import { BaseElement } from './base';

const HZ = CONFIG.hazards;
const W = CONFIG.portal.width;
const H = CONFIG.portal.height;

/** Distance from point p to the segment ab. */
export function segmentDistance(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = b.clone().sub(a);
  const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-12), 0, 1);
  return a.clone().addScaledVector(ab, t).distanceTo(p);
}

/** Does a sphere at p touch the player's capsule? */
export function touchesPlayer(ctx: ChamberContext, p: THREE.Vector3, r: number): boolean {
  if (ctx.playerDead()) return false;
  const pl = ctx.player;
  const hs = pl.halfSeg;
  const a = pl.position.clone().setY(pl.position.y - hs);
  const b = pl.position.clone().setY(pl.position.y + hs);
  return segmentDistance(p, a, b) < r + CONFIG.player.radius;
}

/**
 * Move a small ball (pellet, rocket) one step through the world: portals first, then solids.
 * Returns what happened. Shared by pellets and rockets.
 */
export function flyStep(
  ctx: ChamberContext,
  pos: THREE.Vector3,
  vel: THREE.Vector3,
  r: number,
  dt: number,
): { kind: 'free' } | { kind: 'portal'; from: Portal; to: Portal } | { kind: 'hit'; point: THREE.Vector3; normal: THREE.Vector3; collider: RAPIER.Collider } {
  const step = vel.length() * dt;
  if (step < 1e-9) return { kind: 'free' };
  const dir = vel.clone().normalize();
  const portals = ctx.portals;
  const masked = portals.overlapping(pos, 0, r, step + r);
  // Portal crossing along this step (centre crosses the plane inside the opening).
  let cross: { p: Portal; t: number } | null = null;
  if (portals.linked()) {
    const end = pos.clone().addScaledVector(dir, step);
    for (const p of [portals.a!, portals.b!]) {
      const s0 = signedDistance(p, pos);
      const s1 = signedDistance(p, end);
      if (!(s0 > 0 && s1 <= 0)) continue;
      const t = s0 / (s0 - s1);
      const l = toLocal(p, pos.clone().lerp(end, t));
      if (Math.abs(l.x) <= W / 2 && Math.abs(l.y) <= H / 2 && (!cross || t < cross.t)) cross = { p, t };
    }
  }
  const physics = ctx.physics;
  const hit = physics.world.castRayAndGetNormal(new RAPIER.Ray(pos, dir), step + r, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, undefined, (c) => {
    const i = physics.infoOf(c);
    if (!i) return false;
    if (i.kind === 'player' || i.kind === 'sensor') return false;
    if (i.kind === 'tunnel') return masked.some((p) => p.id === i.portal);
    if (i.kind === 'brush' || i.kind === 'solid') return !masked.some((p) => p.surface === c.handle);
    return true;
  });
  const hitDist = hit ? hit.timeOfImpact - r : Infinity;
  if (cross && cross.t * step <= hitDist + 1e-6) {
    const to = portals.other(cross.p.id)!;
    pos.addScaledVector(dir, step).applyMatrix4(teleportMatrix(cross.p, to));
    vel.applyQuaternion(teleportRotation(cross.p, to));
    return { kind: 'portal', from: cross.p, to };
  }
  if (hit && hitDist <= step) {
    const n = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
    const point = pos.clone().addScaledVector(dir, hit.timeOfImpact);
    pos.addScaledVector(dir, Math.max(0, hitDist));
    return { kind: 'hit', point, normal: n, collider: hit.collider };
  }
  pos.addScaledVector(dir, step);
  return { kind: 'free' };
}

interface PelletState {
  alive: boolean;
  p: [number, number, number];
  v: [number, number, number];
  age: number;
  wait: number;
  done: boolean;
}

/** props.direction (launch direction, default +Z rotated by yaw), life, speed. Input: active. */
export class PelletLauncher extends BaseElement {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  alive = false;
  age = 0;
  /** Seconds until the next pellet. */
  private wait = 0.5;
  /** A catcher took our pellet: stop. */
  done = false;
  bounces = 0;
  passes = 0;
  private readonly ball: THREE.Mesh;
  private readonly prev = new THREE.Vector3();

  constructor(ctx: ChamberContext, entity: Entity) {
    super(ctx, entity);
    const dir = this.direction();
    const housing = this.add(new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 0.4, 20), MAT.dark()));
    housing.position.copy(this.origin()).addScaledVector(dir, -0.1);
    housing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const ring = this.add(new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.05, 8, 24), new THREE.MeshBasicMaterial({ color: 0xffe36b })));
    ring.position.copy(this.origin()).addScaledVector(dir, 0.11);
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    this.ball = this.add(new THREE.Mesh(new THREE.SphereGeometry(HZ.pelletRadius, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff2a8 })));
    const glow = new THREE.Mesh(new THREE.SphereGeometry(HZ.pelletRadius * 1.6, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffc83d, transparent: true, opacity: 0.35, depthWrite: false }));
    this.ball.add(glow);
    this.ball.visible = false;
    this.outputs.live = false;
  }

  direction(): THREE.Vector3 {
    const d = this.entity.props?.direction ? this.vec('direction', [0, 0, 1]) : new THREE.Vector3(Math.sin(this.yaw()), 0, Math.cos(this.yaw()));
    return d.normalize();
  }

  private fire(): void {
    const dir = this.direction();
    this.pos.copy(this.origin()).addScaledVector(dir, 0.45);
    this.prev.copy(this.pos);
    this.vel.copy(dir).multiplyScalar(this.prop('speed', HZ.pelletSpeed));
    this.alive = true;
    this.age = 0;
    this.ctx.sfx('pelletLaunch', 'Energy pellet launches');
  }

  /** The pellet is gone (expired, hit the player, caught). */
  pop(caught = false): void {
    if (!this.alive) return;
    this.alive = false;
    if (!caught) this.ctx.effects.burst(this.pos, 0xffd84d, 0.8);
    this.wait = HZ.pelletRespawn;
    if (caught) this.done = true;
  }

  update(dt: number): void {
    this.prev.copy(this.pos);
    if (!this.alive) {
      if (this.done || !this.input('active', true)) return;
      this.wait -= dt;
      if (this.wait <= 0) this.fire();
      return;
    }
    this.age += dt;
    if (this.age >= this.prop('life', HZ.pelletLife)) {
      this.ctx.sfx('pelletExpire', 'Pellet fizzles out');
      this.pop();
      return;
    }
    const r = HZ.pelletRadius;
    const res = flyStep(this.ctx, this.pos, this.vel, r, dt);
    if (res.kind === 'portal') {
      this.passes++;
      this.prev.copy(this.pos);
    } else if (res.kind === 'hit') {
      // Mirror reflection: v' = v − 2 (v·n) n.
      this.vel.addScaledVector(res.normal, -2 * this.vel.dot(res.normal));
      this.bounces++;
      this.ctx.sfx('pelletBounce');
    }
    // Catchers.
    for (const el of this.ctx.elements.values()) {
      if (el instanceof PelletCatcher && !el.outputs.caught && el.mouth().distanceTo(this.pos) < HZ.catcherRadius) {
        el.catchPellet();
        this.pop(true);
        return;
      }
    }
    if (touchesPlayer(this.ctx, this.pos, r)) {
      this.pop();
      this.ctx.kill('pellet');
    }
  }

  render(alpha: number): void {
    this.ball.visible = this.alive;
    if (this.alive) this.ball.position.copy(this.prev).lerp(this.pos, alpha);
  }

  snapshot(): PelletState & object {
    return {
      ...(super.snapshot() as object),
      alive: this.alive,
      p: [this.pos.x, this.pos.y, this.pos.z],
      v: [this.vel.x, this.vel.y, this.vel.z],
      age: this.age,
      wait: this.wait,
      done: this.done,
    };
  }

  restore(state: unknown): void {
    super.restore(state);
    const s = state as PelletState;
    this.alive = s.alive;
    this.pos.set(...s.p);
    this.prev.copy(this.pos);
    this.vel.set(...s.v);
    this.age = s.age;
    this.wait = s.wait;
    this.done = s.done;
  }
}

/** Pellet receptacle facing props.direction (default +Z rotated by yaw). Output: caught (latched). */
export class PelletCatcher extends BaseElement {
  private readonly lamp: THREE.MeshBasicMaterial;

  constructor(ctx: ChamberContext, entity: Entity) {
    super(ctx, entity);
    const dir = this.direction();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const cup = this.add(new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.35, 0.5, 20, 1, true), MAT.dark()));
    (cup.material as THREE.Material).side = THREE.DoubleSide;
    cup.position.copy(this.origin()).addScaledVector(dir, -0.05);
    cup.quaternion.copy(q);
    this.lamp = new THREE.MeshBasicMaterial({ color: 0x3a3320 });
    const core = this.add(new THREE.Mesh(new THREE.CircleGeometry(0.33, 20), this.lamp));
    core.position.copy(this.origin()).addScaledVector(dir, -0.25);
    core.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    this.outputs.caught = false;
  }

  direction(): THREE.Vector3 {
    const d = this.entity.props?.direction ? this.vec('direction', [0, 0, 1]) : new THREE.Vector3(Math.sin(this.yaw()), 0, Math.cos(this.yaw()));
    return d.normalize();
  }

  /** The point a pellet must reach. */
  mouth(): THREE.Vector3 {
    return this.origin().addScaledVector(this.direction(), 0.1);
  }

  catchPellet(): void {
    this.ctx.sfx('pelletCaught', 'Receptacle locks');
    this.setOutput('caught', true);
  }

  update(): void {
    this.lamp.color.setHex(this.outputs.caught ? 0xffe36b : 0x3a3320);
  }
}
