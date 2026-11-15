import * as THREE from 'three';
import {
  CURB_HEIGHT,
  LOT,
  MID,
  PARAPET,
  PITCH,
  ROAD_WIDTH,
  STYLE_BRICK,
  STYLE_CONCRETE,
  STYLE_METRICS,
  VILLAGES,
  lineCoord,
  type Block,
  type CityLayout,
  type ParkingSpot,
  type Zone,
} from '../world/layout';

// Special places spread around the world, chosen deterministically from the layout:
//
//   hospitals — where you wake up after being knocked out (the one nearest to where you
//               fell). A white building with a red-cross sign, a forecourt and two parked cars.
//   stores    — extra Guns & Ammo shops (the first one, downtown by the spawn, is placed by
//               game/shop.ts as before).
//
// Each place takes over one town block: its buildings are replaced before any chunk is built,
// so the streamed meshes and colliders already include them.

export interface Hospital {
  name: string;
  /** Capsule-centre spot in front of the door where you wake up. */
  spawn: THREE.Vector3;
  /** Which way you face when you wake up (camera yaw). */
  heading: number;
  door: THREE.Vector3;
  parking: ParkingSpot[];
}

export interface StoreSite {
  name: string;
  /** Point on the wall where the door is, and the wall's outward normal. */
  door: THREE.Vector3;
  normal: THREE.Vector3;
}

const HOSPITAL_TARGETS: { name: string; x: number; z: number; zones: Zone[] }[] = [
  { name: 'City General Hospital', x: -200, z: -200, zones: ['downtown'] },
  { name: 'Northside Hospital', x: 100, z: -820, zones: ['suburb'] },
  { name: 'Eastside Hospital', x: 860, z: 150, zones: ['suburb'] },
  { name: 'Westside Hospital', x: -860, z: -100, zones: ['suburb'] },
  { name: 'Seaside Hospital', x: 300, z: 1520, zones: ['beachtown'] },
  ...VILLAGES.map((v) => ({ name: `${v.name} Clinic`, x: lineCoord(v.i), z: lineCoord(v.k), zones: ['village'] as Zone[] })),
];

const STORE_TARGETS: { name: string; x: number; z: number; zones: Zone[] }[] = [
  { name: 'Seaside', x: -420, z: 1520, zones: ['beachtown'] },
  { name: 'Northside', x: -320, z: -700, zones: ['suburb'] },
  { name: 'Eastside', x: 720, z: -420, zones: ['suburb'] },
  { name: 'Westside', x: -720, z: 520, zones: ['suburb'] },
  { name: 'Eastfield', x: lineCoord(VILLAGES[0].i) + 80, z: lineCoord(VILLAGES[0].k) + 80, zones: ['village'] },
];

export interface Places {
  hospitals: Hospital[];
  stores: StoreSite[];
  /** The hospital nearest to (x, z). */
  nearestHospital(x: number, z: number): Hospital;
}

export function createPlaces(layout: CityLayout, scene: THREE.Scene): Places {
  // Blocks the spawn, the helipad and the mission givers use stay as they are.
  const reserved = new Set<Block>();
  for (const [bx, bz] of [
    [MID, MID + 2],
    [MID + 1, MID + 2],
    [MID - 1, MID + 2],
    [MID, MID + 1],
  ]) {
    const b = layout.blockAt(bx, bz);
    if (b) reserved.add(b);
  }
  const pick = (x: number, z: number, zones: Zone[]): Block | null => {
    let best: Block | null = null;
    let bestDist = Infinity;
    for (const b of layout.blocks) {
      if (!zones.includes(b.zone) || b.helipad || reserved.has(b)) continue;
      const d = Math.hypot(b.cx - x, b.cz - z);
      if (d < bestDist) {
        best = b;
        bestDist = d;
      }
    }
    if (best) reserved.add(best);
    return best;
  };

  const signTex = hospitalSignTexture();
  const signMaterial = new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.6 });

  const hospitals: Hospital[] = [];
  for (const t of HOSPITAL_TARGETS) {
    const b = pick(t.x, t.z, t.zones);
    if (!b) continue;
    // A white four-storey block set back toward the north, leaving a forecourt by the
    // southern street; the entrance faces that street (+Z).
    const metrics = STYLE_METRICS[STYLE_CONCRETE];
    const width = 42;
    const depth = 26;
    const floors = b.zone === 'village' ? 2 : 4;
    const height = metrics.groundFloor + floors * metrics.floor + PARAPET;
    const z = b.cz - LOT / 2 + depth / 2 + 3;
    b.park = false;
    b.lawn = false;
    b.buildings = [
      { x: b.cx, z, y: CURB_HEIGHT, width, depth, height, style: STYLE_CONCRETE, color: [0.78, 0.8, 0.82], seed: 7, kind: 'hospital' },
    ];
    b.roofProps = [];
    b.trees = b.trees.filter((tr) => Math.abs(tr.z - b.cz) > LOT / 2); // keep street trees only
    const door = new THREE.Vector3(b.cx, CURB_HEIGHT, z + depth / 2);

    // Sign over the entrance.
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.8), signMaterial);
    sign.position.set(door.x, CURB_HEIGHT + metrics.groundFloor + 0.6, door.z + 0.08);
    scene.add(sign);

    // Two cars in the parking lane of the street to the south (its northern lane, by the
    // curb, facing −X like the traffic on that side of the road).
    const roadZ = b.cz + PITCH / 2;
    const laneZ = roadZ - ROAD_WIDTH / 2 + 1.75;
    const parking: ParkingSpot[] = [
      { x: b.cx - 9, z: laneZ, yaw: Math.PI, type: 'sedan', colorIndex: hospitals.length % 9 },
      { x: b.cx + 4, z: laneZ, yaw: Math.PI, type: hospitals.length % 2 ? 'van' : 'sedan', colorIndex: (hospitals.length + 4) % 9 },
    ];

    hospitals.push({
      name: t.name,
      spawn: new THREE.Vector3(door.x, CURB_HEIGHT + 1.0, door.z + 5),
      heading: Math.PI, // facing out to the street (+Z); camera yaw π looks toward +Z
      door,
      parking,
    });
  }

  const stores: StoreSite[] = [];
  for (const t of STORE_TARGETS) {
    const b = pick(t.x, t.z, t.zones);
    if (!b) continue;
    // A low brick shop along the southern sidewalk, its door facing that street.
    const metrics = STYLE_METRICS[STYLE_BRICK];
    const width = 26;
    const depth = 16;
    const z = b.cz + LOT / 2 - depth / 2 - 1.5;
    b.park = false;
    b.buildings = b.buildings.filter((bl) => bl.z + bl.depth / 2 < z - depth / 2 - 2);
    b.buildings.push({
      x: b.cx,
      z,
      y: CURB_HEIGHT,
      width,
      depth,
      height: metrics.groundFloor + metrics.floor + PARAPET,
      style: STYLE_BRICK,
      color: [0.42, 0.2, 0.12],
      seed: 31,
    });
    b.roofProps = b.roofProps.filter((p) => p.z < z - depth / 2 - 2);
    b.trees = b.trees.filter((tr) => !(Math.abs(tr.x - b.cx) < width / 2 + 2 && Math.abs(tr.z - z) < depth / 2 + 2));
    stores.push({ name: t.name, door: new THREE.Vector3(b.cx, CURB_HEIGHT, z + depth / 2), normal: new THREE.Vector3(0, 0, 1) });
  }

  return {
    hospitals,
    stores,
    nearestHospital(x, z) {
      let best = hospitals[0];
      let bestDist = Infinity;
      for (const h of hospitals) {
        const d = Math.hypot(h.spawn.x - x, h.spawn.z - z);
        if (d < bestDist) {
          best = h;
          bestDist = d;
        }
      }
      return best;
    },
  };
}

/** "✚ HOSPITAL" in white on red. */
function hospitalSignTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#c62828';
  ctx.fillRect(0, 0, 640, 128);
  ctx.fillStyle = '#ffffff';
  // Cross.
  ctx.fillRect(40, 52, 72, 24);
  ctx.fillRect(64, 28, 24, 72);
  ctx.font = 'bold 76px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('HOSPITAL', 370, 68);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
