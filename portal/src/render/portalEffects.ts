// What a portal looks like: an animated rim in its colour, a swirling "closed" surface while the
// other end doesn't exist, the invisible box used to cut the window into the stencil buffer, and
// the fizzle burst when a shot can't make a portal.
import * as THREE from 'three';
import { CONFIG, type PortalId } from '../core/config';
import type { Portal } from '../portals/portals';

const W = CONFIG.portal.width;
const H = CONFIG.portal.height;

/** The opening's outline: a rounded rectangle centred on the origin. */
export function openingShape(w: number = W, h: number = H, r: number = CONFIG.portal.cornerRadius): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Closed prism from z = +offset (just in front of the surface) back to z = -depth. */
export function stencilBoxGeometry(): THREE.BufferGeometry {
  const depth = CONFIG.portal.tunnelDepth;
  const g = new THREE.ExtrudeGeometry(openingShape(), { depth: depth + CONFIG.portal.surfaceOffset, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -depth);
  return g;
}

const RIM_VERT = /* glsl */ `
varying vec2 vPos;
void main() {
  vPos = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const RIM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
varying vec2 vPos;
void main() {
  float a = atan(vPos.y, vPos.x);
  float pulse = 0.75 + 0.25 * sin(a * 6.0 - uTime * 5.0);
  gl_FragColor = vec4(uColor * (0.9 + 0.6 * pulse), 1.0);
}`;

const CLOSED_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
varying vec2 vPos;
void main() {
  vec2 p = vPos * vec2(1.0, 0.6);
  float r = length(p);
  float a = atan(p.y, p.x);
  float swirl = sin(r * 18.0 - uTime * 4.0 + a * 2.0);
  float v = 0.35 + 0.25 * swirl + 0.4 * smoothstep(0.2, 0.75, r);
  gl_FragColor = vec4(uColor * v, 1.0);
}`;

export class PortalVisual {
  readonly group = new THREE.Group();
  readonly rim: THREE.Mesh;
  readonly closed: THREE.Mesh;
  private readonly uniforms: { uColor: { value: THREE.Color }; uTime: { value: number } };

  constructor(readonly id: PortalId) {
    this.uniforms = { uColor: { value: new THREE.Color(CONFIG.portal.colors[id]) }, uTime: { value: 0 } };
    const ring = openingShape(W + 0.16, H + 0.16, CONFIG.portal.cornerRadius + 0.08);
    ring.holes.push(openingShape());
    this.rim = new THREE.Mesh(
      new THREE.ShapeGeometry(ring, 8),
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: RIM_VERT, fragmentShader: RIM_FRAG }),
    );
    this.rim.position.z = CONFIG.portal.surfaceOffset + 0.003;
    this.closed = new THREE.Mesh(
      new THREE.ShapeGeometry(openingShape(), 8),
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: RIM_VERT, fragmentShader: CLOSED_FRAG }),
    );
    this.closed.position.z = CONFIG.portal.surfaceOffset;
    this.group.add(this.rim, this.closed);
    this.group.visible = false;
  }

  update(portal: Portal | null, linked: boolean, time: number): void {
    this.uniforms.uTime.value = time;
    this.group.visible = !!portal;
    if (!portal) return;
    this.group.position.copy(portal.position);
    this.group.quaternion.copy(portal.quaternion);
    this.closed.visible = !linked;
  }

  setColor(hex: number): void {
    this.uniforms.uColor.value.setHex(hex);
  }
}

/** A short burst at the spot a shot failed: an expanding, fading ring plus a flash. */
export class Fizzles {
  readonly group = new THREE.Group();
  private items: { mesh: THREE.Mesh; age: number }[] = [];

  spawn(point: THREE.Vector3, normal: THREE.Vector3, color: number): void {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.12, 24), mat);
    mesh.position.copy(point).addScaledVector(normal, 0.02);
    mesh.lookAt(point.clone().add(normal));
    this.group.add(mesh);
    this.items.push({ mesh, age: 0 });
  }

  update(dt: number): void {
    for (const it of this.items) {
      it.age += dt;
      const t = it.age / 0.45;
      it.mesh.scale.setScalar(1 + t * 5);
      (it.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - t);
    }
    this.items = this.items.filter((it) => {
      if (it.age < 0.45) return true;
      this.group.remove(it.mesh);
      it.mesh.geometry.dispose();
      (it.mesh.material as THREE.Material).dispose();
      return false;
    });
  }

  get count(): number {
    return this.items.length;
  }
}
