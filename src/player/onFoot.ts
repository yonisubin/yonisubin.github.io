import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Input } from '../input/actions';
import type { PlayerMode, TouchButton } from './state';
import { FollowCamera } from '../camera/followCamera';
import type { CharacterModel } from './character';
import type { PlayerStats } from '../game/stats';

// On-foot movement using Rapier's kinematic character controller.
//
// The capsule is a *kinematic position-based* body: we decide where it should go each step,
// ask the character controller to resolve that move against the world (sliding along walls,
// stepping up small ledges, snapping down onto slopes), then hand the corrected position to
// the body with setNextKinematicTranslation(). Gravity is ours to integrate.

const CAPSULE_RADIUS = 0.35; // m
const CAPSULE_HALF_HEIGHT = 0.55; // m, cylinder half-length → total height 2·(0.55+0.35) = 1.8 m
const WALK_SPEED = 2.0; // m/s, a brisk city walk
const RUN_SPEED = 5.5; // m/s
const JUMP_HEIGHT = 1.2; // m, apex height of a jump from standing
const GRAVITY = 20; // m/s². Higher than real 9.81 — games feel floaty at real gravity.
const GROUND_ACCEL = 14; // 1/s, how fast horizontal velocity reaches its target on the ground
const AIR_ACCEL = 2.5; // 1/s, reduced air control
const TURN_SHARPNESS = 12; // 1/s, how fast the body turns to face the movement direction
const FALL_RESPAWN_Y = -50; // m, respawn if we fall off the world

// Takeoff speed needed to reach JUMP_HEIGHT under constant gravity: v² = 2·g·h.
const JUMP_SPEED = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT);

/** Distance from the capsule centre down to the feet. */
export const STAND_HEIGHT = CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS;

// Falling: landing faster than this is safe; above it, damage grows with the extra speed.
// Under this game's gravity a 3 m drop lands at ~11 m/s (no damage), 5 m at ~14 m/s
// (~25 damage), 10 m at 20 m/s (~65 damage) and ~15 m is fatal.
const SAFE_FALL_SPEED = 11; // m/s
const FALL_DAMAGE = 7; // health per m/s over the safe speed

/** Something the player can use with E: a vehicle, a person, the shop… */
export interface Interactable {
  /** Verb for the prompt: "drive", "talk", "shop". */
  label(): string;
  /** Current position. */
  position(): THREE.Vector3;
  /** How close (m, horizontally) the player must be. */
  radius: number;
  /** False hides it (e.g. carjacking without a weapon). */
  available?(): boolean;
  activate(): void;
}

export class OnFootMode implements PlayerMode {
  readonly name = 'OnFoot';
  readonly controlsHint = 'WASD move · Shift run · Space jump · E use · Q weapon · F/click attack';
  readonly touchButtons: TouchButton[] = [
    { label: 'JUMP', action: 'jump' },
    { label: 'WEAPON', action: 'nextWeapon', visible: () => this.stats.owned.size > 1 },
    { label: () => this.nearest?.label().toUpperCase() ?? '', action: 'interact', visible: () => this.nearest !== null },
  ];
  /** Things the player can use with E; filled in by the game. */
  readonly interactables: Interactable[] = [];
  private nearest: Interactable | null = null;

  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly cameraRig: FollowCamera;
  private readonly visual: THREE.Group;

  // Physics state. `prev`/`curr` are the capsule centre at the last two physics steps;
  // render() interpolates between them so motion is smooth at any refresh rate.
  private readonly prev = new THREE.Vector3();
  private readonly curr = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private grounded = false;
  private facing = 0; // rad, visual yaw of the character
  private groundSpeed = 0; // m/s, horizontal speed actually moved last step (drives animation)

  // Scratch objects reused every step to avoid allocations.
  private readonly fwd = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly wish = new THREE.Vector3();
  private readonly renderPos = new THREE.Vector3();

  constructor(
    world: RAPIER.World,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    private readonly input: Input,
    private readonly spawn: THREE.Vector3,
    /** Animated model; falls back to a plain capsule if it failed to load. */
    private readonly model: CharacterModel | null,
    private readonly stats: PlayerStats,
  ) {
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z),
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS),
      this.body,
    );

    // Skin width: the controller keeps this gap between the capsule and the world
    // to avoid numerical sticking. 1 cm is invisible but robust.
    this.controller = world.createCharacterController(0.01);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setMaxSlopeClimbAngle((45 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((50 * Math.PI) / 180);
    // Step up ledges up to 0.4 m (curbs, stairs) if there's at least 0.2 m of floor on top.
    this.controller.enableAutostep(0.4, 0.2, false);
    // Keep feet glued to the ground when walking down slopes/steps up to 0.3 m.
    this.controller.enableSnapToGround(0.3);
    this.controller.setApplyImpulsesToDynamicBodies(true);

    this.cameraRig = new FollowCamera(camera, input, world, this.collider);
    this.visual = new THREE.Group();
    if (model) {
      // The model's origin is at its feet; the group's origin is the capsule centre.
      model.root.position.y = -(CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS);
      this.visual.add(model.root);
    } else {
      this.visual.add(createCapsuleMesh());
    }
    scene.add(this.visual);

    this.curr.copy(spawn);
    this.prev.copy(spawn);
  }

  enter(): void {
    this.visual.visible = true;
    this.collider.setEnabled(true);
    this.cameraRig.reset();
  }

  exit(): void {
    // Inside a vehicle: hide the body and take the capsule out of the physics world.
    this.visual.visible = false;
    this.collider.setEnabled(false);
    this.velocity.set(0, 0, 0);
    this.groundSpeed = 0;
  }

  /** The capsule's collision shape, for checking where the player can stand. */
  get shape(): RAPIER.Shape {
    return this.collider.shape;
  }

  /**
   * Teleport (e.g. when getting out of a vehicle) so the capsule centre is at `capsuleCentre`.
   * `cameraYaw` points the camera the same way the vehicle camera was looking.
   */
  placeAt(capsuleCentre: THREE.Vector3, facing: number, cameraYaw: number): void {
    this.curr.copy(capsuleCentre);
    this.prev.copy(capsuleCentre);
    this.body.setTranslation(capsuleCentre, true);
    this.facing = facing;
    this.cameraRig.yaw = cameraYaw;
  }

  private findNearest(): Interactable | null {
    let best: Interactable | null = null;
    let bestDist = Infinity;
    for (const e of this.interactables) {
      if (e.available && !e.available()) continue;
      const p = e.position();
      const dist = Math.hypot(p.x - this.curr.x, p.z - this.curr.z);
      if (dist < e.radius && dist < bestDist && Math.abs(p.y - this.curr.y) < 3) {
        best = e;
        bestDist = dist;
      }
    }
    return best;
  }

  update(dt: number): void {
    this.nearest = this.findNearest();
    if (this.input.consumePressed('nextWeapon')) this.stats.cycleWeapon();
    if (this.input.consumePressed('interact') && this.nearest) {
      this.nearest.activate();
      return;
    }

    // --- Horizontal: steer toward a target velocity relative to where the camera looks.
    this.cameraRig.forward(this.fwd);
    this.right.set(-this.fwd.z, 0, this.fwd.x); // forward rotated 90° clockwise (seen from above)

    // Axis length ≤ 1: full for keys, proportional for a partly pushed touch stick.
    const axis = this.input.moveAxis();
    this.wish.set(0, 0, 0).addScaledVector(this.fwd, axis.y).addScaledVector(this.right, axis.x);
    const speed = this.input.isDown('run') ? RUN_SPEED : WALK_SPEED;
    this.wish.multiplyScalar(speed);

    // Exponential approach: v += (target − v)·(1 − e^(−k·dt)). Frame-rate independent.
    const k = 1 - Math.exp(-(this.grounded ? GROUND_ACCEL : AIR_ACCEL) * dt);
    this.velocity.x += (this.wish.x - this.velocity.x) * k;
    this.velocity.z += (this.wish.z - this.velocity.z) * k;

    // --- Vertical: jump impulse, then integrate gravity (semi-implicit Euler).
    const jumpPressed = this.input.consumePressed('jump');
    if (jumpPressed && this.grounded) {
      this.velocity.y = JUMP_SPEED;
      this.grounded = false;
    }
    this.velocity.y -= GRAVITY * dt;

    // --- Resolve the desired move against the world.
    const desired = {
      x: this.velocity.x * dt,
      y: this.velocity.y * dt,
      z: this.velocity.z * dt,
    };
    const wasAirborne = !this.grounded;
    const fallSpeed = -this.velocity.y;
    this.controller.computeColliderMovement(this.collider, desired);
    const moved = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    // Landing hard hurts.
    if (wasAirborne && this.grounded && fallSpeed > SAFE_FALL_SPEED) {
      this.stats.damage((fallSpeed - SAFE_FALL_SPEED) * FALL_DAMAGE);
    }

    // Standing on something: cancel downward velocity so it doesn't build up forever.
    // We still apply one step of gravity next frame, which is what keeps us "touching"
    // the ground so computedGrounded() stays true.
    if (this.grounded && this.velocity.y < 0) this.velocity.y = 0;
    // Bonked a ceiling: we wanted to go up but were blocked.
    if (desired.y > 0 && moved.y < desired.y * 0.5) this.velocity.y = 0;
    // Hit a wall: drop the blocked part of horizontal velocity so we don't keep pushing.
    if (dt > 0) {
      this.velocity.x = moved.x / dt;
      this.velocity.z = moved.z / dt;
    }

    this.prev.copy(this.curr);
    this.curr.set(this.curr.x + moved.x, this.curr.y + moved.y, this.curr.z + moved.z);

    this.groundSpeed = dt > 0 ? Math.hypot(moved.x, moved.z) / dt : 0;

    if (this.curr.y < FALL_RESPAWN_Y) {
      this.curr.copy(this.spawn);
      this.prev.copy(this.spawn);
      this.velocity.set(0, 0, 0);
      this.body.setTranslation(this.spawn, true);
      this.cameraRig.reset();
      return;
    }

    // Applied during the following world.step().
    this.body.setNextKinematicTranslation(this.curr);

    // Visual facing: turn toward horizontal movement direction.
    if (this.wish.lengthSq() > 0.01) {
      const targetYaw = Math.atan2(-this.wish.x, -this.wish.z);
      // Shortest signed angle difference, wrapped to (−π, π].
      let diff = targetYaw - this.facing;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.facing += diff * (1 - Math.exp(-TURN_SHARPNESS * dt));
    }
  }

  render(alpha: number, frameDt: number): void {
    this.renderPos.lerpVectors(this.prev, this.curr, alpha);
    // The mesh copies the physics position; facing is visual-only (the capsule body never rotates).
    this.visual.position.copy(this.renderPos);
    this.visual.rotation.y = this.facing;
    this.model?.update(this.groundSpeed, this.grounded, frameDt);

    // Camera pivots around the character's feet + head height.
    this.renderPos.y -= CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS;
    this.cameraRig.update(this.renderPos, frameDt);
  }

  focus(): THREE.Vector3 {
    return this.curr;
  }

  prompt(): string | null {
    return this.nearest ? `E — ${this.nearest.label()}` : null;
  }

  status(): string | null {
    return null;
  }

  /** Debug info for tests. */
  get debug(): { position: THREE.Vector3; grounded: boolean } {
    return { position: this.curr, grounded: this.grounded };
  }
}

/** Fallback character: a capsule with a "visor" so you can see which way it faces. */
function createCapsuleMesh(): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(CAPSULE_RADIUS, CAPSULE_HALF_HEIGHT * 2, 8, 16),
    new THREE.MeshStandardMaterial({ color: 0xff8a3d, roughness: 0.6 }),
  );
  body.castShadow = true;
  group.add(body);

  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.15, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.2 }),
  );
  visor.position.set(0, 0.55, -0.28); // front of the head; the character faces −Z
  visor.castShadow = true;
  group.add(visor);
  return group;
}
