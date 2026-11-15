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
import type { Parcel, ParcelKind } from '../world/suburbs';

// Special places spread around the world, chosen deterministically from the layout:
//
//   hospitals — where you wake up after being knocked out (the one nearest to where you
//               fell). A white building with a red-cross sign, a forecourt and two parked cars.
//   stores    — extra Guns & Ammo shops (the first one, downtown by the spawn, is placed by
//               game/shop.ts as before).
//
// Downtown, a place takes over one town block; elsewhere it takes over a parcel (a strip mall,
// a school's grounds, a village or seaside shop). Buildings are replaced before any chunk is
// built, so the streamed meshes and colliders already include them.

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

/** Parcels a hospital may take over (big ones first), and ones a store may move into. */
const HOSPITAL_PARCELS: ParcelKind[] = ['stripmall', 'school', 'bigbox', 'shop', 'village'];
const STORE_PARCELS: ParcelKind[] = ['stripmall', 'shop', 'village'];

const HOSPITAL_TARGETS: { name: string; x: number; z: number; zones: Zone[] }[] = [
  { name: 'City General Hospital', x: -200, z: -200, zones: ['downtown'] },
  { name: 'Northside Hospital', x: 100, z: -820, zones: ['suburb'] },
  { name: 'Eastside Hospital', x: 860, z: 150, zones: ['suburb'] },
  { name: 'Westside Hospital', x: -860, z: -100, zones: ['suburb'] },
  { name: 'Seaside Hospital', x: 300, z: 1520, zones: ['beachtown'] },
  ...VILLAGES.map((v) => ({ name: `${v.name} Clinic`, x: lineCoord(v.i), z: lineCoord(v.k), zones: ['village'] as Zone[] })),
];

/** Police stations: where you wake up after being busted. */
const POLICE_TARGETS: { name: string; x: number; z: number; zones: Zone[] }[] = [
  { name: 'Central Police Station', x: 220, z: 160, zones: ['downtown'] },
  { name: 'Northside Police', x: -520, z: -600, zones: ['suburb'] },
  { name: 'Eastside Police', x: 700, z: 640, zones: ['suburb'] },
  { name: 'Westside Police', x: -700, z: 260, zones: ['suburb'] },
  { name: 'Seaside Police', x: -60, z: 1500, zones: ['beachtown'] },
];

const STORE_TARGETS: { name: string; x: number; z: number; zones: Zone[] }[] = [
  { name: 'Seaside', x: -420, z: 1520, zones: ['beachtown'] },
  { name: 'Northside', x: -320, z: -700, zones: ['suburb'] },
  { name: 'Eastside', x: 720, z: -420, zones: ['suburb'] },
  { name: 'Westside', x: -720, z: 520, zones: ['suburb'] },
  { name: 'Eastfield', x: lineCoord(VILLAGES[0].i) + 80, z: lineCoord(VILLAGES[0].k) + 80, zones: ['village'] },
];

export interface Places {
  /** Parcels taken by hospitals and stores. */
  usedParcels: Set<Parcel>;
  hospitals: Hospital[];
  /** Police stations (same shape as a hospital: a door, a spawn spot, parked cars). */
  police: Hospital[];
  stores: StoreSite[];
  /** The hospital nearest to (x, z). */
  nearestHospital(x: number, z: number): Hospital;
  /** The police station nearest to (x, z). */
  nearestPolice(x: number, z: number): Hospital;
}

export function createPlaces(
  layout: CityLayout,
  scene: THREE.Scene,
  /** Height you'd stand at, at (x, z) (Terrain.surfaceAt): towns are hilly. */
  surface: (x: number, z: number) => number,
): Places {
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

  const usedParcels = new Set<Parcel>();
  /** The nearest free parcel of one of `kinds` (in order of preference within 600 m). */
  const pickParcel = (x: number, z: number, kinds: ParcelKind[]): Parcel | null => {
    for (const kind of kinds) {
      let best: Parcel | null = null;
      let bestDist = 600;
      for (const p of layout.streets.parcels) {
        if (p.kind !== kind || usedParcels.has(p) || !p.buildings.length) continue;
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < bestDist) {
          best = p;
          bestDist = d;
        }
      }
      if (best) {
        usedParcels.add(best);
        return best;
      }
    }
    return null;
  };
  // Parcel-local axes: u along the street, v into the parcel (the front faces the street at −v).
  const axes = (yaw: number) => ({ ux: Math.cos(yaw), uz: -Math.sin(yaw), vx: Math.sin(yaw), vz: Math.cos(yaw) });

  const signTex = hospitalSignTexture();
  const signMaterial = new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.6 });

  const policeTex = policeSignTexture();
  const policeSign = new THREE.MeshStandardMaterial({ map: policeTex, emissive: 0xffffff, emissiveMap: policeTex, emissiveIntensity: 0.6 });
  /** What tells a hospital from a police station: the sign and the walls. */
  interface Look {
    sign: THREE.Material;
    color: [number, number, number];
    kind?: 'hospital';
  }
  const HOSPITAL_LOOK: Look = { sign: signMaterial, color: [0.78, 0.8, 0.82], kind: 'hospital' };
  const POLICE_LOOK: Look = { sign: policeSign, color: [0.36, 0.42, 0.52] };

  const build = (targets: typeof HOSPITAL_TARGETS, look: Look): Hospital[] => {
    const out: Hospital[] = [];
    for (const t of targets) {
      if (!t.zones.includes('downtown')) {
        const p = pickParcel(t.x, t.z, HOSPITAL_PARCELS);
        if (p) out.push(parcelHospital(p, t.name, out.length, look));
        continue;
      }
      const b = pick(t.x, t.z, t.zones);
      if (b) out.push(blockHospital(b, t.name, out.length, look));
    }
    return out;
  };

  /**
   * A downtown block: a four-storey block set back toward the north, leaving a forecourt by
   * the southern street; the entrance faces that street (+Z).
   */
  function blockHospital(b: Block, name: string, index: number, look: Look): Hospital {
    const metrics = STYLE_METRICS[STYLE_CONCRETE];
    const width = 42;
    const depth = 26;
    const floors = b.zone === 'village' ? 2 : 4;
    const height = metrics.groundFloor + floors * metrics.floor + PARAPET;
    const z = b.cz - LOT / 2 + depth / 2 + 3;
    b.park = false;
    b.lawn = false;
    b.buildings = [{ x: b.cx, z, y: CURB_HEIGHT, width, depth, height, style: STYLE_CONCRETE, color: look.color, seed: 7, kind: look.kind }];
    b.roofProps = [];
    b.trees = b.trees.filter((tr) => Math.abs(tr.z - b.cz) > LOT / 2); // keep street trees only
    const world = (x: number, z: number, lift = 0) => new THREE.Vector3(x, surface(x, z) + lift, z);
    const door = world(b.cx, z + depth / 2 + 1);

    // Sign over the entrance.
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.8), look.sign);
    const signAt = world(b.cx, z + depth / 2 + 0.08);
    sign.position.set(signAt.x, door.y + metrics.groundFloor + 0.45, signAt.z);
    scene.add(sign);

    // Two cars in the parking lane of the street to the south (its northern lane, by the
    // curb, facing −X like the traffic on that side of the road).
    const roadZ = b.cz + PITCH / 2;
    const laneZ = roadZ - ROAD_WIDTH / 2 + 1.75;
    const parking: ParkingSpot[] = [
      { x: b.cx - 9, z: laneZ, yaw: Math.PI, type: 'sedan' as const, colorIndex: index % 9 },
      { x: b.cx + 4, z: laneZ, yaw: Math.PI, type: index % 2 ? ('van' as const) : ('sedan' as const), colorIndex: (index + 4) % 9 },
    ];
    return {
      name,
      spawn: world(b.cx, z + depth / 2 + 5, 1.0),
      heading: Math.PI, // facing out to the street; camera yaw π looks toward +Z
      door,
      parking,
    };
  }

  const hospitals = build(HOSPITAL_TARGETS, HOSPITAL_LOOK);
  const police = build(POLICE_TARGETS, POLICE_LOOK);

  const stores: StoreSite[] = [];
  for (const t of STORE_TARGETS) {
    if (!t.zones.includes('downtown')) {
      const p = pickParcel(t.x, t.z, STORE_PARCELS);
      if (!p) continue;
      // One unit of the row of shops: a door in the front wall (facing the parking lot or
      // the street), toward one end for a strip mall.
      const bl = p.buildings[0];
      const { ux, uz, vx, vz } = axes(p.yaw);
      const along = p.kind === 'stripmall' ? (bl.width / 2 - 8) * (p.x > 0 ? 1 : -1) : 0;
      const x = bl.x + ux * along - vx * (bl.depth / 2);
      const z = bl.z + uz * along - vz * (bl.depth / 2);
      stores.push({ name: t.name, door: new THREE.Vector3(x, surface(x - vx, z - vz), z), normal: new THREE.Vector3(-vx, 0, -vz) });
      continue;
    }
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
    stores.push({
      name: t.name,
      door: new THREE.Vector3(b.cx, surface(b.cx, z + depth / 2 + 1), z + depth / 2),
      normal: new THREE.Vector3(0, 0, 1), // the wall faces +Z, the southern street
    });
  }

  /**
   * Turn a parcel's main building into a hospital (a clinic on a small parcel): white
   * concrete, set back with the parking lot (or the street) in front, two cars parked there.
   */
  function parcelHospital(p: Parcel, name: string, index: number, look: Look): Hospital {
    const { ux, uz, vx, vz } = axes(p.yaw);
    const metrics = STYLE_METRICS[STYLE_CONCRETE];
    const big = p.w > 80;
    const width = big ? 42 : Math.min(22, p.w - 2);
    const depth = big ? 26 : Math.min(14, p.d - 4);
    const floors = big ? 4 : 2;
    const height = metrics.groundFloor + floors * metrics.floor + PARAPET;
    // Building at the back of the parcel (or where the old one stood on a small parcel).
    const back = big ? p.d / 2 - depth / 2 - 4 : -p.d / 2 + depth / 2 + 2;
    const cx = p.x + vx * back;
    const cz = p.z + vz * back;
    p.buildings = [{ x: cx, z: cz, y: 0, yaw: p.yaw, width, depth, height, style: STYLE_CONCRETE, color: look.color, seed: 7, kind: look.kind }];
    p.trees = p.trees.filter((tr) => Math.hypot(tr.x - cx, tr.z - cz) > Math.max(width, depth) / 2 + 3);
    if (p.kind === 'school') {
      p.fields = [];
      p.grass = [];
      p.paved = [{ x: p.x - vx * (p.d / 4), z: p.z - vz * (p.d / 4), yaw: p.yaw, w: p.w - 10, d: p.d / 2 - 6 }];
      p.stalls = [];
    }
    // Door in the front wall (facing −v), sign above it.
    const dx = cx - vx * (depth / 2);
    const dz = cz - vz * (depth / 2);
    const door = new THREE.Vector3(dx, surface(dx - vx, dz - vz), dz);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.8), look.sign);
    sign.position.set(dx - vx * 0.08, door.y + metrics.groundFloor + 0.45, dz - vz * 0.08);
    // A plane faces +Z; turn it to face −v.
    sign.rotation.y = Math.atan2(-vx, -vz);
    scene.add(sign);
    // Two cars in front, facing the building (car forward is +X; yaw turns +X toward (cos, −sin)).
    const yaw = Math.atan2(-vz, vx);
    const spot = (a: number): ParkingSpot => {
      const x = dx + ux * a - vx * 12;
      const z = dz + uz * a - vz * 12;
      return { x, z, yaw, type: index % 2 ? 'van' : 'sedan', colorIndex: (index * 3 + Math.round(a)) % 9 };
    };
    const sx = dx - vx * 5;
    const sz = dz - vz * 5;
    return {
      name,
      spawn: new THREE.Vector3(sx, surface(sx, sz) + 1.0, sz),
      // Facing away from the door: camera yaw θ looks along (−sin θ, −cos θ).
      heading: Math.atan2(vx, vz),
      door,
      parking: [spot(-7), spot(4)],
    };
  }

  return {
    usedParcels,
    hospitals,
    police,
    stores,
    nearestHospital: (x, z) => nearest(hospitals, x, z),
    nearestPolice: (x, z) => nearest(police.length ? police : hospitals, x, z),
  };
}

function nearest(list: Hospital[], x: number, z: number): Hospital {
  let best = list[0];
  let bestDist = Infinity;
  for (const h of list) {
    const d = Math.hypot(h.spawn.x - x, h.spawn.z - z);
    if (d < bestDist) {
      best = h;
      bestDist = d;
    }
  }
  return best;
}

/** "★ POLICE" in white on navy. */
function policeSignTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#1a3a7a';
  ctx.fillRect(0, 0, 640, 128);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 76px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('★ POLICE', 320, 68);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
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
