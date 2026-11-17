// First-person kinematic character controller (Rapier KCC on a capsule) with portal travel.
//
// Momentum rules (spec): on the ground, friction pulls you quickly to the wished velocity; in the air
// your velocity is kept, and air control can steer it but never slow it down. Gravity is the only
// accelerator; total speed is capped at the terminal velocity. Landing never hurts.
//
// Portals: while the capsule overlaps an open portal, the wall under it is ignored and the portal's
// tunnel collides instead. When the EYE crosses the portal plane inside the opening, position,
// velocity and view go through the teleport transform (the eye, not the body centre, so the camera
// never ends up behind the exit surface).
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG, JUMP_SPEED, type PortalId } from '../core/config';
import type { Input } from '../input/input';
import type { Mover, Physics } from '../physics/world';
import { faceTag, type Brush } from '../levels/level';
import type { Portal, PortalSystem } from '../portals/portals';
import { teleportMatrix, teleportRotation, toLocal } from '../portals/transform';
import { CameraRig } from './cameraRig';

const P = CONFIG.player;
const halfSegFor = (height: number) => height / 2 - P.radius;

export interface TeleportEvent {
  from: PortalId;
  to: PortalId;
  speed: number;
  /** The world → world transform that was applied (the carry system follows it). */
  matrix: THREE.Matrix4;
}

export type FootSurface = 'panel' | 'metal' | 'glass' | 'other';

export class Player {
  readonly rig = new CameraRig();
  /** Capsule centre (physics state). */
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  /** Previous step's eye, for render interpolation (already moved through a portal if we teleported). */
  readonly prevEye = new THREE.Vector3();
  grounded = false;
  crouched = false;
  /** Eye height above the capsule centre; glides when crouching. */
  eyeOffset = P.eyeHeight - P.height / 2;
  /** Accumulated fall height / step counter for tests and later challenge modes. */
  teleports = 0;
  noclip = false;
  /** What the capsule touched in the last step (debug overlay, tests). */
  lastHits: { kind: string; normal: [number, number, number] }[] = [];
  lastDesired = new THREE.Vector3();
  lastMoved = new THREE.Vector3();
  /** Settings: crouch key toggles instead of being held. */
  toggleCrouch = false;
  /** Collider handle of the prop being carried (the KCC ignores it: you can't stand on it). */
  heldHandle = -1;
  /** What the feet stood on in the last step. */
  groundSurface: FootSurface = 'other';
  groundHandle = -1;

  collider!: RAPIER.Collider;
  private kcc!: RAPIER.KinematicCharacterController;
  private jumpArmed = true;
  private masked: Portal[] = [];
  private crouchWasHeld = false;
  private crouchToggled = false;
  private groundMover: Mover | null = null;
  /** World box of the moving part under the feet (riding), for keeping clear of its top. */
  private groundBox: (() => Brush) | null = null;

  constructor(
    private readonly physics: Physics,
    private readonly portals: PortalSystem,
  ) {
    this.attach();
  }

  /** (Re)create the capsule and character controller in the physics world (after a world reset). */
  attach(): void {
    const world = this.physics.world;
    // A free collider (no rigid body): the KCC reads its pose, and we set it directly every step,
    // which also makes teleporting trivial.
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(halfSegFor(P.height), P.radius));
    this.physics.register(this.collider, { kind: 'player' });
    this.kcc = world.createCharacterController(P.skin);
    this.kcc.setUp({ x: 0, y: 1, z: 0 });
    this.kcc.setMaxSlopeClimbAngle(P.maxSlope);
    // Step-up is done by hand in tryStepUp() (Rapier's autostep didn't climb box edges reliably).
    // No snap-to-ground: Rapier's snap truncates movement next to portal tunnels, and gravity
    // pressing down every step already keeps the controller grounded on flat test-chamber floors.
    this.kcc.disableSnapToGround();
    // Walking into a prop pushes it (the KCC applies impulses as if it weighed this much).
    this.kcc.setApplyImpulsesToDynamicBodies(true);
    this.kcc.setCharacterMass(CONFIG.player.mass);
    this.setCrouched(this.crouched);
    this.masked = [];
    this.groundMover = null;
    this.groundBox = null;
    this.syncCollider();
  }

  get height(): number {
    return this.crouched ? P.crouchHeight : P.height;
  }

  get halfSeg(): number {
    return halfSegFor(this.height);
  }

  eye(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.position).setY(this.position.y + this.eyeOffset);
  }

  feetY(): number {
    return this.position.y - this.height / 2;
  }

  /** Put the player standing at `feet`, facing `yaw`, at rest. */
  spawn(feet: THREE.Vector3, yaw: number): void {
    this.setCrouched(false);
    this.position.set(feet.x, feet.y + P.height / 2 + 0.01, feet.z);
    this.velocity.set(0, 0, 0);
    this.eyeOffset = P.eyeHeight - P.height / 2;
    this.rig.reset(yaw);
    this.grounded = false;
    this.syncCollider();
    this.eye(this.prevEye);
  }

  /** The portals the capsule overlaps this step (their walls are ignored). */
  maskedPortals(): readonly Portal[] {
    return this.masked;
  }

  /** Collision filter: brushes under an overlapped portal are holes; their tunnels are walls. */
  private readonly filter = (c: RAPIER.Collider): boolean => {
    const info = this.physics.infoOf(c);
    if (!info) return true;
    if (info.kind === 'player' || info.kind === 'sensor') return false;
    if (info.kind === 'tunnel') return this.masked.some((p) => p.id === info.portal);
    if (info.kind === 'brush' || info.kind === 'solid') return !this.masked.some((p) => p.surface === c.handle);
    if (info.kind === 'prop') return c.handle !== this.heldHandle;
    return true;
  };

  /** Remember what the feet stand on (riding movers, footstep surfaces, lifts). */
  private setGround(c: RAPIER.Collider): void {
    const info = this.physics.infoOf(c);
    this.groundHandle = c.handle;
    this.groundMover = info?.kind === 'solid' ? info.mover ?? null : null;
    this.groundBox = info?.kind === 'solid' && info.mover ? info.box ?? null : null;
    this.groundSurface =
      info?.kind === 'brush' ? ({ portalable: 'panel', metal: 'metal', glass: 'glass' } as const)[faceTag(info.brush, '+y')] : info?.kind === 'solid' ? 'metal' : 'other';
  }

  /** Restore the view and crouch state exactly (saves). */
  setView(yaw: number, pitch: number): void {
    this.rig.reset(yaw);
    this.rig.pitch = pitch;
  }

  /** Crouch now (restoring a save). */
  forceCrouch(on: boolean): void {
    this.setCrouched(on);
    this.crouchToggled = on;
    this.eyeOffset = on ? P.crouchHeight / 2 - P.crouchEyeFromTop : P.eyeHeight - P.height / 2;
    this.syncCollider();
    this.eye(this.prevEye);
  }

  step(dt: number, input: Input): TeleportEvent | null {
    this.eye(this.prevEye);
    this.rig.update(dt);

    // Standing on something that moved this step (platform, lift): move with it.
    if (this.groundMover && this.grounded) {
      const d = this.groundMover.delta;
      this.position.x += d.x;
      this.position.y += d.y;
      this.position.z += d.z;
      this.prevEye.set(this.prevEye.x + d.x, this.prevEye.y + d.y, this.prevEye.z + d.z);
      // Rapier's KCC can wedge itself on a kinematic box when the capsule sinks a hair inside its
      // skin (every later move returns zero, so you couldn't walk on a platform). Keep the feet a
      // little more than the skin above the part's top while riding it.
      const box = this.groundBox?.();
      if (box) {
        const clear = box.max[1] + P.skin + P.rideClearance;
        const feet = this.position.y - this.height / 2;
        if (feet < clear && feet > box.max[1] - P.stepHeight) {
          this.position.y += clear - feet;
          this.prevEye.y += clear - feet;
        }
      }
    }

    // --- Crouch (ground: keep the feet; air: pull the legs up, keep the head) -------------------
    const held = input.isHeld('crouch');
    if (this.toggleCrouch && held && !this.crouchWasHeld) this.crouchToggled = !this.crouchToggled;
    this.crouchWasHeld = held;
    const wantCrouch = this.toggleCrouch ? this.crouchToggled : held;
    if (wantCrouch && !this.crouched) {
      const dh = (P.height - P.crouchHeight) / 2;
      const eyeWorld = this.position.y + this.eyeOffset;
      this.position.y += this.grounded ? -dh : dh;
      this.setCrouched(true);
      this.eyeOffset = eyeWorld - this.position.y;
    } else if (!wantCrouch && this.crouched) {
      const dh = (P.height - P.crouchHeight) / 2;
      const candidate = this.position.clone();
      candidate.y += this.grounded ? dh : -dh;
      if (this.fits(candidate, halfSegFor(P.height))) {
        const eyeWorld = this.position.y + this.eyeOffset;
        this.position.copy(candidate);
        this.setCrouched(false);
        this.eyeOffset = eyeWorld - this.position.y;
      }
    }
    const targetEye = this.crouched ? P.crouchHeight / 2 - P.crouchEyeFromTop : P.eyeHeight - P.height / 2;
    const maxStep = P.crouchEyeSpeed * dt;
    this.eyeOffset += THREE.MathUtils.clamp(targetEye - this.eyeOffset, -maxStep, maxStep);
    // Keep the eye inside the capsule so it can't poke through a ceiling or miss a portal opening.
    const lim = this.height / 2 - 0.08;
    this.eyeOffset = THREE.MathUtils.clamp(this.eyeOffset, -lim, lim);

    // --- Velocity -----------------------------------------------------------------------------
    const f = (input.isHeld('forward') ? 1 : 0) - (input.isHeld('back') ? 1 : 0);
    const s = (input.isHeld('right') ? 1 : 0) - (input.isHeld('left') ? 1 : 0);
    const yaw = this.rig.yaw;
    const wish = new THREE.Vector3(-Math.sin(yaw) * f + Math.cos(yaw) * s, 0, -Math.cos(yaw) * f - Math.sin(yaw) * s);
    if (wish.lengthSq() > 1) wish.normalize();
    const speed = P.walkSpeed * (this.crouched ? P.crouchSpeedFactor : 1);
    const vh = new THREE.Vector3(this.velocity.x, 0, this.velocity.z);

    if (this.grounded) {
      // Move the horizontal velocity toward the wished one at a fixed rate (accelerate + friction).
      const target = wish.clone().multiplyScalar(speed);
      const diff = target.sub(vh);
      const maxDv = P.groundAccel * dt;
      if (diff.length() > maxDv) diff.setLength(maxDv);
      vh.add(diff);
      if (input.isHeld('jump') && this.jumpArmed) {
        this.velocity.y = JUMP_SPEED;
        this.grounded = false;
        this.jumpArmed = false;
      }
    } else if (wish.lengthSq() > 0) {
      // Air control: steer, never brake. Speed may only grow up to airMaxSpeed.
      const before = vh.length();
      vh.addScaledVector(wish, P.airAccel * dt);
      const cap = Math.max(before, P.airMaxSpeed);
      if (vh.length() > cap) vh.setLength(cap);
      if (before > P.airMaxSpeed && vh.length() < before) vh.setLength(before);
    }
    if (!input.isHeld('jump')) this.jumpArmed = true;
    this.velocity.x = vh.x;
    this.velocity.z = vh.z;
    this.velocity.y -= P.gravity * dt;
    if (this.velocity.length() > P.maxFallSpeed) this.velocity.setLength(P.maxFallSpeed);

    // --- Move ---------------------------------------------------------------------------------
    const desired = this.velocity.clone().multiplyScalar(dt);
    const eye0 = this.eye();
    this.masked = this.portals.overlapping(this.position, this.halfSeg, P.radius, desired.length() + P.skin);
    let moved: THREE.Vector3;
    const wasGrounded = this.grounded;
    if (this.noclip) {
      moved = desired.clone();
      this.grounded = false;
    } else {
      this.syncCollider();
      this.kcc.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.filter);
      const m = this.kcc.computedMovement();
      moved = new THREE.Vector3(m.x, m.y, m.z);
      this.grounded = this.kcc.computedGrounded();
      this.lastHits = [];
      this.groundMover = null;
      this.groundBox = null;
      this.groundHandle = -1;
      const feet = this.position.y - this.halfSeg;
      for (let i = 0; i < this.kcc.numComputedCollisions(); i++) {
        const h = this.kcc.computedCollision(i);
        if (!h || !h.collider) continue;
        const info = this.physics.infoOf(h.collider);
        // A contact under the bottom hemisphere is the ground: remember what it is.
        if (h.witness1.y < feet - P.radius * 0.5) this.setGround(h.collider);
        const kind = !info ? '?' : info.kind === 'brush' ? `brush${info.index}` : info.kind === 'tunnel' ? `tunnel-${info.portal}` : info.kind;
        this.lastHits.push({ kind, normal: [h.normal1.x, h.normal1.y, h.normal1.z] });
      }
      const stepped = wasGrounded ? this.tryStepUp(desired, moved) : null;
      if (stepped) {
        moved = stepped;
        this.grounded = true;
        // Keep the eye where it was and let it glide up (no camera pop on stairs).
        this.eyeOffset -= stepped.y;
      }
    }
    this.position.add(moved);
    // Standing still, the KCC may report no ground contact (the skin gap absorbs the tiny gravity
    // step), so also probe straight down from the capsule centre.
    if (this.grounded && !this.noclip) {
      const reach = this.halfSeg + P.radius + 0.12;
      const hit = this.physics.world.castRay(new RAPIER.Ray(this.position, { x: 0, y: -1, z: 0 }), reach, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.collider, undefined, this.filter);
      if (hit) this.setGround(hit.collider);
    }
    this.lastDesired.copy(desired);
    this.lastMoved.copy(moved);

    // Blocked movement removes the matching velocity (slide along walls, stop on floors/ceilings).
    if (this.grounded && this.velocity.y < 0) this.velocity.y = 0;
    if (this.velocity.y > 0 && moved.y < desired.y * 0.5) this.velocity.y = 0;
    const dh = Math.hypot(desired.x, desired.z);
    const mh = Math.hypot(moved.x, moved.z);
    if (dh > 1e-6 && mh < dh * 0.999) {
      this.velocity.x = moved.x / dt;
      this.velocity.z = moved.z / dt;
    }

    // --- Portal crossing ----------------------------------------------------------------------
    const ev = this.tryTeleport(eye0, this.eye());
    this.syncCollider();
    return ev;
  }

  /**
   * Blocked while walking on the ground? Try the move again lifted by up to the step height, then
   * settle back down. Accept it if we land on something higher (≤ step height) and got further.
   */
  private tryStepUp(desired: THREE.Vector3, moved: THREE.Vector3): THREE.Vector3 | null {
    const dh = Math.hypot(desired.x, desired.z);
    const mh = Math.hypot(moved.x, moved.z);
    if (dh < 1e-6 || mh > dh * 0.7) return null;
    const flags = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
    const start = this.position.clone();
    const at = (p: THREE.Vector3) => this.collider.setTranslation({ x: p.x, y: p.y, z: p.z });
    const cast = (p: THREE.Vector3, d: THREE.Vector3) => {
      at(p);
      this.kcc.computeColliderMovement(this.collider, d, flags, undefined, this.filter);
      const m = this.kcc.computedMovement();
      return new THREE.Vector3(m.x, m.y, m.z);
    };
    // Probe: lifted by the step height, is there room a body-width ahead, and floor under it?
    const up = cast(start, new THREE.Vector3(0, P.stepHeight, 0));
    let result: THREE.Vector3 | null = null;
    if (up.y > P.stepHeight * 0.5) {
      const dir = new THREE.Vector3(desired.x, 0, desired.z).normalize();
      const p1 = start.clone().add(up);
      const probe = cast(p1, dir.clone().multiplyScalar(P.radius + 0.1));
      if (probe.length() > P.radius * 0.8) {
        const p2 = p1.clone().add(probe);
        const down = cast(p2, new THREE.Vector3(0, -(up.y + 0.05), 0));
        const rise = p2.y + down.y - start.y;
        if (this.kcc.computedGrounded() && rise > 0.01 && rise <= P.stepHeight + 0.01) {
          // Step: rise to the new floor height, then make this tick's horizontal move.
          const lifted = start.clone().setY(start.y + rise);
          const fwd = cast(lifted, new THREE.Vector3(desired.x, 0, desired.z));
          result = new THREE.Vector3(fwd.x, rise, fwd.z);
        }
      }
    }
    at(start);
    return result;
  }

  private tryTeleport(eye0: THREE.Vector3, eye1: THREE.Vector3): TeleportEvent | null {
    if (!this.portals.linked()) return null;
    let best: { p: Portal; t: number } | null = null;
    for (const p of [this.portals.a!, this.portals.b!]) {
      const s0 = p.normal.dot(eye0.clone().sub(p.position));
      const s1 = p.normal.dot(eye1.clone().sub(p.position));
      if (!(s0 > 0 && s1 <= 0)) continue;
      const t = s0 / (s0 - s1);
      const hit = eye0.clone().lerp(eye1, t);
      const l = toLocal(p, hit);
      if (Math.abs(l.x) > CONFIG.portal.width / 2 || Math.abs(l.y) > CONFIG.portal.height / 2) continue;
      if (!best || t < best.t) best = { p, t };
    }
    if (!best) return null;
    const from = best.p;
    const to = this.portals.other(from.id)!;
    const m = teleportMatrix(from, to);
    const r = teleportRotation(from, to);

    const eye = eye1.clone().applyMatrix4(m);
    this.prevEye.applyMatrix4(m);
    this.velocity.applyQuaternion(r);
    this.rig.applyTeleport(r);
    this.position.copy(eye).setY(eye.y - this.eyeOffset);
    this.grounded = false;

    if (to.normal.y > 0.7) {
      // Out of a floor portal: guarantee enough speed to clear the hole (no jittering back in).
      const vn = this.velocity.dot(to.normal);
      if (vn < CONFIG.portal.floorExitMinSpeed) this.velocity.addScaledVector(to.normal, CONFIG.portal.floorExitMinSpeed - vn);
    } else {
      // The body hangs below the eye; if part of it ends up behind the exit surface outside the
      // opening (inside solid wall), push it straight out along the normal.
      const hs = this.halfSeg;
      const e1 = toLocal(to, new THREE.Vector3(this.position.x, this.position.y + hs, this.position.z));
      const e2 = toLocal(to, new THREE.Vector3(this.position.x, this.position.y - hs, this.position.z));
      const r0 = P.radius;
      const inside =
        Math.max(Math.abs(e1.x), Math.abs(e2.x)) + r0 < CONFIG.portal.width / 2 &&
        Math.max(e1.y, e2.y) + r0 < CONFIG.portal.height / 2 &&
        Math.min(e1.y, e2.y) - r0 > -CONFIG.portal.height / 2;
      const zMin = Math.min(e1.z, e2.z) - r0;
      if (!inside && zMin < P.skin) {
        const push = P.skin + 0.01 - zMin;
        this.position.addScaledVector(to.normal, push);
        this.prevEye.addScaledVector(to.normal, push);
      }
    }
    this.teleports++;
    this.groundMover = null;
    this.masked = this.portals.overlapping(this.position, this.halfSeg, P.radius, 0.1);
    return { from: from.id, to: to.id, speed: this.velocity.length(), matrix: m };
  }

  private fits(center: THREE.Vector3, halfSeg: number): boolean {
    let free = true;
    const shape = new RAPIER.Capsule(halfSeg, P.radius - 0.01);
    this.physics.world.intersectionsWithShape(center, { x: 0, y: 0, z: 0, w: 1 }, shape, (c) => {
      if (!this.filter(c)) return true;
      free = false;
      return false;
    });
    return free;
  }

  private setCrouched(on: boolean): void {
    this.crouched = on;
    this.collider.setHalfHeight(halfSegFor(on ? P.crouchHeight : P.height));
  }

  private syncCollider(): void {
    this.collider.setTranslation({ x: this.position.x, y: this.position.y, z: this.position.z });
  }
}
