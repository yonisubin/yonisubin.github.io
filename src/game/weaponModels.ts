import * as THREE from 'three';
import type { WeaponId } from './stats';

// Simple weapon models, in metres, for parenting to the character's right-hand bone (grip at
// the origin). In that bone's frame +Y runs along the fingers and +Z points forward: the bat
// extends along +Y; guns are built upright with the barrel along +Z (see the flip below).

function mesh(geometry: THREE.BufferGeometry, color: number, metal = 0.3, rough = 0.5): THREE.Mesh {
  const m = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough }));
  m.castShadow = true;
  return m;
}

export function buildWeaponModel(id: WeaponId): THREE.Object3D | null {
  const g = new THREE.Group();
  if (id === 'bat') {
    // Tapered wooden bat, handle in the hand, barrel extending past the fingers.
    const bat = mesh(new THREE.CylinderGeometry(0.035, 0.018, 0.85, 12).translate(0, 0.32, 0), 0xb08350, 0, 0.6);
    const knob = mesh(new THREE.SphereGeometry(0.024, 8, 6).translate(0, -0.1, 0), 0x7a5532, 0, 0.6);
    g.add(bat, knob);
  } else if (id === 'pistol') {
    const slide = mesh(new THREE.BoxGeometry(0.035, 0.05, 0.19).translate(0, 0.07, 0.06), 0x222326, 0.7, 0.35);
    const grip = mesh(new THREE.BoxGeometry(0.03, 0.1, 0.045).translate(0, 0.02, -0.01), 0x1a1a1b, 0.2, 0.7);
    g.add(slide, grip);
  } else if (id === 'rifle') {
    const body = mesh(new THREE.BoxGeometry(0.05, 0.08, 0.55).translate(0, 0.07, 0.12), 0x2a2c2e, 0.6, 0.4);
    const barrel = mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.32, 8).rotateX(Math.PI / 2).translate(0, 0.08, 0.55), 0x1b1c1d, 0.8, 0.3);
    const stock = mesh(new THREE.BoxGeometry(0.045, 0.1, 0.22).translate(0, 0.05, -0.25), 0x3a2e22, 0.1, 0.7);
    const mag = mesh(new THREE.BoxGeometry(0.035, 0.12, 0.05).translate(0, -0.02, 0.1), 0x1a1a1b, 0.4, 0.5);
    g.add(body, barrel, stock, mag);
  } else {
    return null; // fists
  }
  if (id !== 'bat') {
    // The hand's +Y runs along the fingers, which point down when holding a grip, so turn
    // guns upright (slide on top); their barrels already point along the hand's +Z, forward.
    g.rotation.z = Math.PI;
  }
  return g;
}
