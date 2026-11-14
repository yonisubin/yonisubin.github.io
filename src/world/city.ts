import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  BLOCK_SIZE,
  CITY_HALF,
  CURB_HEIGHT,
  LOT,
  ROAD_WIDTH,
  generateCity,
  spawnPoint,
  type CityLayout,
} from './layout';
import { createFacadeMaterial } from './facadeMaterial';
import { asphaltTexture, grassTexture, helipadTexture, sidewalkTexture } from './textures';

// Turns the city layout into meshes and colliders.
// Every kind of repeated object is one InstancedMesh, so the whole city is ~a dozen draw calls.

export interface City {
  layout: CityLayout;
  /** Where the player starts (capsule centre). */
  spawn: THREE.Vector3;
  dispose(): void;
}

// Scratch objects for composing instance matrices.
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _mat = new THREE.Matrix4();
const _color = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

function setInstance(
  mesh: THREE.InstancedMesh,
  i: number,
  x: number,
  y: number,
  z: number,
  sx = 1,
  sy = 1,
  sz = 1,
  yaw = 0,
): void {
  _quat.setFromAxisAngle(UP, yaw);
  mesh.setMatrixAt(i, _mat.compose(_pos.set(x, y, z), _quat, _scale.set(sx, sy, sz)));
}

export function createCity(scene: THREE.Scene, world: RAPIER.World, seed: number): City {
  const layout = generateCity(seed);
  const disposables: { dispose(): void }[] = [];
  const objects: THREE.Object3D[] = [];
  const colliders: RAPIER.Collider[] = [];

  const add = <T extends THREE.Mesh>(mesh: T): T => {
    disposables.push(mesh.geometry);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    disposables.push(...mats);
    scene.add(mesh);
    objects.push(mesh);
    return mesh;
  };
  const collider = (desc: RAPIER.ColliderDesc) => colliders.push(world.createCollider(desc));

  // --- Ground: asphalt across the city, grass beyond it, one big flat collider.
  const groundSize = CITY_HALF * 2 + 40;
  const asphalt = asphaltTexture();
  asphalt.repeat.set(groundSize / 10, groundSize / 10);
  disposables.push(asphalt);
  const road = add(
    new THREE.Mesh(
      new THREE.PlaneGeometry(groundSize, groundSize).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.92 }),
    ),
  );
  road.receiveShadow = true;

  // Grass beyond the city: four strips around the asphalt (not one plane underneath it,
  // which would z-fight with the road at a distance).
  const FIELD = 3000;
  const outerGrass = grassTexture();
  outerGrass.repeat.set(FIELD / 10, FIELD / 10);
  disposables.push(outerGrass);
  const g = groundSize / 2;
  const strip = (w: number, d: number, x: number, z: number) =>
    new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(x, 0, z);
  const fieldGeo = mergeGeometries([
    strip(FIELD, FIELD / 2 - g, 0, -(FIELD / 2 + g) / 2), // north
    strip(FIELD, FIELD / 2 - g, 0, (FIELD / 2 + g) / 2), // south
    strip(FIELD / 2 - g, 2 * g, -(FIELD / 2 + g) / 2, 0), // west
    strip(FIELD / 2 - g, 2 * g, (FIELD / 2 + g) / 2, 0), // east
  ]);
  // World-space UVs so the grass texture tiles at the same scale on every strip.
  const uv = fieldGeo.getAttribute('uv');
  const pos = fieldGeo.getAttribute('position');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / FIELD + 0.5, pos.getZ(i) / FIELD + 0.5);
  const field = add(new THREE.Mesh(fieldGeo, new THREE.MeshStandardMaterial({ map: outerGrass, roughness: 1 })));
  field.receiveShadow = true;

  // Ground collider as 100 m tiles rather than one huge slab: the character controller
  // rested several cm *inside* a single 3 km collider (observed; most likely precision loss),
  // and per-tile colliders also suit loading the world in chunks later.
  const TILE = 100;
  for (let x = -FIELD / 2; x < FIELD / 2; x += TILE) {
    for (let z = -FIELD / 2; z < FIELD / 2; z += TILE) {
      collider(RAPIER.ColliderDesc.cuboid(TILE / 2, 1, TILE / 2).setTranslation(x + TILE / 2, -1, z + TILE / 2));
    }
  }

  buildRoadMarkings(layout, add);

  // --- Block slabs: raised sidewalk + lot, all identical so the texture tiles correctly.
  const pavement = sidewalkTexture();
  pavement.repeat.set(BLOCK_SIZE / 8, BLOCK_SIZE / 8); // 2 m paving slabs
  disposables.push(pavement);
  const slabs = add(
    new THREE.InstancedMesh(
      new THREE.BoxGeometry(BLOCK_SIZE, CURB_HEIGHT, BLOCK_SIZE).translate(0, CURB_HEIGHT / 2, 0),
      new THREE.MeshStandardMaterial({ map: pavement, roughness: 0.9 }),
      layout.blocks.length,
    ),
  );
  slabs.receiveShadow = true;
  layout.blocks.forEach((b, i) => {
    setInstance(slabs, i, b.cx, 0, b.cz);
    collider(
      RAPIER.ColliderDesc.cuboid(BLOCK_SIZE / 2, CURB_HEIGHT / 2, BLOCK_SIZE / 2).setTranslation(b.cx, CURB_HEIGHT / 2, b.cz),
    );
  });

  // --- Park lawns on top of park blocks.
  const parks = layout.blocks.filter((b) => b.park);
  if (parks.length > 0) {
    const lawn = grassTexture();
    lawn.repeat.set(LOT / 6, LOT / 6);
    disposables.push(lawn);
    const lawns = add(
      new THREE.InstancedMesh(
        new THREE.PlaneGeometry(LOT, LOT).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({ map: lawn, roughness: 1 }),
        parks.length,
      ),
    );
    lawns.receiveShadow = true;
    parks.forEach((b, i) => setInstance(lawns, i, b.cx, CURB_HEIGHT + 0.01, b.cz));
  }

  // --- Helipad marking on its park (a flat decal; the slab underneath is the collider).
  const pad = layout.blocks.find((b) => b.helipad);
  if (pad) {
    const padTex = helipadTexture();
    disposables.push(padTex);
    const padMesh = add(
      new THREE.Mesh(
        new THREE.PlaneGeometry(18, 18).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({
          map: padTex,
          transparent: true,
          roughness: 0.85,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -4,
        }),
      ),
    );
    padMesh.position.set(pad.cx, CURB_HEIGHT + 0.02, pad.cz);
    padMesh.receiveShadow = true;
  }

  // --- Buildings: one unit box stretched per instance, facades drawn by the shader.
  const buildings = layout.blocks.flatMap((b) => b.buildings);
  const buildingGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const style = new Float32Array(buildings.length * 4);
  buildings.forEach((b, i) => {
    style[i * 4] = b.style;
    style[i * 4 + 1] = b.seed;
  });
  buildingGeo.setAttribute('aStyle', new THREE.InstancedBufferAttribute(style, 4));
  const buildingMesh = add(new THREE.InstancedMesh(buildingGeo, createFacadeMaterial(), buildings.length));
  buildingMesh.castShadow = true;
  buildingMesh.receiveShadow = true;
  buildings.forEach((b, i) => {
    setInstance(buildingMesh, i, b.x, CURB_HEIGHT, b.z, b.width, b.height, b.depth);
    buildingMesh.setColorAt(i, _color.setRGB(...b.color));
    collider(
      RAPIER.ColliderDesc.cuboid(b.width / 2, b.height / 2, b.depth / 2).setTranslation(b.x, CURB_HEIGHT + b.height / 2, b.z),
    );
  });

  // --- Rooftop AC units and water tanks (no colliders: nothing can reach roofs yet).
  const props = layout.blocks.flatMap((b) => b.roofProps);
  const acs = props.filter((p) => p.kind === 'ac');
  const tanks = props.filter((p) => p.kind === 'tank');
  const acMesh = add(
    new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      new THREE.MeshStandardMaterial({ color: 0x8d9093, roughness: 0.5, metalness: 0.4 }),
      acs.length,
    ),
  );
  acMesh.castShadow = true;
  acs.forEach((p, i) => setInstance(acMesh, i, p.x, CURB_HEIGHT + p.y, p.z, ...p.size));
  const tankMesh = add(
    new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.5, 0.5, 1, 16).translate(0, 0.5, 0),
      new THREE.MeshStandardMaterial({ color: 0x5e4632, roughness: 0.9 }),
      tanks.length,
    ),
  );
  tankMesh.castShadow = true;
  tanks.forEach((p, i) => setInstance(tankMesh, i, p.x, CURB_HEIGHT + p.y, p.z, ...p.size));

  // --- Trees: trunk + clustered low-poly canopy, colour varied per instance.
  const trees = layout.blocks.flatMap((b) => b.trees);
  const trunkMesh = add(
    new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.12, 0.2, 2.8, 7).translate(0, 1.4, 0),
      new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 1 }),
      trees.length,
    ),
  );
  const canopyGeo = mergeGeometries([
    new THREE.IcosahedronGeometry(1.7, 1).translate(0, 4.0, 0),
    new THREE.IcosahedronGeometry(1.3, 1).translate(1.0, 3.4, 0.4),
    new THREE.IcosahedronGeometry(1.35, 1).translate(-0.8, 3.6, -0.6),
    new THREE.IcosahedronGeometry(1.1, 1).translate(0.2, 3.3, -1.1),
  ]);
  const canopyMesh = add(
    new THREE.InstancedMesh(
      canopyGeo,
      new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }),
      trees.length,
    ),
  );
  trunkMesh.castShadow = canopyMesh.castShadow = true;
  canopyMesh.receiveShadow = true;
  trees.forEach((t, i) => {
    const yaw = t.hue * Math.PI * 2;
    setInstance(trunkMesh, i, t.x, CURB_HEIGHT, t.z, t.scale, t.scale, t.scale, yaw);
    setInstance(canopyMesh, i, t.x, CURB_HEIGHT, t.z, t.scale, t.scale, t.scale, yaw);
    canopyMesh.setColorAt(i, _color.setHSL(0.22 + t.hue * 0.09, 0.45, 0.16 + t.hue * 0.08));
    collider(
      RAPIER.ColliderDesc.cylinder(1.4 * t.scale, 0.2 * t.scale).setTranslation(t.x, CURB_HEIGHT + 1.4 * t.scale, t.z),
    );
  });

  // --- Street lamps: pole + arm + luminaire merged into one geometry.
  const lamps = layout.blocks.flatMap((b) => b.lamps);
  const lampGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.07, 0.11, 7, 8).translate(0, 3.5, 0),
    new THREE.BoxGeometry(1.9, 0.08, 0.08).translate(0.95, 6.9, 0),
    new THREE.BoxGeometry(0.7, 0.14, 0.3).translate(1.8, 6.85, 0),
  ]);
  const lampMesh = add(
    new THREE.InstancedMesh(
      lampGeo,
      new THREE.MeshStandardMaterial({ color: 0x2e3236, roughness: 0.45, metalness: 0.6 }),
      lamps.length,
    ),
  );
  lampMesh.castShadow = true;
  lamps.forEach((l, i) => {
    setInstance(lampMesh, i, l.x, CURB_HEIGHT, l.z, 1, 1, 1, l.yaw);
    collider(RAPIER.ColliderDesc.cylinder(3.5, 0.12).setTranslation(l.x, CURB_HEIGHT + 3.5, l.z));
  });

  const sp = spawnPoint(layout);
  return {
    layout,
    spawn: new THREE.Vector3(sp.x, CURB_HEIGHT + 1.0, sp.z),
    dispose() {
      for (const o of objects) scene.remove(o);
      for (const d of disposables) d.dispose();
      for (const c of colliders) world.removeCollider(c, false);
    },
  };
}

/**
 * Lane markings, drawn as flat instanced quads just above the asphalt:
 *  - double yellow centre line and dashed white lane dividers on each road segment
 *  - zebra crossings and stop lines at every intersection approach
 */
function buildRoadMarkings(layout: CityLayout, add: <T extends THREE.Mesh>(m: T) => T): void {
  type Strip = { x: number; z: number; sx: number; sz: number };
  const white: Strip[] = [];
  const yellow: Strip[] = [];
  const lines = layout.roadLines;
  const half = ROAD_WIDTH / 2;
  const CROSSWALK = 3.2; // length of zebra stripes along the road
  const CROSS_GAP = 0.6; // between intersection edge and crossing

  // Each road segment runs between two adjacent intersections. `alongZ` = the road runs along Z.
  const segment = (fixed: number, from: number, to: number, alongZ: boolean) => {
    const strip = (offset: number, a: number, b: number, width: number, list: Strip[]) => {
      const mid = (a + b) / 2;
      const len = b - a;
      list.push(alongZ ? { x: fixed + offset, z: mid, sx: width, sz: len } : { x: mid, z: fixed + offset, sx: len, sz: width });
    };
    const start = from + half; // edge of the previous intersection
    const end = to - half;
    const linesFrom = start + CROSS_GAP + CROSSWALK + 1.2;
    const linesTo = end - CROSS_GAP - CROSSWALK - 1.2;

    // Double yellow centre line.
    strip(-0.17, linesFrom, linesTo, 0.12, yellow);
    strip(0.17, linesFrom, linesTo, 0.12, yellow);
    // Dashed lane dividers: 3 m dash, 6 m gap.
    for (let t = linesFrom + 2; t + 3 < linesTo - 2; t += 9) {
      strip(-3.5, t, t + 3, 0.12, white);
      strip(3.5, t, t + 3, 0.12, white);
    }
    // Stop lines across the approaching lanes (traffic drives on the right).
    strip(-half / 2 - 0.1, linesTo, linesTo + 0.45, half - 0.4, white);
    strip(half / 2 + 0.1, linesFrom - 0.45, linesFrom, half - 0.4, white);
    // Zebra crossings at both ends: stripes parallel to the road, spread across it.
    for (const [a, b] of [
      [start + CROSS_GAP, start + CROSS_GAP + CROSSWALK],
      [end - CROSS_GAP - CROSSWALK, end - CROSS_GAP],
    ]) {
      for (let o = -half + 0.9; o <= half - 0.9; o += 1.1) strip(o, a, b, 0.55, white);
    }
  };

  for (const fixed of lines) {
    for (let i = 0; i + 1 < lines.length; i++) {
      segment(fixed, lines[i], lines[i + 1], true);
      segment(fixed, lines[i], lines[i + 1], false);
    }
  }

  const quad = () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const paint = (color: number) =>
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.7,
      // Pull the paint toward the camera in depth so it never z-fights with the asphalt.
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  for (const [list, color] of [
    [white, 0xd8d8d2],
    [yellow, 0xd9a82b],
  ] as const) {
    const mesh = add(new THREE.InstancedMesh(quad(), paint(color), list.length));
    mesh.receiveShadow = true;
    list.forEach((s, i) => setInstance(mesh, i, s.x, 0.01, s.z, s.sx, 1, s.sz));
  }
}
