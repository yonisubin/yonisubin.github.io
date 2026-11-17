// Physics props: weighted cube, companion-style cube, sphere, debris (and the turret builds on this).
// A Rapier dynamic rigid body with CCD; the mesh copies the body (interpolated between steps).
//
// Portals (spec "Crossing detection"):
//  - before each step the prop finds the portals its bounding sphere overlaps; for those, the wall
//    the portal sits on is masked through the contact hook in physics/world.ts and the portal's
//    tunnel collides instead (a hole in the wall). CCD is switched off while masked, because CCD
//    would otherwise stop the body at the (masked) wall surface.
//  - after the step, if the CENTRE went from in front of a portal's plane to behind it, inside the
//    opening, the body goes through the teleport transform M: position, orientation, linear and
//    angular velocity (rotation part). Out of a floor portal it gets at least floorExitMinSpeed.
//  - while it straddles a portal, a kinematic clone of its collider sits at M·pose on the other
//    side, so the part sticking out there collides with the player and other props.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG, STEP_DT, type PortalId } from '../core/config';
import type { ChamberContext } from '../game/context';
import type { Entity } from '../levels/level';
import type { MaskState } from '../physics/world';
import type { Portal } from '../portals/portals';
import { signedDistance, teleportMatrix, teleportRotation, toLocal } from '../portals/transform';
import { cubeModel, debrisModel, sphereModel } from '../render/models';
import { BaseElement, disposeObject, type Renderable } from './base';

const W = CONFIG.portal.width;
const H = CONFIG.portal.height;

export interface PropState {
  alive: boolean;
  p: [number, number, number];
  q: [number, number, number, number];
  v: [number, number, number];
  w: [number, number, number];
  respawnIn: number;
  extra?: unknown;
}

export interface PropShape {
  desc: RAPIER.ColliderDesc;
  /** Bounding-sphere radius (portal overlap test). */
  radius: number;
  model: THREE.Object3D;
}

export interface PropTeleport {
  from: PortalId;
  to: PortalId;
  matrix: THREE.Matrix4;
}

export abstract class PhysProp extends BaseElement implements MaskState, Renderable {
  body: RAPIER.RigidBody | null = null;
  collider: RAPIER.Collider | null = null;
  radius = 0.5;
  model: THREE.Object3D | null = null;
  /** MaskState (read by the contact hook). */
  maskedSurfaces = new Set<number>();
  maskedPortals = new Set<PortalId>();
  held = false;
  alive = true;
  teleports = 0;
  lastTeleport: PropTeleport | null = null;
  /** Called on every portal pass (the carry system follows the held prop). */
  onTeleport: ((t: PropTeleport) => void) | null = null;
  /** Peak speed change in one step (impacts: breaks turrets). */
  lastImpact = 0;
  protected respawnIn = 0;
  private clone: { body: RAPIER.RigidBody; portal: Portal } | null = null;
  private readonly prevPos = new THREE.Vector3();
  private readonly prevQuat = new THREE.Quaternion();
  private readonly prevCenter = new THREE.Vector3();
  private readonly prevVel = new THREE.Vector3();

  constructor(ctx: ChamberContext, entity: Entity) {
    super(ctx, entity);
  }

  /** Create the body (called right after construction, once subclass fields exist). */
  init(): this {
    this.spawnBody(this.origin(), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw()));
    return this;
  }

  protected abstract makeShape(): PropShape;

  /** Prompt shown when the crosshair is on it. */
  useText(): string | null {
    return this.alive && !this.held ? 'E  pick up' : null;
  }

  protected spawnBody(pos: THREE.Vector3, quat: THREE.Quaternion): void {
    const shape = this.makeShape();
    this.radius = shape.radius;
    const world = this.ctx.physics.world;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
        .setLinearDamping(CONFIG.props.linearDamping)
        .setAngularDamping(CONFIG.props.angularDamping)
        .setCcdEnabled(true),
    );
    shape.desc.setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
    const collider = world.createCollider(shape.desc, body);
    this.ctx.physics.register(collider, { kind: 'prop', prop: this });
    this.body = body;
    this.collider = collider;
    this.model = shape.model;
    this.add(shape.model);
    this.alive = true;
    this.prevPos.copy(pos);
    this.prevQuat.copy(quat);
    this.syncModel(1);
  }

  /** World position of the centre (or the spawn point while gone). */
  position(out = new THREE.Vector3()): THREE.Vector3 {
    if (!this.body) return out.copy(this.origin());
    const t = this.body.translation();
    return out.set(t.x, t.y, t.z);
  }

  quaternion(out = new THREE.Quaternion()): THREE.Quaternion {
    if (!this.body) return out.identity();
    const r = this.body.rotation();
    return out.set(r.x, r.y, r.z, r.w);
  }

  velocity(out = new THREE.Vector3()): THREE.Vector3 {
    if (!this.body) return out.set(0, 0, 0);
    const v = this.body.linvel();
    return out.set(v.x, v.y, v.z);
  }

  /** Before the physics step: masking, CCD, terminal speed. */
  preStep(): void {
    const body = this.body;
    if (!body) return;
    this.position(this.prevCenter);
    this.prevPos.copy(this.prevCenter);
    this.quaternion(this.prevQuat);
    this.velocity(this.prevVel);
    const speed = this.prevVel.length();
    if (speed > CONFIG.props.maxSpeed) {
      const v = this.prevVel.clone().setLength(CONFIG.props.maxSpeed);
      body.setLinvel(v, true);
    }
    this.updateMask(speed * STEP_DT + 0.05);
  }

  private updateMask(reach: number): void {
    this.maskedSurfaces.clear();
    this.maskedPortals.clear();
    for (const p of this.ctx.portals.overlapping(this.prevCenter, 0, this.radius, reach)) {
      this.maskedSurfaces.add(p.surface);
      this.maskedPortals.add(p.id);
    }
    const ccd = this.maskedPortals.size === 0;
    if (this.body!.isCcdEnabled() !== ccd) this.body!.enableCcd(ccd);
  }

  /** After the physics step: portal crossing, clone, impacts, lost props. */
  postStep(): void {
    const body = this.body;
    if (!body) {
      if (this.respawnIn > 0) {
        this.respawnIn -= STEP_DT;
        if (this.respawnIn <= 0) this.respawnAtStart();
      }
      return;
    }
    const c1 = this.position();
    const v1 = this.velocity();
    this.lastImpact = v1.distanceTo(this.prevVel);
    this.tryTeleport(this.prevCenter, c1);
    this.updateClone();
    if (this.position().y < CONFIG.props.killY) this.respawnAtStart();
  }

  private tryTeleport(c0: THREE.Vector3, c1: THREE.Vector3): void {
    const portals = this.ctx.portals;
    if (!portals.linked()) return;
    for (const p of [portals.a!, portals.b!]) {
      const s0 = signedDistance(p, c0);
      const s1 = signedDistance(p, c1);
      if (!(s0 > 0 && s1 <= 0)) continue;
      const hit = c0.clone().lerp(c1, s0 / (s0 - s1));
      const l = toLocal(p, hit);
      if (Math.abs(l.x) > W / 2 || Math.abs(l.y) > H / 2) continue;
      this.teleportThrough(p, portals.other(p.id)!);
      return;
    }
  }

  /** Move the body through `from` → `to` with M (position, orientation, velocities). */
  teleportThrough(from: Portal, to: Portal): void {
    const body = this.body!;
    const m = teleportMatrix(from, to);
    const r = teleportRotation(from, to);
    const pos = this.position().applyMatrix4(m);
    const quat = r.clone().multiply(this.quaternion());
    const v = this.velocity().applyQuaternion(r);
    const av = body.angvel();
    const w = new THREE.Vector3(av.x, av.y, av.z).applyQuaternion(r);
    if (to.normal.y > 0.7) {
      const vn = v.dot(to.normal);
      if (vn < CONFIG.props.floorExitMinSpeed) v.addScaledVector(to.normal, CONFIG.props.floorExitMinSpeed - vn);
    }
    body.setTranslation(pos, true);
    body.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w }, true);
    body.setLinvel(v, true);
    body.setAngvel(w, true);
    // Interpolation and next step's crossing test start on the exit side.
    this.prevPos.applyMatrix4(m);
    this.prevQuat.premultiply(r);
    this.prevCenter.copy(pos);
    this.teleports++;
    const ev = { from: from.id, to: to.id, matrix: m };
    this.lastTeleport = ev;
    this.removeClone();
    this.updateMask(0.1);
    this.onTeleport?.(ev);
  }

  /** Kinematic stand-in at M·pose while the prop straddles a portal. */
  private updateClone(): void {
    const portals = this.ctx.portals;
    let straddled: Portal | null = null;
    if (portals.linked()) {
      const c = this.position();
      for (const id of this.maskedPortals) {
        const p = portals.get(id)!;
        if (Math.abs(signedDistance(p, c)) < this.radius) straddled = p;
      }
    }
    if (!straddled) {
      this.removeClone();
      return;
    }
    const to = portals.other(straddled.id)!;
    const m = teleportMatrix(straddled, to);
    const r = teleportRotation(straddled, to);
    const pos = this.position().applyMatrix4(m);
    const quat = r.multiply(this.quaternion());
    if (this.clone && this.clone.portal !== straddled) this.removeClone();
    if (!this.clone) {
      const world = this.ctx.physics.world;
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z).setRotation(quat));
      const desc = this.makeShapeDescOnly().setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
      const col = world.createCollider(desc, body);
      this.ctx.physics.register(col, { kind: 'clone', prop: this });
      this.clone = { body, portal: straddled };
    } else {
      this.clone.body.setNextKinematicTranslation(pos);
      this.clone.body.setNextKinematicRotation(quat);
    }
  }

  /** Just the collider description (for the clone). */
  protected makeShapeDescOnly(): RAPIER.ColliderDesc {
    const s = this.makeShape();
    disposeObject(s.model);
    return s.desc;
  }

  private removeClone(): void {
    if (!this.clone) return;
    if (this.ctx.physics.world.bodies.contains(this.clone.body.handle)) this.ctx.physics.removeBody(this.clone.body);
    this.clone = null;
  }

  hasClone(): boolean {
    return !!this.clone;
  }

  render(alpha: number): void {
    this.syncModel(alpha);
  }

  private syncModel(alpha: number): void {
    if (!this.model || !this.body) return;
    this.model.position.copy(this.prevPos).lerp(this.position(), alpha);
    this.model.quaternion.copy(this.prevQuat).slerp(this.quaternion(), alpha);
  }

  /** Take the body out of the world (dissolved, or before a respawn). */
  protected removeBody(): void {
    this.removeClone();
    if (this.body && this.ctx.physics.world.bodies.contains(this.body.handle)) this.ctx.physics.removeBody(this.body);
    const bi = this.bodies.indexOf(this.body!);
    if (bi >= 0) this.bodies.splice(bi, 1);
    this.body = null;
    this.collider = null;
    if (this.model) {
      this.model.removeFromParent();
      disposeObject(this.model);
      this.objects.splice(this.objects.indexOf(this.model), 1);
      this.model = null;
    }
    this.maskedPortals.clear();
    this.maskedSurfaces.clear();
  }

  /** Erased by a grill: a dissolve effect, then gone (or back at its start if props.respawn). */
  dissolve(): void {
    if (!this.alive) return;
    if (this.held) this.ctx.forceDrop();
    if (this.model) this.ctx.effects.dissolve(this.model);
    this.removeBody();
    this.alive = false;
    this.respawnIn = this.prop('respawn', false) ? CONFIG.hazards.dissolveSeconds + 0.3 : 0;
    this.ctx.events.emit('fizzled', { what: 'object', id: this.id });
    this.ctx.sfx('dissolve');
  }

  protected respawnAtStart(): void {
    if (this.held) this.ctx.forceDrop();
    this.removeBody();
    this.spawnBody(this.origin(), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw()));
    this.respawnIn = 0;
  }

  snapshot(): PropState {
    const b = this.body;
    const p = this.position(), q = this.quaternion(), v = this.velocity();
    const w = b ? b.angvel() : { x: 0, y: 0, z: 0 };
    return {
      alive: this.alive,
      p: [p.x, p.y, p.z],
      q: [q.x, q.y, q.z, q.w],
      v: [v.x, v.y, v.z],
      w: [w.x, w.y, w.z],
      respawnIn: this.respawnIn,
    };
  }

  restore(state: unknown): void {
    const s = state as PropState;
    this.removeBody();
    this.alive = s.alive;
    this.respawnIn = s.respawnIn;
    if (!s.alive) return;
    this.spawnBody(new THREE.Vector3(...s.p), new THREE.Quaternion(...s.q));
    this.body!.setLinvel({ x: s.v[0], y: s.v[1], z: s.v[2] }, true);
    this.body!.setAngvel({ x: s.w[0], y: s.w[1], z: s.w[2] }, true);
  }

  dispose(): void {
    this.removeClone();
    super.dispose();
    this.body = null;
    this.collider = null;
  }
}

export class Cube extends PhysProp {
  protected makeShape(): PropShape {
    const s = CONFIG.props.cubeSize;
    return {
      desc: RAPIER.ColliderDesc.cuboid(s / 2, s / 2, s / 2).setMass(CONFIG.props.cubeMass).setFriction(CONFIG.props.friction).setRestitution(CONFIG.props.restitution),
      radius: (s / 2) * Math.sqrt(3),
      model: cubeModel(s, this.type === 'companionCube'),
    };
  }
}

export class Sphere extends PhysProp {
  protected makeShape(): PropShape {
    const r = CONFIG.props.sphereRadius;
    return {
      desc: RAPIER.ColliderDesc.ball(r).setMass(CONFIG.props.sphereMass).setFriction(CONFIG.props.friction).setRestitution(CONFIG.props.sphereRestitution),
      radius: r,
      model: sphereModel(r),
    };
  }
}

export class Debris extends PhysProp {
  protected makeShape(): PropShape {
    const { half, model } = debrisModel(this.prop('kind', 'crate'));
    return {
      desc: RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setMass(CONFIG.props.debrisMass).setFriction(CONFIG.props.friction).setRestitution(CONFIG.props.restitution),
      radius: half.length(),
      model,
    };
  }
}

export function isProp(e: unknown): e is PhysProp {
  return e instanceof PhysProp;
}
