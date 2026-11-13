import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Input } from '../input/actions';

// Third-person orbit camera with mouse look.
//
// The camera sits on a sphere around a pivot point above the player's head.
// yaw   = rotation around the world Y axis (0 → camera behind the player looking toward -Z)
// pitch = elevation angle; positive puts the camera above the pivot looking down.
//
// Offset from pivot to camera (spherical → Cartesian):
//   x = sin(yaw) * cos(pitch) * distance
//   y = sin(pitch)            * distance
//   z = cos(yaw) * cos(pitch) * distance

const PIVOT_HEIGHT = 1.6; // m above the character's origin (≈ head height)
const DISTANCE = 5; // m, preferred distance from pivot
const MIN_PITCH = -0.35; // rad, a little below horizontal
const MAX_PITCH = 1.2; // rad, ~70° looking down
const WALL_PADDING = 0.25; // m kept between camera and any wall it's pulled in front of
const FOLLOW_SHARPNESS = 20; // 1/s, how quickly the pivot catches up to the player
const ZOOM_OUT_SHARPNESS = 4; // 1/s, how quickly the camera eases back after a wall pull-in

/** Frame-rate independent smoothing factor for exponential approach: 1 - e^(-k·dt). */
function smoothing(sharpness: number, dt: number): number {
  return 1 - Math.exp(-sharpness * dt);
}

export class FollowCamera {
  yaw = 0;
  pitch = 0.3;

  private readonly pivot = new THREE.Vector3();
  private currentDistance = DISTANCE;
  private initialized = false;
  private readonly offset = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly input: Input,
    private readonly world: RAPIER.World,
    /** Collider to ignore in the wall raycast (the player's own capsule). */
    private readonly ignore: RAPIER.Collider,
  ) {}

  /** Snap straight to the target next frame instead of smoothing (e.g. after teleport). */
  reset(): void {
    this.initialized = false;
  }

  /** Horizontal forward direction the camera is looking along (unit vector, y = 0). */
  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  update(target: THREE.Vector3, dt: number): void {
    const look = this.input.consumeLook();
    this.yaw -= look.x;
    this.pitch = THREE.MathUtils.clamp(this.pitch + look.y, MIN_PITCH, MAX_PITCH);

    const desiredPivot = this.offset.set(target.x, target.y + PIVOT_HEIGHT, target.z);
    if (!this.initialized) {
      this.pivot.copy(desiredPivot);
      this.currentDistance = DISTANCE;
      this.initialized = true;
    } else {
      this.pivot.lerp(desiredPivot, smoothing(FOLLOW_SHARPNESS, dt));
    }

    // Direction from pivot toward the camera.
    const cosPitch = Math.cos(this.pitch);
    const dir = this.offset.set(
      Math.sin(this.yaw) * cosPitch,
      Math.sin(this.pitch),
      Math.cos(this.yaw) * cosPitch,
    );

    // Raycast from the pivot out to the desired camera spot. If something is in the way,
    // pull the camera in front of it immediately; ease back out when it clears.
    let allowed = DISTANCE;
    const ray = new RAPIER.Ray(this.pivot, dir);
    const hit = this.world.castRay(ray, DISTANCE, true, undefined, undefined, this.ignore);
    if (hit) allowed = Math.max(0.3, hit.timeOfImpact - WALL_PADDING);

    if (allowed < this.currentDistance) {
      this.currentDistance = allowed;
    } else {
      this.currentDistance += (allowed - this.currentDistance) * smoothing(ZOOM_OUT_SHARPNESS, dt);
    }

    this.camera.position.copy(this.pivot).addScaledVector(dir, this.currentDistance);
    this.camera.lookAt(this.pivot);
  }
}
