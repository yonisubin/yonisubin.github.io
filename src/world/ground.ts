import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

// Milestone 1 test level: a big flat ground plus a few obstacles to try
// walking, stepping, jumping and slopes. Replaced by the city in Milestone 2.

const GROUND_SIZE = 400; // m

export function createTestLevel(scene: THREE.Scene, world: RAPIER.World): void {
  // Ground: a thin fixed box whose top surface is at y = 0.
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(GROUND_SIZE / 2, 0.5, GROUND_SIZE / 2).setTranslation(0, -0.5, 0),
  );
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
    new THREE.MeshStandardMaterial({ color: 0x6b8f5a, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // 1 m grid lines give a sense of speed and scale.
  const grid = new THREE.GridHelper(GROUND_SIZE, GROUND_SIZE, 0x4d6b40, 0x5c7d4d);
  grid.position.y = 0.01;
  scene.add(grid);

  // Steps: 0.2 m and 0.35 m are auto-stepped; 0.6 m needs a jump.
  addBox(scene, world, [2, 0.2, 2], [-6, 0.1, 0], 0, 0x9aa5b1);
  addBox(scene, world, [2, 0.35, 2], [-6, 0.175, -3], 0, 0x8a95a1);
  addBox(scene, world, [2, 0.6, 2], [-6, 0.3, -6], 0, 0x7a8591);
  // Platform reachable with a jump (jump height is 1.2 m).
  addBox(scene, world, [3, 1, 3], [-6, 0.5, -10], 0, 0x6a7581);

  // Walkable 20° ramp and too-steep 55° ramp.
  addRamp(scene, world, 20, [6, 0, -4], 0xc9a26b);
  addRamp(scene, world, 55, [11, 0, -4], 0xb5655a);

  // Walls to test sliding and the camera pulling in.
  addBox(scene, world, [12, 3, 0.5], [0, 1.5, -16], 0, 0xd8d0c0);
  addBox(scene, world, [0.5, 3, 8], [-12, 1.5, -10], 0, 0xd8d0c0);

  // Some scattered pillars for scale.
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const r = 30;
    addBox(scene, world, [1, 4, 1], [Math.cos(angle) * r, 2, Math.sin(angle) * r], angle, 0xe0e0e0);
  }
}

/** Static box: fixed collider + mesh placed once at the same transform. */
function addBox(
  scene: THREE.Scene,
  world: RAPIER.World,
  size: [number, number, number],
  pos: [number, number, number],
  yaw: number,
  color: number,
): void {
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  addStatic(scene, world, size, new THREE.Vector3(...pos), rotation, color);
}

/**
 * A ramp of the given slope (degrees) that rises along −Z from ground level, 3 m tall.
 * It's a thin box tilted about the X axis, positioned so its low edge touches the ground.
 */
function addRamp(
  scene: THREE.Scene,
  world: RAPIER.World,
  slopeDeg: number,
  base: [number, number, number],
  color: number,
): void {
  const slope = (slopeDeg * Math.PI) / 180;
  const rise = 3;
  const length = rise / Math.sin(slope); // along the incline
  const thickness = 0.2;
  // Tilting about +X by +slope raises the −Z end.
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), slope);
  // Centre of the box: halfway up the incline, pushed down by half the thickness along its normal.
  const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation);
  const centre = new THREE.Vector3(
    base[0],
    base[1] + rise / 2,
    base[2] - (length / 2) * Math.cos(slope),
  ).addScaledVector(normal, -thickness / 2);
  addStatic(scene, world, [3, thickness, length], centre, rotation, color);
}

function addStatic(
  scene: THREE.Scene,
  world: RAPIER.World,
  size: [number, number, number],
  position: THREE.Vector3,
  rotation: THREE.Quaternion,
  color: number,
): void {
  const [sx, sy, sz] = size;
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2)
      .setTranslation(position.x, position.y, position.z)
      .setRotation(rotation),
  );
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(sx, sy, sz),
    new THREE.MeshStandardMaterial({ color, roughness: 0.8 }),
  );
  mesh.position.copy(position);
  mesh.quaternion.copy(rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
}
