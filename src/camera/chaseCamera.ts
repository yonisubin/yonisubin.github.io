import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Input } from '../input/actions';

// Chase camera for vehicles: sits behind the vehicle's heading and swings around with it.
// Mouse / touch drag orbits around the vehicle; after a moment without input the orbit
// eases back to straight behind.
//
// Same spherical convention as the on-foot camera: the offset from the pivot to the camera
// is (sin(yaw)·cos(pitch), sin(pitch), cos(yaw)·cos(pitch)) · distance, and yaw = 0 puts
// the camera on +Z looking toward −Z.

export interface ChaseSettings {
  distance: number; // m behind the pivot
  pivotHeight: number; // m above the vehicle origin that the camera looks at
  pitch: number; // rad, default elevation
}

const RECENTER_DELAY = 1.5; // s without look input before the orbit swings back
const RECENTER_SHARPNESS = 2.5; // 1/s
const HEADING_SHARPNESS = 5; // 1/s, how tightly the camera follows the vehicle's turns
const MIN_PITCH = -0.2;
const MAX_PITCH = 1.3;
const WALL_PADDING = 0.3;

function smoothing(sharpness: number, dt: number): number {
  return 1 - Math.exp(-sharpness * dt);
}

/** Wrap an angle difference to (−π, π]. */
function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export class ChaseCamera {
  private yaw = 0; // camera yaw actually used (follows heading with lag)
  private orbitYaw = 0; // extra yaw from the player's look input
  private orbitPitch = 0;
  private idle = 0; // seconds since the last look input
  private currentDistance: number;
  private initialized = false;
  private readonly pivot = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly input: Input,
    private readonly world: RAPIER.World,
    private readonly settings: ChaseSettings,
    /** The vehicle's own body, ignored by the wall raycast. */
    private readonly ignoreBody: RAPIER.RigidBody,
  ) {
    this.currentDistance = settings.distance;
  }

  reset(): void {
    this.initialized = false;
    this.orbitYaw = 0;
    this.orbitPitch = 0;
  }

  /**
   * @param target  interpolated vehicle position
   * @param forward the vehicle's forward direction (any length; only its horizontal part is used)
   */
  update(target: THREE.Vector3, forward: THREE.Vector3, dt: number): void {
    const look = this.input.consumeLook();
    if (look.x !== 0 || look.y !== 0) {
      this.idle = 0;
      this.orbitYaw = wrap(this.orbitYaw - look.x);
      this.orbitPitch += look.y;
    } else {
      this.idle += dt;
      if (this.idle > RECENTER_DELAY) {
        const k = smoothing(RECENTER_SHARPNESS, dt);
        this.orbitYaw -= this.orbitYaw * k;
        this.orbitPitch -= this.orbitPitch * k;
      }
    }

    // Camera behind the vehicle: opposite its horizontal forward direction.
    const headingYaw = Math.atan2(-forward.x, -forward.z);
    const pivotTarget = this.dir.set(target.x, target.y + this.settings.pivotHeight, target.z);
    if (!this.initialized) {
      this.yaw = headingYaw;
      this.pivot.copy(pivotTarget);
      this.currentDistance = this.settings.distance;
      this.initialized = true;
    } else {
      this.yaw += wrap(headingYaw - this.yaw) * smoothing(HEADING_SHARPNESS, dt);
      this.pivot.lerp(pivotTarget, smoothing(25, dt));
    }

    const yaw = this.yaw + this.orbitYaw;
    const pitch = THREE.MathUtils.clamp(this.settings.pitch + this.orbitPitch, MIN_PITCH, MAX_PITCH);
    this.orbitPitch = pitch - this.settings.pitch;
    const cp = Math.cos(pitch);
    this.dir.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);

    // Pull in front of walls between the vehicle and the camera; ease back out.
    const desired = this.settings.distance;
    let allowed = desired;
    const hit = this.world.castRay(
      new RAPIER.Ray(this.pivot, this.dir),
      desired,
      true,
      undefined,
      undefined,
      undefined,
      this.ignoreBody,
    );
    if (hit) allowed = Math.max(1, hit.timeOfImpact - WALL_PADDING);
    if (allowed < this.currentDistance) this.currentDistance = allowed;
    else this.currentDistance += (allowed - this.currentDistance) * smoothing(3, dt);

    this.camera.position.copy(this.pivot).addScaledVector(this.dir, this.currentDistance);
    this.camera.lookAt(this.pivot);
  }
}
