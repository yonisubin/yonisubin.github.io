import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  BLOCK_SIZE,
  CURB_HEIGHT,
  LOT,
  WORLD_HALF,
  generateCity,
  helipadPosition,
  spawnPoint,
  type CityLayout,
} from './layout';
import { createFacadeMaterial } from './facadeMaterial';
import { asphaltTexture, glowTexture, grainTexture, grassTexture, helipadTexture, sidewalkTexture } from './textures';
import { Terrain } from './terrain';
import { InstancePool } from './instancePool';
import { CHUNKS, CHUNK_SIZE, LAMP_HEAD_OUT, WorldStreamer, type WorldPools } from './chunks';

// The world: shared materials and instance pools, the streamed chunks (world/chunks.ts),
// the coarse distant terrain, and a few one-off pieces (helipad decal, world boundary).

export interface City {
  layout: CityLayout;
  terrain: Terrain;
  streamer: WorldStreamer;
  /** Where the player starts (capsule centre). */
  spawn: THREE.Vector3;
  /** Coarse height grid of the whole world (for the distant terrain, water depth and maps). */
  coarse: CoarseGrid;
  /** 0 by day … 1 at night: street lamps glow and light the pavement. */
  setNight(night: number): void;
  /** Stream chunks around the player (call every frame). */
  update(focus: THREE.Vector3): void;
  /** Is there ground (a loaded terrain collider) at (x, z)? */
  isLoaded(x: number, z: number): boolean;
}

/** Heights sampled every `step` m over a square of side 2·half centred on the origin. */
export interface CoarseGrid {
  step: number;
  half: number;
  n: number; // samples per side
  heights: Float32Array; // row by row, −Z to +Z, −X to +X
}

const FAR_HALF = 2600; // m covered by the distant terrain (beyond the world's edge)
const FAR_STEP = 32;

export function createCity(scene: THREE.Scene, world: RAPIER.World, seed: number): City {
  const layout = generateCity(seed);
  const terrain = new Terrain(layout);

  // --- Materials shared by all chunks.
  const grain = grainTexture();
  const terrainMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, map: grain, roughness: 1 });
  const asphalt = asphaltTexture();
  const roadMaterial = new THREE.MeshStandardMaterial({
    map: asphalt,
    roughness: 0.92,
    // Drawn just above the terrain: pull it forward in depth so it never z-fights.
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const paintMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.7,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  // --- Instance pools: one draw call per kind of object, whatever is loaded.
  const pool = (geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number, color = false) => {
    const p = new InstancePool(geometry, material, capacity, color);
    scene.add(p.mesh);
    return p;
  };

  const pavement = sidewalkTexture();
  pavement.repeat.set(BLOCK_SIZE / 8, BLOCK_SIZE / 8); // 2 m paving slabs
  const slabs = pool(
    new THREE.BoxGeometry(BLOCK_SIZE, CURB_HEIGHT, BLOCK_SIZE).translate(0, CURB_HEIGHT / 2, 0),
    new THREE.MeshStandardMaterial({ map: pavement, roughness: 0.9 }),
    700,
  );
  slabs.mesh.receiveShadow = true;

  const lawnTex = grassTexture();
  lawnTex.repeat.set(LOT / 6, LOT / 6);
  const lawns = pool(new THREE.PlaneGeometry(LOT, LOT).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: lawnTex, roughness: 1 }), 600);
  lawns.mesh.receiveShadow = true;

  // Buildings: one unit box stretched per instance, facades drawn by the shader.
  const buildingGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const BUILDINGS = 6000;
  buildingGeo.setAttribute('aStyle', new THREE.InstancedBufferAttribute(new Float32Array(BUILDINGS * 4), 4));
  const buildings = pool(buildingGeo, createFacadeMaterial(), BUILDINGS, true);
  buildings.mesh.castShadow = true;
  buildings.mesh.receiveShadow = true;

  // Pitched roofs: a unit prism (ridge along X at y = 1, eaves at y = 0).
  const roofs = pool(roofPrism(), new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true }), 5000, true);
  roofs.mesh.castShadow = true;
  roofs.mesh.receiveShadow = true;

  const acs = pool(
    new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    new THREE.MeshStandardMaterial({ color: 0x8d9093, roughness: 0.5, metalness: 0.4 }),
    2500,
  );
  acs.mesh.castShadow = true;
  const tanks = pool(
    new THREE.CylinderGeometry(0.5, 0.5, 1, 16).translate(0, 0.5, 0),
    new THREE.MeshStandardMaterial({ color: 0x5e4632, roughness: 0.9 }),
    400,
  );
  tanks.mesh.castShadow = true;

  // Street and park trees: trunk + clustered low-poly canopy, colour varied per instance.
  const trunks = pool(
    new THREE.CylinderGeometry(0.12, 0.2, 2.8, 7).translate(0, 1.4, 0),
    new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 1 }),
    5000,
  );
  // One rounder main blob and three simpler ones (140 triangles): the bigger world has
  // thousands of street and garden trees loaded at once.
  const canopyGeo = mergeGeometries([
    new THREE.IcosahedronGeometry(1.7, 1).translate(0, 4.0, 0),
    new THREE.IcosahedronGeometry(1.35, 0).translate(1.0, 3.4, 0.4),
    new THREE.IcosahedronGeometry(1.4, 0).translate(-0.8, 3.6, -0.6),
    new THREE.IcosahedronGeometry(1.15, 0).translate(0.2, 3.3, -1.1),
  ]);
  const canopies = pool(canopyGeo, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), 5000, true);
  trunks.mesh.castShadow = canopies.mesh.castShadow = true;
  canopies.mesh.receiveShadow = true;

  // Countryside trees: a cheap trunk + two-cone pine (≈ 40 triangles), no shadows (there
  // are thousands of them).
  const forest = pool(forestTree(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }), 9000, true);
  forest.mesh.receiveShadow = true;

  // Street lamps: pole + arm merged into one geometry; the luminaire is separate so it can glow.
  const lampGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.07, 0.11, 7, 8).translate(0, 3.5, 0),
    new THREE.BoxGeometry(1.9, 0.08, 0.08).translate(0.95, 6.9, 0),
  ]);
  const lamps = pool(lampGeo, new THREE.MeshStandardMaterial({ color: 0x2e3236, roughness: 0.45, metalness: 0.6 }), 2000);
  lamps.mesh.castShadow = true;
  const lampHeadMaterial = new THREE.MeshStandardMaterial({ color: 0x3a3c40, emissive: 0xffd9a0, emissiveIntensity: 0 });
  const lampHeads = pool(new THREE.BoxGeometry(0.7, 0.14, 0.3).translate(LAMP_HEAD_OUT, 6.85, 0), lampHeadMaterial, 2000);
  // Pools of light on the ground under each lamp: soft additive discs (far cheaper than
  // hundreds of real lights). Drawn just above the curb height so they show on the pavement.
  const poolMaterial = new THREE.MeshBasicMaterial({
    map: glowTexture(),
    color: 0xffc98a,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -6,
    polygonOffsetUnits: -6,
  });
  const lightPools = pool(new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2), poolMaterial, 2000);
  lightPools.mesh.visible = false;

  const pools: WorldPools = { buildings, roofs, slabs, lawns, acs, tanks, trunks, canopies, forest, lamps, lampHeads, lightPools };
  const streamer = new WorldStreamer(scene, world, layout, terrain, pools, {
    terrain: terrainMaterial,
    road: roadMaterial,
    paint: paintMaterial,
  });

  // --- Distant terrain: the whole world at low resolution, hidden wherever a chunk is loaded.
  const coarse = sampleCoarse(terrain);
  scene.add(farTerrain(coarse, terrain, streamer));

  // --- Helipad marking on its park (a flat decal; the block slab underneath is the collider).
  const pad = helipadPosition(layout);
  const padMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 18).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({
      map: helipadTexture(),
      transparent: true,
      roughness: 0.85,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    }),
  );
  padMesh.position.set(pad.x, CURB_HEIGHT + 0.02, pad.z);
  padMesh.receiveShadow = true;
  scene.add(padMesh);

  // --- The edge of the world: invisible walls just inside the rim hills and out at sea.
  const wall = WORLD_HALF - 15;
  for (const [x, z, hx, hz] of [
    [wall, 0, 1, wall],
    [-wall, 0, 1, wall],
    [0, wall, wall, 1],
    [0, -wall, wall, 1],
  ]) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 300, hz).setTranslation(x, 0, z));
  }

  const sp = spawnPoint(layout);
  return {
    layout,
    terrain,
    streamer,
    coarse,
    spawn: new THREE.Vector3(sp.x, CURB_HEIGHT + 1.0, sp.z),
    setNight(night) {
      lampHeadMaterial.emissiveIntensity = night * 4;
      poolMaterial.opacity = night * 0.55;
      lightPools.mesh.visible = night > 0.01;
    },
    update(focus) {
      streamer.update(focus);
    },
    isLoaded: (x, z) => streamer.isLoaded(x, z),
  };
}

/** Unit prism: square base [−0.5, 0.5]² at y = 0, ridge along X at y = 1 (gable ends at ±X). */
function roofPrism(): THREE.BufferGeometry {
  const v = [
    // Two sloped faces.
    [-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 1, 0], [-0.5, 1, 0],
    [0.5, 0, -0.5], [-0.5, 0, -0.5], [-0.5, 1, 0], [0.5, 1, 0],
  ];
  const positions: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => positions.push(...a, ...b, ...c, ...a, ...c, ...d);
  quad(v[0], v[1], v[2], v[3]);
  quad(v[4], v[5], v[6], v[7]);
  // Gable triangles at both ends.
  positions.push(0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 1, 0);
  positions.push(-0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 1, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}

/** A low-poly countryside tree with vertex colours (brown trunk, white crown tinted per instance). */
function forestTree(): THREE.BufferGeometry {
  const parts: [THREE.BufferGeometry, [number, number, number]][] = [
    [new THREE.CylinderGeometry(0.15, 0.25, 2.2, 5).translate(0, 1.1, 0), [0.35, 0.22, 0.13]],
    [new THREE.ConeGeometry(2.3, 4.2, 7).translate(0, 3.6, 0), [1, 1, 1]],
    [new THREE.ConeGeometry(1.7, 3.4, 7).translate(0, 5.6, 0), [1, 1, 1]],
  ];
  const geos = parts.map(([g, c]) => {
    const geo = g.toNonIndexed();
    const n = geo.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colors.set(c, i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.deleteAttribute('uv');
    return geo;
  });
  return mergeGeometries(geos);
}

function sampleCoarse(terrain: Terrain): CoarseGrid {
  const n = Math.round((FAR_HALF * 2) / FAR_STEP) + 1;
  const heights = new Float32Array(n * n);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) heights[iz * n + ix] = terrain.heightAt(-FAR_HALF + ix * FAR_STEP, -FAR_HALF + iz * FAR_STEP);
  }
  return { step: FAR_STEP, half: FAR_HALF, n, heights };
}

/**
 * The whole world's terrain at 32 m resolution, so hills and the coast show on the horizon
 * and from the helicopter. Its fragment shader discards pixels inside loaded chunks (where
 * the detailed terrain is), using the streamer's loaded-chunk mask as a tiny texture.
 */
function farTerrain(coarse: CoarseGrid, terrain: Terrain, streamer: WorldStreamer): THREE.Mesh {
  const { n, half, step, heights } = coarse;
  const geometry = new THREE.PlaneGeometry(half * 2, half * 2, n - 1, n - 1).rotateX(-Math.PI / 2);
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heights[i] - 0.3);
  geometry.computeVertexNormals();
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    let c = terrain.colorAt(x, z, heights[i], 1 - normal.getY(i));
    // From afar, forests read as a dark green canopy and towns as grey.
    if (terrain.zoneAt(x, z) === 'forest' && heights[i] > 0) c = [c[0] * 0.55, c[1] * 0.75, c[2] * 0.55];
    if (terrain.townDistance(x, z) === 0) c = [0.22, 0.22, 0.22];
    colors.set(c, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  void step;

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  const origin = -(CHUNKS * CHUNK_SIZE) / 2;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uLoaded = { value: streamer.loadedTexture };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWorldXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldXZ = (modelMatrix * vec4(position, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWorldXZ;\nuniform sampler2D uLoaded;')
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        vec2 chunk = (vWorldXZ - ${origin.toFixed(1)}) / ${CHUNK_SIZE.toFixed(1)};
        if (chunk.x >= 0.0 && chunk.y >= 0.0 && chunk.x < ${CHUNKS.toFixed(1)} && chunk.y < ${CHUNKS.toFixed(1)}) {
          if (texture2D(uLoaded, (floor(chunk) + 0.5) / ${CHUNKS.toFixed(1)}).r > 0.5) discard;
        }`,
      );
  };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = false;
  return mesh;
}
