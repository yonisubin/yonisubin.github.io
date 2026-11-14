import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';

/**
 * First spot (from `localCandidates`, in the vehicle's local frame) where the player's
 * capsule fits without touching anything except the vehicle itself. Returns the capsule
 * centre in world space, or a spot on top of the vehicle if every side is blocked.
 */
export function findFreeSpot(
  world: RAPIER.World,
  shape: RAPIER.Shape,
  standHeight: number,
  vehicle: RAPIER.RigidBody,
  position: THREE.Vector3,
  rotation: THREE.Quaternion,
  localCandidates: THREE.Vector3[],
  roofHeight: number,
): THREE.Vector3 {
  const identity = { x: 0, y: 0, z: 0, w: 1 };
  for (const local of localCandidates) {
    const p = local.clone().applyQuaternion(rotation).add(position);
    p.y = position.y + standHeight + 0.05;
    let blocked = false;
    world.intersectionsWithShape(
      p,
      identity,
      shape,
      () => {
        blocked = true;
        return false; // stop at the first hit
      },
      undefined,
      undefined,
      undefined,
      vehicle,
    );
    if (!blocked) return p;
  }
  return position.clone().add(new THREE.Vector3(0, roofHeight + standHeight, 0));
}
