// The puzzle maker's 3D preview (plain three.js, its own renderer and canvas): brushes drawn by the
// game's own render/levelMeshes.ts (read-only reuse), entity markers with labels, trigger and
// checkpoint boxes, wires as lines, the spawn arrow, a 0.5 m grid on the work plane, the selection
// outline, and picking. Orbit camera: right-drag rotates, middle-drag / Shift+right pans, wheel zooms.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { FaceKey, LevelData, Vec3 } from '../levels/level';
import { addLights, buildLevelMeshes } from '../render/levelMeshes';
import { CATALOG } from './catalog';
import type { Selection } from './doc';

export interface Pick {
  kind: 'brush' | 'entity' | 'trigger' | 'checkpoint' | 'spawn' | 'ground';
  index?: number;
  id?: string;
  point: THREE.Vector3;
  normal?: THREE.Vector3;
  face?: FaceKey;
}

const FACE_ORDER: FaceKey[] = ['+x', '-x', '+y', '-y', '+z', '-z'];

function label(text: string, color = '#ffffff'): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 48;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(15,18,22,0.75)';
  g.fillRect(0, 0, 256, 48);
  g.fillStyle = color;
  g.font = '26px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text.length > 18 ? text.slice(0, 17) + '…' : text, 128, 25);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(1.6, 0.3, 1);
  s.renderOrder = 20;
  return s;
}

export class EditorView {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
  readonly controls: OrbitControls;
  private levelGroup = new THREE.Group();
  private overlay = new THREE.Group();
  private grid: THREE.GridHelper;
  private brushMeshes: THREE.Mesh[] = [];
  private pickables: THREE.Object3D[] = [];
  private raycaster = new THREE.Raycaster();
  /** Height of the work plane (new brushes start here; clicks on empty space land here). */
  workY = 0;
  /** A preview box while dragging out a brush / trigger. */
  private ghost: THREE.Mesh;
  private running = false;
  private disposables: { dispose(): void }[] = [];

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'editorCanvas';
    parent.appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x1b1f24);
    addLights(this.scene);
    this.scene.add(this.levelGroup, this.overlay);
    this.grid = new THREE.GridHelper(80, 160, 0x4c6a85, 0x2f3a45);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.55;
    this.scene.add(this.grid);
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x7fd1ff, transparent: true, opacity: 0.3, depthWrite: false }));
    this.ghost.visible = false;
    this.scene.add(this.ghost);
    this.camera.position.set(14, 16, 20);
    this.controls = new OrbitControls(this.camera, this.canvas);
    // Left button belongs to the tools.
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE } as unknown as OrbitControls['mouseButtons'];
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    new ResizeObserver(() => this.resize()).observe(parent);
  }

  resize(): void {
    const r = this.canvas.parentElement!.getBoundingClientRect();
    const w = Math.max(1, Math.floor(r.width)), hgt = Math.max(1, Math.floor(r.height));
    this.renderer.setSize(w, hgt, false);
    this.camera.aspect = w / hgt;
    this.camera.updateProjectionMatrix();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.resize();
    const loop = () => {
      if (!this.running) return;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
  }

  setWorkY(y: number): void {
    this.workY = y;
    this.grid.position.y = y + 0.002;
  }

  /** Rebuild everything from the level (cheap for hand-made chambers). */
  rebuild(level: LevelData, sel: Selection, wireFrom: string | null): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.levelGroup.clear();
    this.overlay.clear();
    this.pickables = [];

    const vis = buildLevelMeshes(level);
    this.levelGroup.add(vis.group);
    for (const m of vis.materials) {
      this.disposables.push(m);
      const map = (m as THREE.MeshLambertMaterial).map;
      if (map) this.disposables.push(map);
    }
    this.brushMeshes = vis.group.children.slice(0, level.brushes.length) as THREE.Mesh[];
    this.brushMeshes.forEach((m, i) => {
      m.userData.pick = { kind: 'brush', index: i };
      this.pickables.push(m);
      this.disposables.push(m.geometry);
    });

    // Entities: coloured boxes with a label above.
    const byId = new Map<string, THREE.Vector3>();
    for (const e of level.entities ?? []) {
      const info = CATALOG[e.type];
      const geo = new THREE.BoxGeometry(...info.size);
      const mat = new THREE.MeshLambertMaterial({ color: info.color, emissive: info.color, emissiveIntensity: 0.25 });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(e.position[0], e.position[1] + info.size[1] / 2, e.position[2]);
      m.rotation.y = e.yaw ?? 0;
      m.userData.pick = { kind: 'entity', id: e.id };
      this.overlay.add(m);
      this.pickables.push(m);
      this.disposables.push(geo, mat);
      const l = label(e.id, wireFrom === e.id ? '#ffd166' : '#ffffff');
      l.position.set(e.position[0], e.position[1] + info.size[1] + 0.35, e.position[2]);
      this.overlay.add(l);
      byId.set(e.id, m.position.clone());
    }

    // Wires: a line from output to input, coloured from amber (source) to green (target).
    for (const w of level.wiring ?? []) {
      const a = byId.get(w.from.split('.')[0]), b = byId.get(w.to.split('.')[0]);
      if (!a || !b) continue;
      const mid = a.clone().lerp(b, 0.5).setY(Math.max(a.y, b.y) + 1.2);
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(24));
      const cols: number[] = [];
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        cols.push(1 - t * 0.8, 0.65 + t * 0.2, 0.1 + t * 0.35);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      const mat = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false });
      const line = new THREE.Line(geo, mat);
      line.renderOrder = 15;
      this.overlay.add(line);
      this.disposables.push(geo, mat);
    }

    // Triggers (violet) and checkpoints (green): translucent boxes.
    const boxMesh = (min: Vec3, max: Vec3, color: number, pick: object) => {
      const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]] as const;
      const geo = new THREE.BoxGeometry(...size);
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false });
      const m = new THREE.Mesh(geo, mat);
      m.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
      m.userData.pick = pick;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color }));
      m.add(edges);
      this.overlay.add(m);
      this.pickables.push(m);
      this.disposables.push(geo, mat, edges.geometry, edges.material as THREE.Material);
      return m;
    };
    for (const t of level.triggers ?? []) {
      boxMesh(t.min, t.max, 0xb084f5, { kind: 'trigger', id: t.id });
      const l = label(`⚑ ${t.event}`, '#d7c2ff');
      l.position.set((t.min[0] + t.max[0]) / 2, t.max[1] + 0.3, (t.min[2] + t.max[2]) / 2);
      this.overlay.add(l);
    }
    for (const c of level.checkpoints ?? []) {
      boxMesh(c.min, c.max, 0x37d67a, { kind: 'checkpoint', id: c.id });
      this.overlay.add(this.arrow(c.spawn.position, c.spawn.yaw, 0x37d67a, null));
    }

    // Spawn: an arrow showing where you start and which way you face.
    this.overlay.add(this.arrow(level.spawn.position, level.spawn.yaw, 0xffffff, { kind: 'spawn' }));

    // Selection outline.
    const selObj = this.selectedObject(level, sel);
    if (selObj) {
      const helper = new THREE.BoxHelper(selObj, 0xffd166);
      (helper.material as THREE.LineBasicMaterial).depthTest = false;
      helper.renderOrder = 30;
      this.overlay.add(helper);
      this.disposables.push(helper.geometry, helper.material as THREE.Material);
    }
  }

  private arrow(p: Vec3, yaw: number, color: number, pick: object | null): THREE.Object3D {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.8, 12), new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.6 }));
    body.position.y = 0.9;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.6, 12), new THREE.MeshLambertMaterial({ color }));
    head.rotation.x = -Math.PI / 2;
    head.position.set(0, 1.6, -0.45);
    g.add(body, head);
    g.position.set(...p);
    g.rotation.y = yaw;
    if (pick) {
      body.userData.pick = pick;
      this.pickables.push(body);
    }
    for (const m of [body, head]) this.disposables.push(m.geometry, m.material as THREE.Material);
    return g;
  }

  private selectedObject(_level: LevelData, sel: Selection): THREE.Object3D | null {
    if (!sel) return null;
    if (sel.kind === 'brush') return this.brushMeshes[sel.index] ?? null;
    return this.pickables.find((o) => {
      const p = o.userData.pick as { kind: string; id?: string };
      return p.kind === sel.kind && (sel.kind === 'spawn' || p.id === (sel as { id: string }).id);
    }) ?? null;
  }

  private ray(ev: { clientX: number; clientY: number }): void {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
  }

  /** What's under the mouse: the nearest object, else the work plane. */
  pick(ev: { clientX: number; clientY: number }, kinds?: Pick['kind'][]): Pick | null {
    this.ray(ev);
    const hits = this.raycaster.intersectObjects(this.pickables, false);
    for (const hit of hits) {
      const p = hit.object.userData.pick as { kind: Pick['kind']; index?: number; id?: string };
      if (kinds && !kinds.includes(p.kind)) continue;
      const out: Pick = { ...p, point: hit.point.clone() };
      if (hit.face) {
        out.normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).round();
        if (p.kind === 'brush' && hit.face.materialIndex !== undefined) out.face = FACE_ORDER[hit.face.materialIndex];
      }
      return out;
    }
    if (kinds && !kinds.includes('ground')) return null;
    const pt = this.planePoint(ev, this.workY);
    return pt ? { kind: 'ground', point: pt } : null;
  }

  /** Where the mouse ray meets the horizontal plane y = planeY. */
  planePoint(ev: { clientX: number; clientY: number }, planeY: number): THREE.Vector3 | null {
    this.ray(ev);
    const out = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY), out);
  }

  showGhost(min: Vec3 | null, max?: Vec3): void {
    if (!min || !max) {
      this.ghost.visible = false;
      return;
    }
    this.ghost.visible = true;
    this.ghost.scale.set(Math.max(0.01, max[0] - min[0]), Math.max(0.01, max[1] - min[1]), Math.max(0.01, max[2] - min[2]));
    this.ghost.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  }

  /** Frame the whole level. */
  frame(level: LevelData): void {
    const box = new THREE.Box3();
    for (const b of level.brushes) box.expandByPoint(new THREE.Vector3(...b.min)).expandByPoint(new THREE.Vector3(...b.max));
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    this.controls.target.copy(c);
    this.camera.position.copy(c).add(new THREE.Vector3(0.6, 0.75, 0.9).normalize().multiplyScalar(size * 0.9));
    this.controls.update();
  }
}
