// Procedural models for props and elements (original designs, everything drawn in code).
// Shared materials/textures are created once and flagged `userData.shared` so disposing a chamber
// doesn't free them.
import * as THREE from 'three';
import { CONFIG } from '../core/config';

function shared<T extends THREE.Material | THREE.BufferGeometry>(x: T): T {
  x.userData.shared = true;
  return x;
}

function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const cache = new Map<string, THREE.Material>();
function mat(key: string, make: () => THREE.Material): THREE.Material {
  let m = cache.get(key);
  if (!m) cache.set(key, (m = shared(make())));
  return m;
}

export const MAT = {
  metal: () => mat('metal', () => new THREE.MeshLambertMaterial({ color: 0x4a5057 })),
  dark: () => mat('dark', () => new THREE.MeshLambertMaterial({ color: 0x2a2e33 })),
  white: () => mat('white', () => new THREE.MeshLambertMaterial({ color: 0xe8eaec })),
  glass: () => mat('glass', () => new THREE.MeshLambertMaterial({ color: 0x9fd7ff, transparent: true, opacity: 0.25, depthWrite: false })),
  red: () => mat('red', () => new THREE.MeshBasicMaterial({ color: 0xff3b2f })),
};

/** Weighted cube face: pale plate, dark rounded rim, a round cyan lamp in the middle. */
function cubeFace(companion: boolean): THREE.CanvasTexture {
  return canvasTex(256, (g, s) => {
    g.fillStyle = '#3b4148';
    g.fillRect(0, 0, s, s);
    g.fillStyle = companion ? '#f1d9cf' : '#dfe3e6';
    const m = s * 0.12;
    g.beginPath();
    g.roundRect(m, m, s - 2 * m, s - 2 * m, s * 0.08);
    g.fill();
    if (companion) {
      // Two overlapping rings in mint: the "twin fold" emblem (this chamber's companion design).
      g.strokeStyle = '#3fbf9a';
      g.lineWidth = s * 0.06;
      for (const dx of [-0.09, 0.09]) {
        g.beginPath();
        g.arc(s / 2 + dx * s, s / 2, s * 0.16, 0, Math.PI * 2);
        g.stroke();
      }
    } else {
      g.fillStyle = '#20262c';
      g.beginPath();
      g.arc(s / 2, s / 2, s * 0.2, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#5fd3ff';
      g.beginPath();
      g.arc(s / 2, s / 2, s * 0.12, 0, Math.PI * 2);
      g.fill();
    }
    // Corner bolts.
    g.fillStyle = '#7b848c';
    for (const x of [m * 0.5, s - m * 0.5]) for (const y of [m * 0.5, s - m * 0.5]) g.fillRect(x - 5, y - 5, 10, 10);
  });
}

/** The parts of a cube face that glow (the lamp / the emblem), white on black: an emissive map. */
function cubeGlow(companion: boolean): THREE.CanvasTexture {
  return canvasTex(128, (g, s) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, s, s);
    if (companion) {
      g.strokeStyle = '#3fbf9a';
      g.lineWidth = s * 0.06;
      for (const dx of [-0.09, 0.09]) {
        g.beginPath();
        g.arc(s / 2 + dx * s, s / 2, s * 0.16, 0, Math.PI * 2);
        g.stroke();
      }
    } else {
      g.fillStyle = '#5fd3ff';
      g.beginPath();
      g.arc(s / 2, s / 2, s * 0.12, 0, Math.PI * 2);
      g.fill();
    }
  });
}

export function cubeModel(size: number, companion: boolean): THREE.Object3D {
  // Emissive lamp / emblem: lit the same in a dark service corridor as under the practical lights.
  const m = mat(companion ? 'cubeC' : 'cube', () =>
    new THREE.MeshLambertMaterial({ map: cubeFace(companion), emissive: 0xffffff, emissiveMap: cubeGlow(companion), emissiveIntensity: CONFIG.visuals.propGlow }),
  );
  return new THREE.Mesh(new THREE.BoxGeometry(size, size, size), m);
}

export function sphereModel(radius: number): THREE.Object3D {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 16), MAT.white()));
  const band = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.0, radius * 0.1, 8, 32), MAT.dark());
  band.rotation.x = Math.PI / 2;
  g.add(band);
  const lamp = mat('lampCyan', () => new THREE.MeshBasicMaterial({ color: 0x5fd3ff }));
  for (let i = 0; i < 4; i++) {
    const d = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.12, 8, 6), lamp);
    const a = (i / 4) * Math.PI * 2;
    d.position.set(Math.cos(a) * radius * 1.05, 0, Math.sin(a) * radius * 1.05);
    g.add(d);
  }
  return g;
}

/** Debris kinds → [half extents of the collider, model]. */
export function debrisModel(kind: string): { half: THREE.Vector3; model: THREE.Object3D } {
  const g = new THREE.Group();
  if (kind === 'chair') {
    const half = new THREE.Vector3(0.25, 0.45, 0.25);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.5), MAT.white());
    seat.position.y = 0;
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.05), MAT.white());
    back.position.set(0, 0.22, -0.22);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.42), MAT.metal());
    leg.position.y = -0.24;
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 12), MAT.metal());
    foot.position.y = -0.43;
    g.add(seat, back, leg, foot);
    return { half, model: g };
  }
  if (kind === 'monitor') {
    const half = new THREE.Vector3(0.3, 0.25, 0.15);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.38, 0.12), MAT.dark());
    box.position.y = 0.06;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.3), mat('screen', () => new THREE.MeshBasicMaterial({ color: 0x1d4a5e })));
    screen.position.set(0, 0.06, 0.061);
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, 0.25), MAT.metal());
    stand.position.y = -0.19;
    g.add(box, screen, stand);
    return { half, model: g };
  }
  if (kind === 'cup') {
    const half = new THREE.Vector3(0.05, 0.06, 0.05);
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.12, 12), MAT.white()));
    return { half, model: g };
  }
  const half = new THREE.Vector3(0.25, 0.2, 0.2);
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.4), mat('crate', () => new THREE.MeshLambertMaterial({ color: 0x8a7a5c }))));
  return { half, model: g };
}

/**
 * Sentry: an upright pod on three short legs — white top shell, dark lower half, one round red
 * lens on the front (−Z... the model faces +Z: its "forward"), two slit vents on the sides.
 */
export function turretModel(radius: number, height: number): { model: THREE.Object3D; lens: THREE.Mesh } {
  const g = new THREE.Group();
  const shellH = height * 0.62;
  const shell = new THREE.Mesh(new THREE.CapsuleGeometry(radius, shellH - 2 * radius, 6, 16), MAT.white());
  shell.position.y = height * 0.12;
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.02, radius * 0.9, height * 0.18, 16), MAT.dark());
  skirt.position.y = -height * 0.12;
  const lensRing = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.32, radius * 0.07, 8, 20), MAT.dark());
  lensRing.position.set(0, height * 0.18, radius * 0.95);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.3, 20), MAT.red());
  lens.position.set(0, height * 0.18, radius * 0.97);
  g.add(shell, skirt, lensRing, lens);
  for (const side of [-1, 1]) {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.03, height * 0.28, radius * 0.5), MAT.dark());
    vent.position.set(side * radius * 0.98, height * 0.1, 0.05);
    g.add(vent);
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, height * 0.32, 0.06), MAT.metal());
    leg.position.set(Math.sin(a) * radius * 0.9, -height * 0.34, Math.cos(a) * radius * 0.9);
    leg.rotation.set(Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35);
    g.add(leg);
  }
  return { model: g, lens };
}

/** Glow material for lit / unlit indicator parts. */
export function lampMaterial(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color });
}
