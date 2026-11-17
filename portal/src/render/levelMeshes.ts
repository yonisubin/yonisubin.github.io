// Level brushes → meshes. Visual language (spec): portalable = bright white matte panels,
// non-portalable = dark metal, glass = see-through. Textures are drawn on canvases in code.
import * as THREE from 'three';
import type { FaceKey, LevelData, SurfaceTag } from '../levels/level';
import { faceTag } from '../levels/level';

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Deterministic noise so textures look the same on every load. */
function speckle(g: CanvasRenderingContext2D, s: number, count: number, alpha: number, seed: number): void {
  let x = seed;
  const rnd = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < count; i++) {
    const v = Math.floor(rnd() * 255);
    g.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    g.fillRect(rnd() * s, rnd() * s, 1 + rnd() * 2, 1 + rnd() * 2);
  }
}

/** One texture repeat = 2 m: 2×2 white panels with thin dark seams. */
function panelTexture(): THREE.CanvasTexture {
  return canvasTexture(512, (g, s) => {
    g.fillStyle = '#e9ebec';
    g.fillRect(0, 0, s, s);
    speckle(g, s, 6000, 0.05, 7);
    g.fillStyle = '#9aa1a6';
    const h = s / 2;
    for (const o of [0, h]) {
      g.fillRect(o, 0, 3, s);
      g.fillRect(0, o, s, 3);
    }
    g.fillStyle = 'rgba(255,255,255,0.6)';
    for (const o of [0, h]) {
      g.fillRect(o + 3, 0, 1, s);
      g.fillRect(0, o + 3, s, 1);
    }
  });
}

/** One repeat = 2 m: dark plate metal with a cross-hatched tread and rivets. */
function metalTexture(): THREE.CanvasTexture {
  return canvasTexture(512, (g, s) => {
    g.fillStyle = '#3a3f45';
    g.fillRect(0, 0, s, s);
    speckle(g, s, 9000, 0.08, 3);
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 2;
    for (let i = -s; i < s; i += 24) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + s, s);
      g.stroke();
    }
    g.fillStyle = '#23272b';
    g.fillRect(0, 0, s, 6);
    g.fillRect(0, 0, 6, s);
    g.fillStyle = '#5c636a';
    for (const x of [16, s - 16]) for (const y of [16, s - 16]) g.fillRect(x - 4, y - 4, 8, 8);
  });
}

export interface LevelVisuals {
  group: THREE.Group;
  materials: THREE.Material[];
}

export function buildLevelMeshes(level: LevelData): LevelVisuals {
  const panel = new THREE.MeshLambertMaterial({ map: panelTexture() });
  const metal = new THREE.MeshLambertMaterial({ map: metalTexture() });
  const glass = new THREE.MeshLambertMaterial({ color: 0x9fd7ff, transparent: true, opacity: 0.22, depthWrite: false });
  const byTag: Record<SurfaceTag, THREE.Material> = { portalable: panel, metal, glass };

  const faces: FaceKey[] = ['+x', '-x', '+y', '-y', '+z', '-z'];
  const group = new THREE.Group();
  for (const b of level.brushes) {
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
    const mats = faces.map((f) => byTag[faceTag(b, f)]);
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

  return { group, materials: [panel, metal, glass] };
}

export function addLights(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0xf4f8ff, 0x50565c, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(0.4, 1, 0.25);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xc8dcff, 0.45);
  fill.position.set(-0.5, 0.3, -0.8);
  scene.add(fill);
}
