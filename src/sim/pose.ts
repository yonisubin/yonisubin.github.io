import * as THREE from 'three';

// The rotation of a road vehicle that isn't physics-driven (traffic, police): turned `yaw`
// about the vertical, then tipped `pitch` nose-up about its own sideways axis (local Z, since
// cars face +X), so it lies along the slope of the road.

const UP = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const pitchQuat = new THREE.Quaternion();

export function yawPitchQuaternion(yaw: number, pitch: number, out: THREE.Quaternion): THREE.Quaternion {
  out.setFromAxisAngle(UP, yaw);
  return out.multiply(pitchQuat.setFromAxisAngle(Z_AXIS, pitch));
}
