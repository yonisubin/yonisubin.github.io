import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Input } from '../input/actions';
import type { PlayerMode } from './state';
import { FollowCamera } from '../camera/followCamera';

// On-foot movement using Rapier's kinematic character controller.
//
// The capsule is a *kinematic position-based* body: we decide where it should go each step,
// ask the character controller to resolve that move against the world (sliding along walls,
// stepping up small ledges, snapping down onto slopes), then hand the corrected position to
// the body with setNextKinematicTranslation(). Gravity is ours to integrate.

const CAPSULE_RADIUS = 0.35; // m
const CAPSULE_HALF_HEIGHT = 0.55; // m, cylinder half-length → total height 2·(0.55+0.35) = 1.8 m
const WALK_SPEED = 4; // m/s
const RUN_SPEED = 7.5; // m/s
const JUMP_HEIGHT = 1.2; // m, apex height of a jump from standing
const GRAVITY = 20; // m/s². Higher than real 9.81 — games feel floaty at real gravity.
const GROUND_ACCEL = 14; // 1/s, how fast horizontal velocity reaches its target on the ground
const AIR_ACCEL = 2.5; // 1/s, reduced air control
const TURN_SHARPNESS = 12; // 1/s, how fast the body turns to face the movement direction
const FALL_RESPAWN_Y = -50; // m, respawn if we fall off the world

// Takeoff speed needed to reach JUMP_HEIGHT under constant gravity: v² = 2·g·h.
const JUMP_SPEED = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT);

const SPAWN = new THREE.Vector3(0, 2, 8);

export class OnFootMode implements PlayerMode {
  readonly name = 'OnFoot';

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
  ) {
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(SPAWN.x, SPAWN.y, SPAWN.z),
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
    this.visual = createCharacterMesh();
    scene.add(this.visual);

    this.curr.copy(SPAWN);
    this.prev.copy(SPAWN);
  }

  enter(): void {
    this.visual.visible = true;
    this.cameraRig.reset();
  }

  exit(): void {
    this.visual.visible = false;
  }

  update(dt: number): void {
    // --- Horizontal: steer toward a target velocity relative to where the camera looks.
    this.cameraRig.forward(this.fwd);
    this.right.set(-this.fwd.z, 0, this.fwd.x); // forward rotated 90° clockwise (seen from above)

    const ix = Number(this.input.isDown('moveRight')) - Number(this.input.isDown('moveLeft'));
    const iz = Number(this.input.isDown('moveForward')) - Number(this.input.isDown('moveBack'));
    this.wish.set(0, 0, 0).addScaledVector(this.fwd, iz).addScaledVector(this.right, ix);
    if (this.wish.lengthSq() > 1) this.wish.normalize(); // diagonals aren't faster
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
    this.controller.computeColliderMovement(this.collider, desired);
    const moved = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();

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

    if (this.curr.y < FALL_RESPAWN_Y) {
      this.curr.copy(SPAWN);
      this.prev.copy(SPAWN);
      this.velocity.set(0, 0, 0);
      this.body.setTranslation(SPAWN, true);
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

    // Camera pivots around the character's feet + head height.
    this.renderPos.y -= CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS;
    this.cameraRig.update(this.renderPos, frameDt);
  }

  /** Debug info for the HUD / tests. */
  get debug(): { position: THREE.Vector3; grounded: boolean } {
    return { position: this.curr, grounded: this.grounded };
  }
}

/** Placeholder character: a capsule with a "visor" so you can see which way it faces. */
function createCharacterMesh(): THREE.Group {
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
