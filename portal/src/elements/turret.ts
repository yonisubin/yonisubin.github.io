// Sentry turrets (a physics prop: knock it over, carry it, dissolve it) and the rocket turret.
//
// Turret states (spec): idle (laser sight sweeps), active (sees you inside its ~60° cone: winds up,
// then fires bursts — each bullet 4–10 % of your health), searching (lost you: keeps looking for a
// few seconds), tipped (knocked over: fires wildly for a moment, then shuts down for good),
// dissolved (grill), destroyed (hit something too hard, e.g. a fall). Carried from behind it can't
// fire; carried from the front it still can. Short original barks go out as `sfx` captions.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../core/config';
import type { ChamberContext } from '../game/context';
import type { Entity } from '../levels/level';
import { MAT, turretModel } from '../render/models';
import { BaseElement } from './base';
import { flyStep, touchesPlayer } from './pellets';
import { PhysProp, type PropShape, type PropState } from './prop';

const T = CONFIG.turret;

export type TurretState = 'idle' | 'active' | 'searching' | 'tipped' | 'dissolved' | 'destroyed';

/** Original barks (captions) per moment. */
const BARKS: Record<string, string[]> = {
  spot: ['Ah. A participant.', 'Please hold still for your assessment.', 'Visual contact. How nice.'],
  search: ['Participant? Hello?', 'Re-scanning the premises.', 'Was it something I said?'],
  idle: ['Scan concluded. Resting.', 'Nobody. Again.'],
  tipped: ['Wrong way up!', 'This is not my good angle.', 'Gravity, please reconsider.'],
  held: ['Kindly unhand my chassis.', 'Where are we going?', 'I cannot see a thing back here.'],
  dissolved: ['That shimmer tickles—'],
  destroyed: ['Clunk.'],
};

interface TurretExtra {
  state: TurretState;
  timer: number;
  windup: number;
  shots: number;
  shotClock: number;
  sweepT: number;
  fromBehind: boolean;
  shutDown: boolean;
  barkIndex: number;
}

export class Turret extends PhysProp {
  state: TurretState = 'idle';
  private timer = 0;
  private windup = 0;
  private shots = 0;
  private shotClock = 0;
  private sweepT = 0;
  private fromBehind = false;
  private shutDown = false;
  private barkIndex = 0;
  /** Bullets fired (tests). */
  fired = 0;
  private laser: THREE.Line | null = null;
  private lens: THREE.Mesh | null = null;
  private readonly laserEnd = new THREE.Vector3();

  protected makeShape(): PropShape {
    const { model, lens } = turretModel(T.radius, T.height);
    this.lens = lens;
    return {
      desc: RAPIER.ColliderDesc.cuboid(T.radius, T.height / 2, T.radius).setMass(T.mass).setFriction(CONFIG.props.friction),
      radius: Math.hypot(T.radius, T.height / 2, T.radius),
      model,
    };
  }

  protected spawnBody(pos: THREE.Vector3, quat: THREE.Quaternion): void {
    super.spawnBody(pos, quat);
    if (!this.laser) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)]);
      this.laser = this.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.8 })));
      this.laser.frustumCulled = false;
    }
  }

  useText(): string | null {
    return this.alive && !this.held ? 'E  pick up' : null;
  }

  private bark(kind: string): void {
    const lines = BARKS[kind];
    const line = lines[this.barkIndex++ % lines.length];
    this.ctx.sfx(`turret_${kind}`, line);
  }

  private set(state: TurretState): void {
    if (this.state === state) return;
    this.state = state;
    if (state === 'active') this.bark('spot');
    else if (state === 'searching') this.bark(this.held ? 'held' : 'search');
    else if (state === 'idle') this.bark('idle');
    else if (state === 'tipped') this.bark('tipped');
    else if (state === 'destroyed') this.bark('destroyed');
  }

  /** Lens position and the turret's forward (local +Z) and up. */
  private frame(): { eye: THREE.Vector3; fwd: THREE.Vector3; up: THREE.Vector3 } {
    const q = this.quaternion();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const eye = this.position().addScaledVector(up, T.height * 0.18).addScaledVector(fwd, T.radius + 0.05);
    return { eye, fwd, up };
  }

  /** Can the turret see the player right now (cone, range, line of sight)? */
  sees(): boolean {
    if (this.ctx.playerDead() || !this.body) return false;
    const { eye, fwd } = this.frame();
    const target = this.ctx.player.position.clone();
    const to = target.clone().sub(eye);
    const dist = to.length();
    if (dist > T.range || dist < 1e-3) return false;
    if (to.clone().normalize().dot(fwd) < Math.cos(T.cone / 2)) return false;
    return this.clearShot(eye, target);
  }

  private clearShot(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const d = to.clone().sub(from);
    const dist = d.length();
    const physics = this.ctx.physics;
    const hit = physics.world.castRay(new RAPIER.Ray(from, d.normalize()), dist, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.collider ?? undefined, undefined, (c) => {
      const i = physics.infoOf(c);
      return !!i && i.kind !== 'player' && i.kind !== 'tunnel' && i.kind !== 'sensor' && !(i.kind === 'clone' && i.prop === this);
    });
    return !hit;
  }

  /** The player picked it up: from behind it can't fire. */
  onPickup(playerPos: THREE.Vector3): void {
    const { fwd } = this.frame();
    this.fromBehind = fwd.dot(playerPos.clone().sub(this.position())) < 0;
  }

  update(dt: number): void {
    if (!this.alive || !this.body) return;
    this.sweepT += dt;
    if (this.state === 'dissolved' || this.state === 'destroyed') return;
    const { up } = this.frame();
    if (this.state !== 'tipped' && Math.acos(THREE.MathUtils.clamp(up.y, -1, 1)) > T.tipAngle && !this.held) {
      this.set('tipped');
      this.timer = T.tippedSeconds;
      this.shotClock = 0;
    }
    if (!this.held && this.lastImpact > CONFIG.hazards.breakSpeed) {
      this.set('destroyed');
      this.ctx.effects.burst(this.position(), 0xffa640, 0.6);
      return;
    }
    if (this.state === 'tipped') {
      if (this.shutDown) return;
      this.timer -= dt;
      this.shotClock -= dt;
      if (this.shotClock <= 0) {
        this.shotClock = 1 / T.fireRate;
        this.wildShot();
      }
      if (this.timer <= 0) this.shutDown = true;
      return;
    }
    // Switched off by the chamber (input `active`, default on).
    if (!this.input('active', true)) {
      if (this.state === 'active') this.set('searching');
      return;
    }
    if (this.held && this.fromBehind) {
      this.set('searching');
      this.timer = T.searchSeconds;
      return;
    }
    const sees = this.sees();
    if (sees) {
      if (this.state !== 'active') {
        this.set('active');
        this.windup = T.windup;
        this.shots = 0;
        this.shotClock = 0;
      }
      this.fireStep(dt);
      return;
    }
    if (this.state === 'active') {
      this.set('searching');
      this.timer = T.searchSeconds;
    } else if (this.state === 'searching') {
      this.timer -= dt;
      if (this.timer <= 0) this.set('idle');
    }
  }

  private fireStep(dt: number): void {
    if (this.windup > 0) {
      this.windup -= dt;
      return;
    }
    this.shotClock -= dt;
    if (this.shotClock > 0) return;
    if (this.shots >= T.burst) {
      this.shots = 0;
      this.shotClock = T.burstPause;
      return;
    }
    this.shots++;
    this.shotClock += 1 / T.fireRate;
    this.fired++;
    const { eye } = this.frame();
    const dmg = T.damageMin + this.ctx.random() * (T.damageMax - T.damageMin);
    this.ctx.effects.tracer(eye, this.ctx.player.eye());
    this.ctx.sfx('turretShot');
    this.ctx.hurt(dmg, 'turret');
  }

  /** Knocked over: bullets spray around the forward direction; they still hurt if they hit. */
  private wildShot(): void {
    const { eye, fwd } = this.frame();
    const spread = 0.35;
    const dir = fwd.clone().add(new THREE.Vector3((this.ctx.random() - 0.5) * spread * 2, (this.ctx.random() - 0.5) * spread * 2, (this.ctx.random() - 0.5) * spread * 2)).normalize();
    this.fired++;
    this.ctx.effects.tracer(eye, eye.clone().addScaledVector(dir, 12));
    this.ctx.sfx('turretShot');
    // Hit the player if the bullet's line passes through the capsule and nothing is in between.
    const pl = this.ctx.player.position;
    const t = pl.clone().sub(eye).dot(dir);
    if (t > 0 && t < T.range) {
      const closest = eye.clone().addScaledVector(dir, t);
      if (touchesPlayer(this.ctx, closest, 0.05) && this.clearShot(eye, closest)) {
        this.ctx.hurt(T.damageMin + this.ctx.random() * (T.damageMax - T.damageMin), 'turret');
      }
    }
  }

  dissolve(): void {
    if (!this.alive) return;
    this.state = 'dissolved';
    this.bark('dissolved');
    super.dissolve();
  }

  render(alpha: number): void {
    super.render(alpha);
    if (!this.laser) return;
    const on = this.alive && !!this.body && (this.state === 'idle' || this.state === 'active' || this.state === 'searching' || (this.state === 'tipped' && !this.shutDown));
    this.laser.visible = on;
    if (this.lens) (this.lens.material as THREE.MeshBasicMaterial).color.setHex(on ? 0xff3b2f : 0x401010);
    if (!on) return;
    const { eye, fwd, up } = this.frame();
    let dir = fwd.clone();
    if (this.state === 'active' && !this.ctx.playerDead()) dir = this.ctx.player.position.clone().sub(eye).normalize();
    else if (this.state !== 'tipped') dir.applyAxisAngle(up, Math.sin(this.sweepT * T.sweepSpeed) * T.sweep);
    const hit = this.ctx.physics.world.castRay(new RAPIER.Ray(eye, dir), T.range, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.collider ?? undefined);
    this.laserEnd.copy(eye).addScaledVector(dir, hit ? hit.timeOfImpact : T.range);
    const pos = this.laser.geometry.attributes.position as THREE.BufferAttribute;
    pos.setXYZ(0, eye.x, eye.y, eye.z);
    pos.setXYZ(1, this.laserEnd.x, this.laserEnd.y, this.laserEnd.z);
    pos.needsUpdate = true;
  }

  /** Not dangerous any more (tests and the HUD). */
  disabled(): boolean {
    return !this.alive || this.state === 'dissolved' || this.state === 'destroyed' || (this.state === 'tipped' && this.shutDown);
  }

  snapshot(): PropState {
    const s = super.snapshot();
    const extra: TurretExtra = {
      state: this.state,
      timer: this.timer,
      windup: this.windup,
      shots: this.shots,
      shotClock: this.shotClock,
      sweepT: this.sweepT,
      fromBehind: this.fromBehind,
      shutDown: this.shutDown,
      barkIndex: this.barkIndex,
    };
    return { ...s, extra };
  }

  restore(state: unknown): void {
    super.restore(state);
    const e = (state as PropState).extra as TurretExtra;
    if (!e) return;
    this.state = e.state;
    this.timer = e.timer;
    this.windup = e.windup;
    this.shots = e.shots;
    this.shotClock = e.shotClock;
    this.sweepT = e.sweepT;
    this.fromBehind = e.fromBehind;
    this.shutDown = e.shutDown;
    this.barkIndex = e.barkIndex;
  }
}

interface Rocket {
  p: THREE.Vector3;
  v: THREE.Vector3;
  age: number;
  straight: number;
  mesh: THREE.Mesh;
}

/**
 * Rocket turret (finale): a fixed launcher that tracks you; after seeing you for lockTime it fires
 * a slow rocket that steers toward you at a limited turn rate. Rockets pass through portals (and
 * then fly straight for a moment, so they can be redirected), explode on any surface, and hurt
 * within blastRadius. A rocket that hits a bossCore damages it. Input: active (default true).
 */
export class RocketTurret extends BaseElement {
  rockets: Rocket[] = [];
  private lock = 0;
  private reload = 0;
  private readonly head: THREE.Object3D;
  /** Rockets fired / exploded (tests). */
  fired = 0;
  explosions = 0;

  constructor(ctx: ChamberContext, entity: Entity) {
    super(ctx, entity);
    const o = this.origin();
    const base = this.add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.6, 16), MAT.dark()));
    base.position.copy(o).setY(o.y + 0.3);
    this.head = this.add(new THREE.Group());
    this.head.position.copy(o).setY(o.y + 1.0);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.1, 12), MAT.white());
    tube.rotation.x = Math.PI / 2;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), MAT.red());
    eye.position.set(0, 0.25, 0.3);
    this.head.add(tube, eye);
    this.fixedBox(new THREE.Vector3(0.5, 0.65, 0.5), o.clone().setY(o.y + 0.65));
    this.head.rotation.y = this.yaw();
  }

  private muzzle(): THREE.Vector3 {
    return this.head.position.clone().add(new THREE.Vector3(0, 0, 0.75).applyQuaternion(this.head.quaternion));
  }

  private sees(): boolean {
    if (this.ctx.playerDead()) return false;
    const from = this.head.position.clone().add(new THREE.Vector3(0, 0.3, 0));
    const to = this.ctx.player.eye();
    const d = to.clone().sub(from);
    const physics = this.ctx.physics;
    const hit = physics.world.castRay(new RAPIER.Ray(from, d.clone().normalize()), d.length(), true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, undefined, (c) => {
      const i = physics.infoOf(c);
      return !!i && i.kind !== 'player' && i.kind !== 'tunnel' && !(i.kind === 'solid' && i.owner === this.id);
    });
    return !hit;
  }

  update(dt: number): void {
    const R = CONFIG.rocket;
    const active = this.input('active', true);
    this.reload = Math.max(0, this.reload - dt);
    if (active && this.sees()) {
      // Turn the head toward the player.
      const to = this.ctx.player.eye().sub(this.head.position);
      this.head.rotation.set(0, Math.atan2(to.x, to.z), 0);
      this.lock += dt;
      if (this.lock >= R.lockTime && this.reload <= 0) this.fire();
    } else this.lock = 0;
    for (const r of [...this.rockets]) this.flyRocket(r, dt);
  }

  fire(): void {
    const R = CONFIG.rocket;
    const p = this.muzzle();
    const dir = this.ctx.player.eye().sub(p).normalize();
    const mesh = this.add(new THREE.Mesh(new THREE.ConeGeometry(R.radius, R.radius * 4, 10), new THREE.MeshBasicMaterial({ color: 0xff7a2f })));
    this.rockets.push({ p, v: dir.multiplyScalar(R.speed), age: 0, straight: 0, mesh });
    this.reload = R.reload;
    this.lock = 0;
    this.fired++;
    this.ctx.sfx('rocketLaunch', 'Rocket launches');
  }

  private flyRocket(r: Rocket, dt: number): void {
    const R = CONFIG.rocket;
    r.age += dt;
    r.straight = Math.max(0, r.straight - dt);
    // Homing-ish: rotate the velocity toward the player by at most turnRate·dt.
    if (r.straight <= 0 && !this.ctx.playerDead()) {
      const want = this.ctx.player.eye().sub(r.p).normalize();
      const cur = r.v.clone().normalize();
      const angle = cur.angleTo(want);
      if (angle > 1e-4) {
        const axis = new THREE.Vector3().crossVectors(cur, want).normalize();
        if (axis.lengthSq() > 0.5) r.v.applyAxisAngle(axis, Math.min(angle, R.turnRate * dt));
      }
    }
    const res = flyStep(this.ctx, r.p, r.v, R.radius, dt);
    if (res.kind === 'portal') r.straight = R.straightAfterPortal;
    if (res.kind === 'hit') {
      const info = this.ctx.physics.infoOf(res.collider);
      const owner = info && (info.kind === 'solid' || info.kind === 'sensor') ? this.ctx.elements.get(info.owner) : undefined;
      if (owner && typeof (owner as { rocketHit?: () => void }).rocketHit === 'function') (owner as unknown as { rocketHit: () => void }).rocketHit();
      this.explode(r);
      return;
    }
    if (touchesPlayer(this.ctx, r.p, R.radius) || r.age > R.life) this.explode(r);
  }

  private explode(r: Rocket): void {
    const R = CONFIG.rocket;
    this.explosions++;
    this.ctx.effects.burst(r.p, 0xff8a3d, R.blastRadius);
    this.ctx.sfx('rocketBlast', 'Explosion');
    const d = r.p.distanceTo(this.ctx.player.position);
    if (d < R.blastRadius + CONFIG.player.radius) this.ctx.hurt(R.damage * (1 - Math.max(0, d - 0.5) / R.blastRadius / 2), 'rocket');
    r.mesh.removeFromParent();
    r.mesh.geometry.dispose();
    (r.mesh.material as THREE.Material).dispose();
    this.objects.splice(this.objects.indexOf(r.mesh), 1);
    this.rockets.splice(this.rockets.indexOf(r), 1);
  }

  render(): void {
    for (const r of this.rockets) {
      r.mesh.position.copy(r.p);
      r.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), r.v.clone().normalize());
    }
  }

  snapshot(): unknown {
    return {
      ...(super.snapshot() as object),
      lock: this.lock,
      reload: this.reload,
      headYaw: this.head.rotation.y,
      rockets: this.rockets.map((r) => ({ p: r.p.toArray(), v: r.v.toArray(), age: r.age, straight: r.straight })),
    };
  }

  restore(state: unknown): void {
    super.restore(state);
    const s = state as { lock: number; reload: number; headYaw: number; rockets: { p: number[]; v: number[]; age: number; straight: number }[] };
    this.lock = s.lock;
    this.reload = s.reload;
    this.head.rotation.y = s.headYaw;
    for (const r of s.rockets) {
      const mesh = this.add(new THREE.Mesh(new THREE.ConeGeometry(CONFIG.rocket.radius, CONFIG.rocket.radius * 4, 10), new THREE.MeshBasicMaterial({ color: 0xff7a2f })));
      this.rockets.push({ p: new THREE.Vector3().fromArray(r.p), v: new THREE.Vector3().fromArray(r.v), age: r.age, straight: r.straight, mesh });
    }
  }
}
