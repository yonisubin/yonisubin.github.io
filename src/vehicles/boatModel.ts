import * as THREE from 'three';
import { carMaterials, paintMaterial } from './carModel';

// Procedural boats: a speedboat and a jet ski. Model space matches the cars: +X forward
// (bow), +Y up, +Z right; the origin is the bottom of the keel, amidships.
//
// The hull is built from cross-sections along its length: each section is a V (keel, chines,
// gunwales) whose width tapers to a point at the bow and is cut square at the stern (the
// transom). Joining neighbouring sections gives the hull sides and bottom; the top is a deck.

export type BoatType = 'speedboat' | 'jetski';

export interface BoatDimensions {
  length: number;
  beam: number; // width
  height: number; // keel to gunwale
  mass: number; // kg
  draft: number; // m of hull under water when floating at rest
}

export const BOAT_DIMENSIONS: Record<BoatType, BoatDimensions> = {
  speedboat: { length: 6.2, beam: 2.3, height: 1.05, mass: 950, draft: 0.38 },
  jetski: { length: 2.9, beam: 1.1, height: 0.75, mass: 360, draft: 0.26 },
};

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = shadow;
  m.receiveShadow = shadow;
  return m;
}

/**
 * A V-bottomed hull: `sections` cross-sections from stern (x = −L/2) to bow (x = +L/2).
 * Returns the hull shell and its deck as separate geometries (different materials).
 */
function hullGeometry(d: BoatDimensions, deadrise: number, bowRise: number): { hull: THREE.BufferGeometry; deck: THREE.BufferGeometry } {
  const sections = 14;
  const L = d.length;
  const pos: number[] = [];
  const idx: number[] = [];
  // Per section: 5 points (left gunwale, left chine, keel, right chine, right gunwale).
  const ring = (i: number): [number, number, number][] => {
    const t = i / sections; // 0 at the stern, 1 at the bow
    const x = -L / 2 + t * L;
    // Width: full for the back 55 %, then a curved taper to the stem.
    const taper = t < 0.55 ? 1 : Math.cos(((t - 0.55) / 0.45) * (Math.PI / 2));
    const half = (d.beam / 2) * Math.max(0.02, taper);
    // The keel sweeps up toward the bow; the sheer (top edge) rises a little too.
    const keel = t < 0.6 ? 0 : bowRise * ((t - 0.6) / 0.4) ** 2;
    const top = d.height + 0.12 * t;
    const chineY = keel + deadrise * (1 - 0.5 * t);
    return [
      [x, top, -half],
      [x, chineY, -half * 0.92],
      [x, keel, 0],
      [x, chineY, half * 0.92],
      [x, top, half],
    ];
  };
  for (let i = 0; i <= sections; i++) for (const p of ring(i)) pos.push(...p);
  for (let i = 0; i < sections; i++) {
    for (let k = 0; k < 4; k++) {
      const a = i * 5 + k;
      const b = (i + 1) * 5 + k;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  // Transom: the flat stern (section 0), a fan from the keel.
  // Points 0–4 of section 0 go round its outline: gunwale, chine, keel, chine, gunwale.
  idx.push(0, 1, 2, 2, 3, 4, 0, 2, 4);
  const hull = new THREE.BufferGeometry();
  hull.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  hull.setIndex(idx);
  hull.computeVertexNormals();

  // Deck: the gunwale outline, filled.
  const dpos: number[] = [];
  const didx: number[] = [];
  for (let i = 0; i <= sections; i++) {
    const r = ring(i);
    dpos.push(r[0][0], r[0][1] - 0.02, r[0][2], r[4][0], r[4][1] - 0.02, r[4][2]);
  }
  for (let i = 0; i < sections; i++) {
    const a = i * 2;
    didx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const deck = new THREE.BufferGeometry();
  deck.setAttribute('position', new THREE.Float32BufferAttribute(dpos, 3));
  deck.setIndex(didx);
  deck.computeVertexNormals();
  return { hull, deck };
}

/** A boat model of the given type and paint colour. */
export function buildBoat(type: BoatType, color: number): THREE.Group {
  const d = BOAT_DIMENSIONS[type];
  const root = new THREE.Group();
  const paint = paintMaterial(color);
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.35, side: THREE.DoubleSide });
  const deckMat = new THREE.MeshStandardMaterial({ color: type === 'speedboat' ? 0xc9b48a : 0x2b2d31, roughness: 0.8, side: THREE.DoubleSide });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1f2124, roughness: 0.6 });
  const seat = new THREE.MeshStandardMaterial({ color: type === 'speedboat' ? 0xeae4d8 : 0x16171a, roughness: 0.7 });

  if (type === 'speedboat') {
    const { hull, deck } = hullGeometry(d, 0.32, 0.45);
    root.add(mesh(hull, white));
    const deckMesh = mesh(deck, deckMat);
    deckMesh.position.y = -0.35; // the cockpit floor sits below the gunwale
    root.add(deckMesh);
    // A painted stripe along both sides near the top.
    for (const side of [-1, 1]) {
      const stripe = mesh(new THREE.BoxGeometry(d.length * 0.62, 0.16, 0.03), paint);
      stripe.position.set(-0.45, d.height - 0.22, side * (d.beam / 2 + 0.005));
      root.add(stripe);
    }
    // Foredeck over the bow (covered), windscreen, console, seats, outboard engine.
    const foredeck = mesh(new THREE.BoxGeometry(d.length * 0.32, 0.08, d.beam * 0.7), white);
    foredeck.position.set(d.length * 0.3, d.height + 0.02, 0);
    root.add(foredeck);
    const screen = mesh(new THREE.BoxGeometry(0.05, 0.45, d.beam * 0.8), carMaterials.glass);
    screen.position.set(d.length * 0.12, d.height + 0.22, 0);
    screen.rotation.z = 0.45; // raked back
    root.add(screen);
    const consoleBox = mesh(new THREE.BoxGeometry(0.55, 0.6, 0.6), white);
    consoleBox.position.set(d.length * 0.05, d.height - 0.05, 0.45);
    root.add(consoleBox);
    const wheel = mesh(new THREE.TorusGeometry(0.17, 0.025, 6, 16), dark);
    wheel.position.set(d.length * 0.0, d.height + 0.3, 0.45);
    wheel.rotation.y = Math.PI / 2;
    wheel.rotation.x = 0.5;
    root.add(wheel);
    for (const [x, z] of [[-0.35, 0.45], [-0.35, -0.45], [-1.6, 0]] as const) {
      const s = mesh(new THREE.BoxGeometry(0.6, 0.45, z === 0 ? d.beam * 0.75 : 0.6), seat);
      s.position.set(x, d.height - 0.25, z);
      root.add(s);
    }
    const engine = mesh(new THREE.BoxGeometry(0.45, 0.85, 0.45), dark);
    engine.position.set(-d.length / 2 - 0.15, d.height - 0.05, 0);
    root.add(engine);
    const leg = mesh(new THREE.BoxGeometry(0.15, 0.8, 0.12), dark);
    leg.position.set(-d.length / 2 - 0.2, 0.25, 0);
    root.add(leg);
  } else {
    // Jet ski: a short, high-sided hull in the paint colour, a long seat and handlebars.
    const { hull, deck } = hullGeometry(d, 0.22, 0.3);
    const hullPaint = paint.clone();
    hullPaint.side = THREE.DoubleSide;
    root.add(mesh(hull, hullPaint));
    const deckMesh = mesh(deck, deckMat);
    root.add(deckMesh);
    const s = mesh(new THREE.BoxGeometry(1.25, 0.28, 0.42), seat);
    s.position.set(-0.4, d.height + 0.12, 0);
    root.add(s);
    const hood = mesh(new THREE.BoxGeometry(0.75, 0.32, 0.7), paint);
    hood.position.set(0.55, d.height + 0.12, 0);
    hood.rotation.z = -0.25;
    root.add(hood);
    const bars = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.75, 8), dark);
    bars.position.set(0.25, d.height + 0.5, 0);
    bars.rotation.x = Math.PI / 2;
    root.add(bars);
    const stem = mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.4, 8), dark);
    stem.position.set(0.3, d.height + 0.32, 0);
    stem.rotation.z = 0.35;
    root.add(stem);
    const nozzle = mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.3, 10), dark);
    nozzle.position.set(-d.length / 2 - 0.05, 0.25, 0);
    nozzle.rotation.z = Math.PI / 2;
    root.add(nozzle);
  }
  return root;
}
