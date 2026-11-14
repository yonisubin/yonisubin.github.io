import * as THREE from 'three';
import { carMaterials, paintMaterial } from './carModel';

// Procedural light helicopter. Model space matches the cars: +X forward, +Y up, +Z right,
// origin at ground level under the cabin (where the skids touch down).

export const MAIN_ROTOR_RADIUS = 5.2; // m
export const MAIN_ROTOR_HEIGHT = 2.95; // m above the origin
export const TAIL_ROTOR_POS = new THREE.Vector3(-6.25, 2.05, 0.18);

export interface HeliModel {
  root: THREE.Group;
  /** Spins about its local Y axis. */
  mainRotor: THREE.Group;
  /** Spins about its local Z axis. */
  tailRotor: THREE.Group;
  /** Blade meshes (faded out at high rpm) and the blur disc (faded in). */
  blades: THREE.Mesh[];
  blurDisc: THREE.Mesh;
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = shadow;
  m.receiveShadow = shadow;
  return m;
}

export function buildHelicopter(color: number): HeliModel {
  const root = new THREE.Group();
  const paint = paintMaterial(color);
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2c2f, roughness: 0.5, metalness: 0.4 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.8 });

  // Cabin: a stretched sphere, flattened underneath by sitting it on the skids.
  const cabin = mesh(new THREE.SphereGeometry(1, 32, 20), paint);
  cabin.scale.set(2.0, 1.1, 1.05);
  cabin.position.set(0.2, 1.45, 0);
  root.add(cabin);

  // Canopy: a glass bubble overlapping the front of the cabin.
  const canopy = mesh(new THREE.SphereGeometry(1, 32, 20), carMaterials.glass);
  canopy.scale.set(1.35, 0.95, 0.98);
  canopy.position.set(0.95, 1.62, 0);
  root.add(canopy);

  // Engine housing and rotor mast on top.
  const engine = mesh(new THREE.BoxGeometry(1.8, 0.55, 0.95), paint);
  engine.position.set(-0.35, 2.4, 0);
  root.add(engine);
  const mast = mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.45, 12), dark);
  mast.position.set(0, MAIN_ROTOR_HEIGHT - 0.25, 0);
  root.add(mast);

  // Tail boom tapering toward the back, with a fin and a horizontal stabiliser.
  const boom = mesh(new THREE.CylinderGeometry(0.16, 0.36, 5.2, 16).rotateZ(Math.PI / 2), paint);
  boom.position.set(-3.6, 1.8, 0);
  root.add(boom);
  const fin = mesh(new THREE.BoxGeometry(0.9, 1.3, 0.08), paint);
  fin.position.set(-6.05, 2.25, 0);
  fin.rotation.z = -0.35; // swept back
  root.add(fin);
  const stabiliser = mesh(new THREE.BoxGeometry(0.55, 0.06, 1.7), paint);
  stabiliser.position.set(-5.5, 1.75, 0);
  root.add(stabiliser);

  // Skids: two rails on curved-looking struts.
  for (const z of [-0.95, 0.95]) {
    const rail = mesh(new THREE.CylinderGeometry(0.055, 0.055, 3.4, 10).rotateZ(Math.PI / 2), steel);
    rail.position.set(0.25, 0.06, z);
    root.add(rail);
    for (const x of [-0.6, 1.1]) {
      const strut = mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.85, 8), steel);
      strut.position.set(x, 0.45, z * 0.82);
      strut.rotation.x = z > 0 ? -0.35 : 0.35; // splayed outward
      root.add(strut);
    }
  }

  // Main rotor: hub + 4 blades. Blades fade out at speed and a translucent disc fades in,
  // like the motion blur you see on a real rotor.
  const mainRotor = new THREE.Group();
  mainRotor.position.set(0, MAIN_ROTOR_HEIGHT, 0);
  mainRotor.add(mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.16, 16), dark));
  const blades: THREE.Mesh[] = [];
  const bladeMaterial = new THREE.MeshStandardMaterial({ color: 0x1e1f21, roughness: 0.6, transparent: true });
  for (let i = 0; i < 4; i++) {
    const blade = mesh(
      new THREE.BoxGeometry(MAIN_ROTOR_RADIUS, 0.04, 0.3).translate(MAIN_ROTOR_RADIUS / 2, 0, 0),
      bladeMaterial,
    );
    blade.rotation.y = (i * Math.PI) / 2;
    blades.push(blade);
    mainRotor.add(blade);
  }
  const blurDisc = mesh(
    new THREE.CircleGeometry(MAIN_ROTOR_RADIUS, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x222326, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    false,
  );
  mainRotor.add(blurDisc);
  root.add(mainRotor);

  // Tail rotor: two blades spinning about the Z axis (sideways thrust for yaw).
  const tailRotor = new THREE.Group();
  tailRotor.position.copy(TAIL_ROTOR_POS);
  for (let i = 0; i < 2; i++) {
    const b = mesh(new THREE.BoxGeometry(0.1, 1.3, 0.03), bladeMaterial);
    b.rotation.z = (i * Math.PI) / 2;
    tailRotor.add(b);
  }
  root.add(tailRotor);

  return { root, mainRotor, tailRotor, blades, blurDisc };
}
