// The teleport transform between two linked portals (pure maths, no scene state).
//
// A portal's frame T: origin on the surface at the portal centre, local X = right, Y = up,
// Z = surface normal (out of the wall, toward the player). Going in through A and out of B:
//
//     M = T_B · R_180(up) · T_A⁻¹
//
// T_A⁻¹ takes a world point into A's local frame. The 180° turn about local Y maps "in front of A"
// (+Z) to "behind B" (−Z) and flips left/right, so walking into A's front makes you walk out of B's
// front. T_B puts the result back in world space. Applied to directions (velocity, view) we use only
// the rotation part. Speed is preserved because M is rigid (rotation + translation, no scale).
import * as THREE from 'three';

export interface PortalFrame {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

const R180 = new THREE.Matrix4().makeRotationY(Math.PI);

export function frameMatrix(f: PortalFrame, out = new THREE.Matrix4()): THREE.Matrix4 {
  return out.compose(f.position, f.quaternion, new THREE.Vector3(1, 1, 1));
}

/** World → world matrix for something that enters `from` and leaves `to`. */
export function teleportMatrix(from: PortalFrame, to: PortalFrame, out = new THREE.Matrix4()): THREE.Matrix4 {
  const tA = frameMatrix(from);
  const tB = frameMatrix(to);
  return out.copy(tB).multiply(R180).multiply(tA.invert());
}

/** The rotation part of `teleportMatrix` as a quaternion (for velocities and orientations). */
export function teleportRotation(from: PortalFrame, to: PortalFrame, out = new THREE.Quaternion()): THREE.Quaternion {
  const r180 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  return out.copy(to.quaternion).multiply(r180).multiply(from.quaternion.clone().invert());
}

/** Portal normal (local +Z) in world space. */
export function frameNormal(f: PortalFrame, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(0, 0, 1).applyQuaternion(f.quaternion);
}

/** Signed distance of a point from the portal's plane (positive = in front). */
export function signedDistance(f: PortalFrame, p: THREE.Vector3): number {
  return frameNormal(f).dot(new THREE.Vector3().subVectors(p, f.position));
}

/** A world point in the portal's local frame (x = right, y = up, z = out of the surface). */
export function toLocal(f: PortalFrame, p: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
  return out.subVectors(p, f.position).applyQuaternion(f.quaternion.clone().invert());
}
