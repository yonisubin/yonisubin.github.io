import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Procedural car models, built from extruded side profiles (with rounded/bevelled edges),
// so they read as real cars rather than boxes.
//
// Model space: +X = forward, +Y = up, +Z = the car's right side. Origin = centre of the
// car at ground level. All sizes in metres.
//
// Geometry is created once per car type and shared; player cars get their own paint
// material, while NPC traffic reuses the same geometry in InstancedMeshes.

export type CarType = 'sedan' | 'taxi' | 'van';

export interface CarDimensions {
  length: number;
  width: number;
  wheelBase: number; // distance between axles
  track: number; // distance between left and right wheel centres
  wheelRadius: number;
  /** Physics collision box (half extents and centre), for the chassis. */
  boxHalf: [number, number, number];
  boxCenter: [number, number, number];
  mass: number; // kg
}

export const CAR_DIMENSIONS: Record<CarType, CarDimensions> = {
  sedan: {
    length: 4.5, width: 1.8, wheelBase: 2.7, track: 1.56, wheelRadius: 0.34,
    boxHalf: [2.2, 0.36, 0.88], boxCenter: [0, 0.68, 0], mass: 1300,
  },
  taxi: {
    length: 4.5, width: 1.8, wheelBase: 2.7, track: 1.56, wheelRadius: 0.34,
    boxHalf: [2.2, 0.36, 0.88], boxCenter: [0, 0.68, 0], mass: 1300,
  },
  van: {
    length: 4.9, width: 1.95, wheelBase: 3.0, track: 1.66, wheelRadius: 0.37,
    boxHalf: [2.4, 0.78, 0.95], boxCenter: [0, 1.12, 0], mass: 2000,
  },
};

/** Typical car paint colours, as hex sRGB. */
export const PAINT_COLORS = [0xe8e8e6, 0x1b1c1e, 0x8a8f96, 0x9c1b1b, 0x1f3f7a, 0x2f5a3a, 0xc7c2b5, 0x5a6470, 0x3a2a24];
export const TAXI_YELLOW = 0xf2b31a;

/** Merge geometries, converting indexed ones (boxes) to match non-indexed ones (extrusions). */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
  if (!merged) throw new Error('Car geometry merge failed (mismatched attributes)');
  return merged;
}

/** Extrude a closed side profile (in the XY plane) across the car's width, centred on Z = 0. */
function extrudeProfile(points: [number, number][], width: number, bevel: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const depth = width - 2 * bevel;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 6,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

/** Side profile with arches cut out above each wheel. */
function bodyProfile(
  rear: number,
  front: number,
  wheelX: number,
  r: number,
  top: [number, number][],
): [number, number][] {
  const pts: [number, number][] = [];
  const bottom = 0.3;
  const archR = r + 0.08;
  const arch = (cx: number) => {
    // Arc over the wheel from back to front, through the top.
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI - (i / 10) * Math.PI;
      pts.push([cx + Math.cos(a) * archR, r + Math.sin(a) * archR]);
    }
  };
  pts.push([rear + 0.1, bottom]);
  arch(-wheelX);
  arch(wheelX);
  pts.push([front - 0.08, bottom]);
  pts.push(...top);
  return pts;
}

interface CarGeometry {
  body: THREE.BufferGeometry; // painted
  glass: THREE.BufferGeometry;
  trim: THREE.BufferGeometry; // black bumpers / grille
  headlights: THREE.BufferGeometry;
  taillights: THREE.BufferGeometry;
  sign?: THREE.BufferGeometry; // taxi roof sign
}

const geometryCache = new Map<CarType, CarGeometry>();

export function carGeometry(type: CarType): CarGeometry {
  const cached = geometryCache.get(type);
  if (cached) return cached;
  const d = CAR_DIMENSIONS[type];
  const wx = d.wheelBase / 2;
  const r = d.wheelRadius;
  const half = d.length / 2;
  let geo: CarGeometry;

  if (type === 'van') {
    const body = extrudeProfile(
      bodyProfile(-half, half, wx, r, [
        [half, 0.55],
        [half - 0.05, 0.95], // nose
        [half - 0.55, 1.15], // bonnet top
        [half - 1.3, 1.95], // windscreen top
        [-half + 0.05, 1.98], // roof rear
        [-half, 0.45],
      ]),
      d.width,
      0.07,
    );
    // Windscreen + a band of side windows, slightly proud of the body.
    const windscreen = extrudeProfile(
      [
        [half - 0.6, 1.16],
        [half - 1.27, 1.88],
        [half - 1.45, 1.88],
        [half - 0.8, 1.16],
      ],
      d.width - 0.12,
      0.03,
    );
    const sideBand = new THREE.BoxGeometry(d.length * 0.62, 0.42, d.width + 0.02).translate(-0.55, 1.6, 0);
    geo = {
      body,
      glass: merge([windscreen, sideBand]),
      trim: merge([
        new THREE.BoxGeometry(0.16, 0.3, d.width - 0.1).translate(half - 0.02, 0.48, 0),
        new THREE.BoxGeometry(0.16, 0.3, d.width - 0.1).translate(-half + 0.02, 0.48, 0),
      ]),
      headlights: lights(half - 0.03, 0.82, d.width / 2 - 0.25),
      taillights: lights(-half + 0.01, 1.3, d.width / 2 - 0.12, 0.12, 0.35),
    };
  } else {
    const body = extrudeProfile(
      bodyProfile(-half, half, wx, r, [
        [half, 0.52],
        [half - 0.08, 0.8], // nose
        [half - 1.1, 0.95], // base of windscreen
        [-half + 0.95, 0.98], // base of rear window
        [-half + 0.05, 0.92], // boot lid end
        [-half, 0.5],
      ]),
      d.width,
      0.08,
    );
    // Glass cabin (greenhouse): narrower than the body, with raked front and rear screens.
    const cabin = extrudeProfile(
      [
        [half - 1.1, 0.94],
        [0.1, 1.38],
        [-0.95, 1.38],
        [-half + 0.9, 0.96],
      ],
      d.width - 0.24,
      0.06,
    );
    // Painted roof panel on top of the glass.
    const roof = extrudeProfile(
      [
        [0.12, 1.37],
        [0.05, 1.45],
        [-0.9, 1.45],
        [-0.97, 1.37],
      ],
      d.width - 0.26,
      0.04,
    );
    geo = {
      body: merge([body, roof]),
      glass: cabin,
      trim: merge([
        new THREE.BoxGeometry(0.14, 0.24, d.width - 0.1).translate(half - 0.02, 0.42, 0),
        new THREE.BoxGeometry(0.14, 0.24, d.width - 0.1).translate(-half + 0.02, 0.42, 0),
        new THREE.BoxGeometry(0.05, 0.12, 0.7).translate(half + 0.01, 0.62, 0), // grille
      ]),
      headlights: lights(half - 0.02, 0.68, d.width / 2 - 0.3),
      taillights: lights(-half + 0.0, 0.72, d.width / 2 - 0.25),
      sign: type === 'taxi' ? new THREE.BoxGeometry(0.55, 0.16, 0.3).translate(-0.4, 1.55, 0) : undefined,
    };
  }
  geometryCache.set(type, geo);
  return geo;
}

/** A pair of lamp blocks, mirrored left/right. */
function lights(x: number, y: number, z: number, h = 0.1, w = 0.32): THREE.BufferGeometry {
  return merge([
    new THREE.BoxGeometry(0.08, h, w).translate(x, y, z),
    new THREE.BoxGeometry(0.08, h, w).translate(x, y, -z),
  ]);
}

// --- Materials shared by every car (except paint, which varies).

export const carMaterials = {
  glass: new THREE.MeshPhysicalMaterial({ color: 0x0c1116, roughness: 0.08, metalness: 0.2, envMapIntensity: 0.5 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x151617, roughness: 0.6 }),
  headlight: new THREE.MeshStandardMaterial({ color: 0xf4f1e6, emissive: 0xfff3d6, emissiveIntensity: 0.6, roughness: 0.2 }),
  taillight: new THREE.MeshStandardMaterial({ color: 0x8a0f0f, emissive: 0xff1a1a, emissiveIntensity: 0.4, roughness: 0.3 }),
  tyre: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }),
  rim: new THREE.MeshStandardMaterial({ color: 0x7d8288, roughness: 0.35, metalness: 0.8, envMapIntensity: 0.5 }),
  sign: new THREE.MeshStandardMaterial({ color: 0xfaf3d2, emissive: 0xffe9a8, emissiveIntensity: 0.4 }),
};

export function paintMaterial(color: number): THREE.MeshPhysicalMaterial {
  // Clear-coated paint: a glossy layer over a coloured base. Reflections are kept modest
  // (envMapIntensity) so the colour still reads under the bright sky.
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.15,
    roughness: 0.45,
    clearcoat: 0.6,
    clearcoatRoughness: 0.15,
    envMapIntensity: 0.35,
  });
}

/** Wheel geometry with its axle along Z (tyre + rim), centred on the wheel centre. */
export function wheelGeometry(radius: number): { tyre: THREE.BufferGeometry; rim: THREE.BufferGeometry } {
  const tyre = new THREE.CylinderGeometry(radius, radius, 0.24, 24).rotateX(Math.PI / 2);
  // Rim: a disc plus five spokes, so you can see the wheels turn.
  const parts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, 0.26, 20).rotateX(Math.PI / 2)];
  for (let i = 0; i < 5; i++) {
    parts.push(
      new THREE.BoxGeometry(radius * 1.05, 0.06, 0.27).rotateZ((i / 5) * Math.PI),
    );
  }
  const rim = merge(parts);
  return { tyre, rim };
}

/** Build a complete car body (no wheels) as a Group, for player-drivable cars. */
export function buildCarBody(type: CarType, color: number): THREE.Group {
  const g = carGeometry(type);
  const group = new THREE.Group();
  // Only the big parts cast shadows: small ones add draw calls but no visible shadow.
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, castShadow: boolean) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  add(g.body, paintMaterial(type === 'taxi' ? TAXI_YELLOW : color), true);
  add(g.glass, carMaterials.glass, true);
  add(g.trim, carMaterials.trim, false);
  add(g.headlights, carMaterials.headlight, false);
  add(g.taillights, carMaterials.taillight, false);
  if (g.sign) add(g.sign, carMaterials.sign, false);
  return group;
}

/** One wheel as a Group (tyre + rim), origin at the wheel centre, axle along Z. */
export function buildWheel(radius: number): THREE.Group {
  const { tyre, rim } = wheelGeometry(radius);
  const group = new THREE.Group();
  for (const [geometry, material] of [
    [tyre, carMaterials.tyre],
    [rim, carMaterials.rim],
  ] as const) {
    group.add(new THREE.Mesh(geometry, material)); // wheel shadows are hidden by the car's
  }
  return group;
}
