// Level brushes → meshes. Visual language (spec): portalable = bright white matte panels,
// non-portalable = dark metal, glass = see-through. Textures are drawn on canvases in code.
//
// Two themes: 'clean' (the practicals: bright white panels, subtly glossy floors) and 'industrial'
// (behind the scenes: grimy off-white panels, rusty plate, dull floors). A brush takes its own theme,
// else the level's (level.info.theme), else clean. Textures are drawn once per theme and shared.
//
// For the game (opts.dress), each brush's faces are regrouped so faces with the same material draw
// in one call (a box is 1–2 draw calls instead of 6), and procedural wear decals (scuffs near the
// floor, streaks under rust) are added as one instanced mesh per theme. The editor calls it plain:
// one group per face (its picking reads the face from the material index) and no decals.
import * as THREE from 'three';
import { CONFIG } from '../core/config';
import type { Brush, FaceKey, LevelData, SurfaceTag } from '../levels/level';
import { faceTag } from '../levels/level';

export type Theme = 'clean' | 'industrial';
const V = CONFIG.visuals;

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, repeat = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Deterministic pseudo-random stream so textures and decals look the same on every load. */
function stream(seed: number): () => number {
  let x = seed | 0 || 1;
  return () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

function speckle(g: CanvasRenderingContext2D, s: number, count: number, alpha: number, seed: number): void {
  const rnd = stream(seed);
  for (let i = 0; i < count; i++) {
    const v = Math.floor(rnd() * 255);
    g.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    g.fillRect(rnd() * s, rnd() * s, 1 + rnd() * 2, 1 + rnd() * 2);
  }
}

/** Soft blotches (grime, rust) of a colour. */
function blotches(g: CanvasRenderingContext2D, s: number, count: number, rgb: string, alpha: number, seed: number, maxR = 0.12): void {
  const rnd = stream(seed);
  for (let i = 0; i < count; i++) {
    const x = rnd() * s, y = rnd() * s, r = s * (0.02 + rnd() * maxR);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${rgb},${alpha * (0.4 + rnd() * 0.6)})`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
}

/** Vertical streaks running down from the top (water / rust stains). */
function streaks(g: CanvasRenderingContext2D, s: number, count: number, rgb: string, alpha: number, seed: number): void {
  const rnd = stream(seed);
  for (let i = 0; i < count; i++) {
    const x = rnd() * s, w = 2 + rnd() * 6, len = s * (0.2 + rnd() * 0.6), y0 = rnd() * s * 0.5;
    const grad = g.createLinearGradient(0, y0, 0, y0 + len);
    grad.addColorStop(0, `rgba(${rgb},${alpha})`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grad;
    g.fillRect(x, y0, w, len);
  }
}

/** One repeat = 2 m: 2×2 panels with thin seams. */
function panelTexture(theme: Theme): THREE.CanvasTexture {
  return canvasTexture(512, (g, s) => {
    const industrial = theme === 'industrial';
    g.fillStyle = industrial ? '#cfcabd' : '#f1f3f4';
    g.fillRect(0, 0, s, s);
    speckle(g, s, industrial ? 14000 : 5000, industrial ? 0.09 : 0.04, 7);
    if (industrial) {
      blotches(g, s, 26, '96,84,62', 0.22, 11);
      streaks(g, s, 14, '110,92,64', 0.22, 12);
    } else {
      // A faint tonal difference between the four panels (each was installed separately).
      const tones = [0, 0.018, 0.01, 0.025];
      tones.forEach((a, i) => {
        g.fillStyle = `rgba(80,90,100,${a})`;
        g.fillRect((i % 2) * (s / 2), Math.floor(i / 2) * (s / 2), s / 2, s / 2);
      });
    }
    g.fillStyle = industrial ? '#7d776a' : '#a3aaaf';
    const h = s / 2;
    for (const o of [0, h]) {
      g.fillRect(o, 0, 3, s);
      g.fillRect(0, o, s, 3);
    }
    g.fillStyle = industrial ? 'rgba(255,250,235,0.25)' : 'rgba(255,255,255,0.7)';
    for (const o of [0, h]) {
      g.fillRect(o + 3, 0, 1, s);
      g.fillRect(0, o + 3, s, 1);
    }
  });
}

/** One repeat = 2 m: dark plate metal with a tread, rivets; industrial adds rust and wear. */
function metalTexture(theme: Theme): THREE.CanvasTexture {
  return canvasTexture(512, (g, s) => {
    const industrial = theme === 'industrial';
    g.fillStyle = industrial ? '#4a4038' : '#4c535b';
    g.fillRect(0, 0, s, s);
    speckle(g, s, 9000, 0.08, 3);
    if (industrial) {
      blotches(g, s, 30, '128,64,26', 0.4, 5, 0.16);
      streaks(g, s, 20, '120,58,22', 0.35, 6);
      blotches(g, s, 12, '20,18,16', 0.35, 8);
    }
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 2;
    for (let i = -s; i < s; i += 24) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + s, s);
      g.stroke();
    }
    g.fillStyle = industrial ? '#2a221d' : '#23272b';
    g.fillRect(0, 0, s, 6);
    g.fillRect(0, 0, 6, s);
    g.fillStyle = industrial ? '#7a5a40' : '#5c636a';
    for (const x of [16, s - 16]) for (const y of [16, s - 16]) g.fillRect(x - 4, y - 4, 8, 8);
  });
}

/** Wear decals: a 4×1 atlas of scuffs / drips / smudges with alpha (clean theme is subtler). */
function wearTexture(theme: Theme): THREE.CanvasTexture {
  return canvasTexture(
    512,
    (g, s) => {
      g.clearRect(0, 0, s, s);
      const industrial = theme === 'industrial';
      const cell = s / 4;
      for (let k = 0; k < 4; k++) {
        g.save();
        g.translate(k * cell, 0);
        g.beginPath();
        g.rect(0, 0, cell, s);
        g.clip();
        if (k === 0) {
          // Scuffs along the bottom (boots, carts, cubes).
          const rnd = stream(31);
          g.strokeStyle = industrial ? 'rgba(30,24,18,0.35)' : 'rgba(40,46,52,0.18)';
          for (let i = 0; i < 40; i++) {
            g.lineWidth = 1 + rnd() * 3;
            const x = rnd() * cell, y = s * (0.6 + rnd() * 0.38);
            g.beginPath();
            g.moveTo(x, y);
            g.lineTo(x + (rnd() - 0.5) * 50, y + (rnd() - 0.5) * 10);
            g.stroke();
          }
        } else if (k === 1) {
          streaks(g, cell, 10, industrial ? '110,70,30' : '90,100,110', industrial ? 0.4 : 0.12, 41);
          g.fillStyle = 'rgba(0,0,0,0)';
        } else if (k === 2) {
          blotches(g, cell, 14, industrial ? '50,40,30' : '70,80,90', industrial ? 0.35 : 0.1, 51, 0.3);
        } else {
          // A grimy band where the wall meets the floor.
          const grad = g.createLinearGradient(0, s * 0.7, 0, s);
          grad.addColorStop(0, 'rgba(30,30,30,0)');
          grad.addColorStop(1, industrial ? 'rgba(30,24,18,0.5)' : 'rgba(40,46,52,0.16)');
          g.fillStyle = grad;
          g.fillRect(0, 0, cell, s);
        }
        g.restore();
      }
    },
    false,
  );
}

const textures = new Map<string, THREE.Texture>();
/** Shared textures (drawn once, flagged shared so chamber disposal leaves them alone). */
function tex(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = textures.get(key);
  if (!t) {
    t = make();
    t.userData.shared = true;
    textures.set(key, t);
  }
  return t;
}

type Kind = 'panel' | 'panelFloor' | 'metal' | 'metalFloor' | 'glass';

function makeMaterial(theme: Theme, kind: Kind): THREE.Material {
  const industrial = theme === 'industrial';
  const panel = tex(`panel-${theme}`, () => panelTexture(theme));
  const metal = tex(`metal-${theme}`, () => metalTexture(theme));
  switch (kind) {
    case 'panel':
      return new THREE.MeshLambertMaterial({ map: panel, color: industrial ? 0xffffff : V.cleanPanelTint });
    case 'metal':
      return new THREE.MeshLambertMaterial({ map: metal });
    case 'panelFloor':
      // Floors get a soft sheen (Phong specular) so lamps leave highlights on them.
      return new THREE.MeshPhongMaterial({
        map: panel,
        color: industrial ? 0xf0ece4 : V.cleanPanelTint,
        specular: industrial ? V.industrialFloorSpecular : V.cleanFloorSpecular,
        shininess: industrial ? V.industrialFloorShininess : V.cleanFloorShininess,
      });
    case 'metalFloor':
      return new THREE.MeshPhongMaterial({ map: metal, specular: industrial ? 0x0c0a08 : 0x2a3036, shininess: industrial ? 8 : 40 });
    case 'glass':
      return new THREE.MeshLambertMaterial({ color: industrial ? 0x9fb6a8 : 0x9fd7ff, transparent: true, opacity: industrial ? 0.3 : 0.22, depthWrite: false });
  }
}

function kindFor(tag: SurfaceTag, face: FaceKey): Kind {
  if (tag === 'glass') return 'glass';
  const floor = face === '+y';
  if (tag === 'portalable') return floor ? 'panelFloor' : 'panel';
  return floor ? 'metalFloor' : 'metal';
}

export interface LevelVisuals {
  group: THREE.Group;
  materials: THREE.Material[];
}

export interface LevelMeshOptions {
  /** Game look: merged face groups and wear decals (the editor leaves it off). */
  dress?: boolean;
}

const FACES: FaceKey[] = ['+x', '-x', '+y', '-y', '+z', '-z'];

export function themeOf(level: LevelData, b?: Brush): Theme {
  return b?.theme ?? level.info?.theme ?? 'clean';
}

export function buildLevelMeshes(level: LevelData, opts: LevelMeshOptions = {}): LevelVisuals {
  const cache = new Map<string, THREE.Material>();
  const material = (theme: Theme, kind: Kind): THREE.Material => {
    const key = `${theme}:${kind}`;
    let m = cache.get(key);
    if (!m) cache.set(key, (m = makeMaterial(theme, kind)));
    return m;
  };

  const group = new THREE.Group();
  for (const b of level.brushes) {
    const theme = themeOf(level, b);
    const size = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
    const geo = new THREE.BoxGeometry(size[0], size[1], size[2]);
    const center = new THREE.Vector3((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    // World-aligned UVs (1 repeat = 2 m) so panels line up across brushes.
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const nor = geo.attributes.normal as THREE.BufferAttribute;
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + center.x, y = pos.getY(i) + center.y, z = pos.getZ(i) + center.z;
      const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i));
      const [u, v] = nx > 0.5 ? [z, y] : ny > 0.5 ? [x, z] : [x, y];
      uv.setXY(i, u / 2, v / 2);
    }
    // BoxGeometry groups are in the order +x, -x, +y, -y, +z, -z.
    const mats = FACES.map((f) => material(theme, kindFor(faceTag(b, f), f)));
    if (opts.dress) mergeGroups(geo, mats);
    const mesh = new THREE.Mesh(geo, mats);
    mesh.position.copy(center);
    mesh.renderOrder = b.tag === 'glass' ? 10 : 0;
    group.add(mesh);
  }

  for (const m of level.markers ?? []) {
    const geo = new THREE.PlaneGeometry(m.size[0], m.size[1]);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: m.color, transparent: true, opacity: 0.55, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(m.position[0], m.position[1] + 0.005, m.position[2]);
    group.add(mesh);
  }

  const materials = [...cache.values()];
  if (opts.dress) {
    for (const d of wearDecals(level)) {
      group.add(d.mesh);
      materials.push(d.material);
    }
  }
  return { group, materials };
}

/**
 * Reorder a box's index buffer so faces sharing a material are contiguous, then keep one group per
 * material: three.js issues one draw call per group, so a plain box costs 6 and a merged one 1–2.
 */
function mergeGroups(geo: THREE.BufferGeometry, mats: THREE.Material[]): void {
  const index = geo.index!;
  const src = Array.from(index.array);
  const groups = geo.groups.slice();
  const order = groups.map((g, i) => ({ g, m: mats.indexOf(mats[g.materialIndex ?? i]) })).sort((p, q) => p.m - q.m);
  const out: number[] = [];
  geo.clearGroups();
  let start = 0;
  let current = -1;
  let count = 0;
  for (const { g, m } of order) {
    if (m !== current && count > 0) {
      geo.addGroup(start, count, current);
      start += count;
      count = 0;
    }
    current = m;
    for (let k = 0; k < g.count; k++) out.push(src[g.start + k]);
    count += g.count;
  }
  if (count > 0) geo.addGroup(start, count, current);
  geo.setIndex(out);
}

/**
 * Procedural wear: a few decals per chamber, placed deterministically (hash of the brush) on wall
 * faces that face into the room — scuffs and a grime band along the floor, streaks and smudges
 * higher up. One InstancedMesh per theme (one draw call).
 */
function wearDecals(level: LevelData): { mesh: THREE.InstancedMesh; material: THREE.Material }[] {
  type Spot = { pos: THREE.Vector3; quat: THREE.Quaternion; w: number; h: number; cell: number };
  const spots = new Map<Theme, Spot[]>();
  const sides: { face: FaceKey; n: THREE.Vector3 }[] = [
    { face: '+x', n: new THREE.Vector3(1, 0, 0) },
    { face: '-x', n: new THREE.Vector3(-1, 0, 0) },
    { face: '+z', n: new THREE.Vector3(0, 0, 1) },
    { face: '-z', n: new THREE.Vector3(0, 0, -1) },
  ];
  level.brushes.forEach((b, i) => {
    const theme = themeOf(level, b);
    const rnd = stream(Math.imul(i + 1, 2654435761) ^ Math.round(b.min[0] * 7 + b.min[2] * 13 + b.min[1] * 5));
    const height = b.max[1] - b.min[1];
    if (height < 1.5) return;
    for (const { face, n } of sides) {
      if (faceTag(b, face) === 'glass') continue;
      const along = n.x !== 0 ? b.max[2] - b.min[2] : b.max[0] - b.min[0];
      if (along < 1.6 || rnd() > (theme === 'industrial' ? V.wearChanceIndustrial : V.wearChanceClean)) continue;
      const w = Math.min(along - 0.2, 1.2 + rnd() * 2.2);
      const t = (rnd() - 0.5) * (along - w);
      const low = rnd() < 0.6;
      const h = low ? 0.5 + rnd() * 0.4 : 1 + rnd() * 1.5;
      const y = low ? b.min[1] + h / 2 + 0.01 : Math.min(b.max[1] - h / 2 - 0.1, b.min[1] + 1.4 + rnd() * 2);
      const c = new THREE.Vector3((b.min[0] + b.max[0]) / 2, y, (b.min[2] + b.max[2]) / 2);
      const off = V.wearOffset;
      if (n.x !== 0) c.set(n.x > 0 ? b.max[0] + off : b.min[0] - off, y, c.z + t);
      else c.set(c.x + t, y, n.z > 0 ? b.max[2] + off : b.min[2] - off);
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      const cell = low ? (rnd() < 0.5 ? 0 : 3) : rnd() < 0.5 ? 1 : 2;
      const list = spots.get(theme) ?? [];
      list.push({ pos: c, quat, w, h, cell });
      spots.set(theme, list);
    }
  });
  const out: { mesh: THREE.InstancedMesh; material: THREE.Material }[] = [];
  for (const [theme, list] of spots) {
    // Per-instance atlas cell via a UV offset attribute.
    const geo = new THREE.PlaneGeometry(1, 1);
    const cells = new Float32Array(list.length);
    list.forEach((s, k) => (cells[k] = s.cell));
    geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 1));
    const material = new THREE.MeshLambertMaterial({
      map: tex(`wear-${theme}`, () => wearTexture(theme)),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aCell;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv.x = (vMapUv.x + aCell) * 0.25;\n#endif');
    };
    const mesh = new THREE.InstancedMesh(geo, material, list.length);
    const m = new THREE.Matrix4();
    list.forEach((s, k) => mesh.setMatrixAt(k, m.compose(s.pos, s.quat, new THREE.Vector3(s.w, s.h, 1))));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.renderOrder = 1;
    mesh.userData.wear = true;
    out.push({ mesh, material });
  }
  return out;
}

/** The scene's fixed lights (named so a chamber can set their mood). */
export function addLights(scene: THREE.Scene): void {
  const hemi = new THREE.HemisphereLight(0xf4f8ff, 0x50565c, V.clean.hemi);
  hemi.name = 'hemi';
  const sun = new THREE.DirectionalLight(0xffffff, V.clean.key);
  sun.name = 'key';
  sun.position.set(0.4, 1, 0.25);
  const fill = new THREE.DirectionalLight(0xc8dcff, V.clean.fill);
  fill.name = 'fill';
  fill.position.set(-0.5, 0.3, -0.8);
  scene.add(hemi, sun, fill);
}

/** Light the scene for a theme: practicals are bright and cool, the service levels dim and warm. */
export function applyAmbience(scene: THREE.Scene, theme: Theme): void {
  const L = theme === 'industrial' ? V.industrial : V.clean;
  const hemi = scene.getObjectByName('hemi') as THREE.HemisphereLight | undefined;
  const key = scene.getObjectByName('key') as THREE.DirectionalLight | undefined;
  const fill = scene.getObjectByName('fill') as THREE.DirectionalLight | undefined;
  if (hemi) {
    hemi.intensity = L.hemi;
    hemi.color.setHex(L.sky);
    hemi.groundColor.setHex(L.ground);
  }
  if (key) {
    key.intensity = L.key;
    key.color.setHex(L.keyColor);
  }
  if (fill) fill.intensity = L.fill;
}
