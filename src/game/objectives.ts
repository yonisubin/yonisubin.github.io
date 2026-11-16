import * as THREE from 'three';

// Objective markers shared by the side missions (game/missions.ts) and the story
// (story/steps.ts): a light pillar over a destination, rings and gates to pass through,
// package boxes, buoys, summit flags and an arrow over a target. Each call builds a fresh
// mesh (with its own geometry and material); dispose it with disposeObject() when it's done.

export const RING_RADIUS = 7; // m, inner radius of a sky ring (fly through the middle)
export const GATE_RADIUS = 9; // m: drive through a race gate within this distance of its centre

/** A tall translucent pillar over a destination, `radius` m wide (origin at its foot). */
export function beaconMesh(radius: number, color = 0xff3b5c): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 60, 24, 1, true).translate(0, 30, 0),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
  );
}

/** A yellow sky ring for the helicopter (hole along its local Z: lookAt the next ring). */
export function ringMesh(): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.TorusGeometry(RING_RADIUS, 0.45, 10, 40),
    new THREE.MeshBasicMaterial({ color: 0xffd60a, transparent: true, opacity: 0.85 }),
  );
}

/** A green road gate (centre it GATE_RADIUS·0.8 − 0.5 m above the road; lookAt the next gate). */
export function gateMesh(): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.TorusGeometry(GATE_RADIUS * 0.8, 0.35, 8, 36),
    new THREE.MeshBasicMaterial({ color: 0x4cd964, transparent: true, opacity: 0.85 }),
  );
}

/** A glowing cardboard package (origin at its centre; lift it 0.45 m off the ground). */
export function packageMesh(): THREE.Mesh {
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.45, 0.5),
    new THREE.MeshStandardMaterial({ color: 0xb98a52, emissive: 0xffb347, emissiveIntensity: 0.35 }),
  );
  box.castShadow = true;
  return box;
}

/** An arrow pointing down at a target (spin it and bob it above the target). */
export function arrowMesh(color = 0xff3b5c): THREE.Mesh {
  return new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.2, 4).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color }));
}

/** A red-and-white marker buoy (origin at the waterline). */
export function buoyMesh(): THREE.Mesh {
  const buoy = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.7, 1.2, 14).translate(0, 0.3, 0),
    new THREE.MeshStandardMaterial({ color: 0xe03a2f, roughness: 0.5, emissive: 0x401010 }),
  );
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(0.58, 0.58, 0.3, 14).translate(0, 0.55, 0),
    new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 }),
  );
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8).translate(0, 1.05, 0), new THREE.MeshBasicMaterial({ color: 0xffd60a }));
  buoy.add(band, light);
  return buoy;
}

/** A flag on a pole (origin at the foot of the pole). */
export function flagMesh(): THREE.Mesh {
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.06, 3.2, 8).translate(0, 1.6, 0),
    new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.5, roughness: 0.4 }),
  );
  const cloth = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 0.75).translate(0.6, 2.75, 0),
    new THREE.MeshStandardMaterial({ color: 0xff3b5c, emissive: 0x501020, side: THREE.DoubleSide }),
  );
  pole.add(cloth);
  return pole;
}

/** Take an object out of the scene and free its geometries and materials. */
export function disposeObject(object: THREE.Object3D): void {
  object.removeFromParent();
  object.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    }
  });
}
