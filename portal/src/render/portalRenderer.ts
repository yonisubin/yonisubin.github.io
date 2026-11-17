// Recursive stencil portal rendering.
//
// For each open portal P the main camera can see, we:
//   1. mark P's window in the stencil buffer (stencil == level → level+1), no colour/depth;
//   2. render the world from a virtual camera = M · camera (M = P → other end), restricted to that
//      stencil value, with an oblique near plane on the exit surface so nothing behind the exit
//      wall leaks in; inside, portals are handled the same way one level deeper (up to the
//      configured depth; at the limit the window is filled with a flat colour);
//   3. unmark the window (level+1 → level).
// Then, for this level: clear depth, write the portals' depth, and draw the world where
// stencil == level. Things in front of a portal draw over it; the wall behind it doesn't.
//
// No flash when walking through: the window is drawn as the inside of a box that reaches back
// behind the surface (back faces only). Seen from in front, it covers exactly the opening; when the
// camera's near plane cuts the front, the box's inner walls still cover the screen. Its depth is
// computed in the shader as the depth of the portal's front plane along each pixel's ray, so the
// box never hides things that are in front of the opening.
import * as THREE from 'three';
import { CONFIG } from '../core/config';
import type { Portal, PortalSystem } from '../portals/portals';
import { teleportMatrix } from '../portals/transform';
import { stencilBoxGeometry } from './portalEffects';

const DEPTH_VERT = /* glsl */ `
varying vec3 vView;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

// Depth of the portal plane (uPlane, view space: n·x + d = 0) along this pixel's view ray.
const DEPTH_FRAG = /* glsl */ `
uniform vec4 uPlane;
uniform mat4 uProj;
uniform vec3 uColor;
varying vec3 vView;
void main() {
  float denom = dot(uPlane.xyz, vView);
  float depth = 0.0;
  if (denom < -1e-6) {
    vec3 p = vView * (-uPlane.w / denom);
    vec4 clip = uProj * vec4(p, 1.0);
    float ndc = clip.z / clip.w;
    depth = ndc < -1.0 ? 0.0 : clamp(ndc * 0.5 + 0.5, 0.0, 1.0);
  }
  gl_FragDepth = depth;
  gl_FragColor = vec4(uColor, 1.0);
}`;

export interface RenderStats {
  /** World renders this frame (1 + one per portal window drawn). */
  views: number;
  maxLevel: number;
}

export class PortalRenderer {
  recursionDepth: number = CONFIG.portal.recursionDepth;
  readonly stats: RenderStats = { views: 0, maxLevel: 0 };

  private readonly passScene = new THREE.Scene();
  private readonly box: THREE.Mesh;
  private readonly markMat: THREE.MeshBasicMaterial;
  private readonly unmarkMat: THREE.MeshBasicMaterial;
  private readonly depthMat: THREE.ShaderMaterial;
  private readonly flatMat: THREE.ShaderMaterial;
  private readonly cams: THREE.PerspectiveCamera[] = [];
  private readonly baseProj = new THREE.Matrix4();
  private readonly frustum = new THREE.Frustum();
  private sceneMaterials: THREE.Material[] = [];

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly portals: PortalSystem,
  ) {
    const stencilBase = {
      colorWrite: false,
      depthWrite: false,
      depthTest: false,
      side: THREE.BackSide,
      stencilWrite: true,
      stencilFunc: THREE.EqualStencilFunc,
      stencilFail: THREE.KeepStencilOp,
      stencilZFail: THREE.KeepStencilOp,
    } as const;
    this.markMat = new THREE.MeshBasicMaterial({ ...stencilBase, stencilZPass: THREE.IncrementStencilOp });
    this.unmarkMat = new THREE.MeshBasicMaterial({ ...stencilBase, stencilZPass: THREE.DecrementStencilOp });
    const depthParams = (colorWrite: boolean): THREE.ShaderMaterialParameters => ({
      uniforms: { uPlane: { value: new THREE.Vector4() }, uProj: { value: new THREE.Matrix4() }, uColor: { value: new THREE.Color() } },
      vertexShader: DEPTH_VERT,
      fragmentShader: DEPTH_FRAG,
      colorWrite,
      depthWrite: true,
      depthTest: true,
      side: THREE.BackSide,
      stencilWrite: true,
      stencilFunc: THREE.EqualStencilFunc,
      stencilFail: THREE.KeepStencilOp,
      stencilZFail: THREE.KeepStencilOp,
      stencilZPass: THREE.KeepStencilOp,
    });
    this.depthMat = new THREE.ShaderMaterial(depthParams(false));
    this.flatMat = new THREE.ShaderMaterial(depthParams(true));
    this.box = new THREE.Mesh(stencilBoxGeometry(), this.markMat);
    this.box.matrixAutoUpdate = false;
    this.box.frustumCulled = false;
    this.passScene.add(this.box);
  }

  render(camera: THREE.PerspectiveCamera): void {
    const r = this.renderer;
    r.autoClear = false;
    r.setRenderTarget(null);
    this.unmaskBuffers();
    r.clear(true, true, true);
    this.collectSceneMaterials();
    camera.updateMatrixWorld();
    this.baseProj.copy(camera.projectionMatrix);
    this.stats.views = 0;
    this.stats.maxLevel = 0;
    this.renderLevel(camera, 0, null);
  }

  private renderLevel(cam: THREE.PerspectiveCamera, level: number, exit: Portal | null): void {
    this.stats.maxLevel = Math.max(this.stats.maxLevel, level);
    const visible = this.visiblePortals(cam, exit);
    if (level < this.recursionDepth) {
      for (const p of visible) {
        const dest = this.portals.other(p.id)!;
        this.drawBox(p, cam, this.markMat, level);
        this.renderLevel(this.virtualCamera(level + 1, cam, p, dest), level + 1, dest);
        this.drawBox(p, cam, this.unmarkMat, level + 1);
      }
    }
    this.unmaskBuffers();
    this.renderer.clearDepth();
    for (const p of visible) {
      const mat = level < this.recursionDepth ? this.depthMat : this.flatMat;
      if (mat === this.flatMat) mat.uniforms.uColor.value.setHex(CONFIG.portal.colors[this.portals.other(p.id)!.id]).multiplyScalar(0.5);
      this.drawBox(p, cam, mat, level);
    }
    this.setSceneStencil(level);
    this.renderer.render(this.scene, cam);
    this.stats.views++;
  }

  /** Open portals in front of `cam` and inside its view, farthest first (nearer ones overwrite). */
  private visiblePortals(cam: THREE.PerspectiveCamera, exit: Portal | null): Portal[] {
    if (!this.portals.linked()) return [];
    const camPos = cam.position;
    this.frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(this.baseProj, cam.matrixWorldInverse));
    const radius = Math.hypot(CONFIG.portal.width, CONFIG.portal.height) / 2;
    const sphere = new THREE.Sphere();
    const out: Portal[] = [];
    for (const p of [this.portals.a!, this.portals.b!]) {
      if (p === exit) continue;
      if (p.normal.dot(camPos.clone().sub(p.position)) <= 1e-5) continue;
      if (exit && exit.normal.dot(p.position.clone().sub(exit.position)) < -radius) continue;
      if (!this.frustum.intersectsSphere(sphere.set(p.position, radius))) continue;
      out.push(p);
    }
    out.sort((x, y) => y.position.distanceToSquared(camPos) - x.position.distanceToSquared(camPos));
    return out;
  }

  private virtualCamera(level: number, cam: THREE.PerspectiveCamera, from: Portal, to: Portal): THREE.PerspectiveCamera {
    let vc = this.cams[level];
    if (!vc) vc = this.cams[level] = new THREE.PerspectiveCamera();
    const m = teleportMatrix(from, to).multiply(cam.matrixWorld);
    m.decompose(vc.position, vc.quaternion, vc.scale);
    vc.scale.set(1, 1, 1);
    vc.updateMatrixWorld(true);
    vc.near = cam.near;
    vc.far = cam.far;
    vc.projectionMatrix.copy(this.baseProj);

    // Oblique near plane on the exit surface (Lengyel's method, as in three's Reflector).
    const n = to.normal;
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, to.position.clone().addScaledVector(n, CONFIG.portal.clipOffset));
    const camDist = plane.distanceToPoint(vc.position);
    // Only when the camera is clearly behind the exit plane: right at the plane the oblique frustum
    // degenerates, and the plain near plane is fine there.
    if (camDist < -0.05) {
      plane.applyMatrix4(vc.matrixWorldInverse);
      const c = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
      const e = vc.projectionMatrix.elements;
      const q = new THREE.Vector4(
        (Math.sign(c.x) + e[8]) / e[0],
        (Math.sign(c.y) + e[9]) / e[5],
        -1,
        (1 + e[10]) / e[14],
      );
      c.multiplyScalar(2 / c.dot(q));
      e[2] = c.x;
      e[6] = c.y;
      e[10] = c.z + 1;
      e[14] = c.w;
    }
    vc.projectionMatrixInverse.copy(vc.projectionMatrix).invert();
    return vc;
  }

  private drawBox(p: Portal, cam: THREE.PerspectiveCamera, mat: THREE.Material, stencilRef: number): void {
    this.box.material = mat;
    this.box.matrix.compose(p.position, p.quaternion, new THREE.Vector3(1, 1, 1));
    this.box.matrixWorld.copy(this.box.matrix);
    mat.stencilRef = stencilRef;
    if (mat instanceof THREE.ShaderMaterial) {
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        p.normal,
        p.position.clone().addScaledVector(p.normal, CONFIG.portal.surfaceOffset),
      );
      plane.applyMatrix4(cam.matrixWorldInverse);
      mat.uniforms.uPlane.value.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
      mat.uniforms.uProj.value.copy(cam.projectionMatrix);
    }
    this.renderer.render(this.passScene, cam);
  }

  /** gl.clear obeys the write masks, and three's clear() doesn't reset them: after a pass with
   *  depthWrite/colorWrite off, a clear would silently do nothing. */
  private unmaskBuffers(): void {
    const b = this.renderer.state.buffers;
    b.depth.setMask(true);
    b.color.setMask(true);
  }

  private collectSceneMaterials(): void {
    const mats = new Set<THREE.Material>();
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const x of Array.isArray(m) ? m : [m]) mats.add(x);
    });
    this.sceneMaterials = [...mats];
    for (const m of this.sceneMaterials) {
      m.stencilWrite = true;
      m.stencilFunc = THREE.EqualStencilFunc;
      m.stencilFail = THREE.KeepStencilOp;
      m.stencilZFail = THREE.KeepStencilOp;
      m.stencilZPass = THREE.KeepStencilOp;
    }
  }

  private setSceneStencil(level: number): void {
    for (const m of this.sceneMaterials) m.stencilRef = level;
  }
}
