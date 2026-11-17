// Field hazards: the emancipation grill (erases the player's portals when they walk through it,
// dissolves any object that enters it, lets portal shots and pellets pass) and toxic liquid
// (instant death). Bottomless pits are handled by the chamber (kill height).
import * as THREE from 'three';
import { CONFIG } from '../core/config';
import type { ChamberContext } from '../game/context';
import type { Entity } from '../levels/level';
import { MAT } from '../render/models';
import { BaseElement } from './base';
import { PhysProp } from './prop';

const FIELD_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const GRILL_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform float uOn;
varying vec2 vUv;
void main() {
  float bands = 0.5 + 0.5 * sin((vUv.x * 18.0 + vUv.y * 4.0) - uTime * 3.0);
  float shimmer = 0.5 + 0.5 * sin(vUv.y * 60.0 + uTime * 9.0);
  float a = uOn * (0.12 + 0.18 * bands + 0.06 * shimmer);
  gl_FragColor = vec4(uColor, a);
}`;

const LIQUID_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform float uStripes;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 12.0;
  float w = sin(p.x + uTime * 1.3) * 0.5 + sin(p.y * 1.3 - uTime) * 0.5;
  vec3 c = uColor * (0.75 + 0.2 * w);
  if (uStripes > 0.5 && fract((vUv.x + vUv.y) * 6.0) < 0.5) c *= 0.35;
  gl_FragColor = vec4(c, 0.92);
}`;

/** props.size [w, h], props.normal (default +Z rotated by yaw). Input: active (default true). */
export class Grill extends BaseElement {
  private readonly uniforms = { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x8fd8ff) }, uOn: { value: 1 } };
  private readonly frame: THREE.Quaternion;
  private playerSide = 0;
  private t = 0;
  /** Times the player's portals were erased here (tests). */
  erased = 0;

  constructor(ctx: ChamberContext, entity: Entity) {
    super(ctx, entity);
    const [w, h] = this.size();
    const n = this.normal();
    this.frame = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    const field = this.add(
      new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: FIELD_VERT, fragmentShader: GRILL_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
      ),
    );
    field.position.copy(this.origin());
    field.quaternion.copy(this.frame);
    field.renderOrder = 5;
    // Emitter strips along both vertical edges.
    for (const side of [-1, 1]) {
      const post = this.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, h, 0.2), MAT.dark()));
      post.position.copy(this.origin()).add(new THREE.Vector3((side * w) / 2, 0, 0).applyQuaternion(this.frame));
      post.quaternion.copy(this.frame);
    }
    this.playerSide = Math.sign(this.local(ctx.player.position).z) || 1;
  }

  private size(): [number, number] {
    return this.prop<[number, number]>('size', [3, 3]);
  }

  private normal(): THREE.Vector3 {
    return (this.entity.props?.normal ? this.vec('normal', [0, 0, 1]) : new THREE.Vector3(Math.sin(this.yaw()), 0, Math.cos(this.yaw()))).normalize();
  }

  private local(p: THREE.Vector3): THREE.Vector3 {
    return p.clone().sub(this.origin()).applyQuaternion(this.frame.clone().invert());
  }

  private inRect(l: THREE.Vector3, margin = 0): boolean {
    const [w, h] = this.size();
    return Math.abs(l.x) <= w / 2 + margin && Math.abs(l.y) <= h / 2 + margin;
  }

  update(dt: number): void {
    this.t += dt;
    const on = this.input('active', true);
    this.uniforms.uTime.value = this.t;
    this.uniforms.uOn.value = on ? 1 : 0;
    const pl = this.ctx.player;
    const l = this.local(pl.position);
    const side = Math.sign(l.z) || this.playerSide;
    if (on && side !== this.playerSide && this.inRect(l, CONFIG.player.radius)) this.playerPassed();
    this.playerSide = side;
    if (!on) return;
    // Any prop whose centre is inside the field is dissolved (carried ones too).
    const half = CONFIG.hazards.grillThickness / 2;
    for (const el of this.ctx.elements.values()) {
      if (!(el instanceof PhysProp) || !el.alive || !el.body) continue;
      const pl2 = this.local(el.position());
      if (Math.abs(pl2.z) < half + el.radius * 0.5 && this.inRect(pl2)) el.dissolve();
    }
  }

  private playerPassed(): void {
    const held = this.ctx.heldId();
    if (held) {
      const el = this.ctx.elements.get(held);
      if (el instanceof PhysProp) el.dissolve();
    }
    if (this.ctx.portals.clearDevice()) {
      this.erased++;
      this.ctx.events.emit('fizzled', { what: 'portals' });
      this.ctx.sfx('portalsErased', 'Portals erased');
    }
  }

  snapshot(): unknown {
    return { ...(super.snapshot() as object), side: this.playerSide, t: this.t };
  }

  restore(state: unknown): void {
    super.restore(state);
    const s = state as { side: number; t: number };
    this.playerSide = s.side;
    this.t = s.t;
  }
}

/** Toxic liquid: props.size [x, depth, z]; the entity position is the centre of the surface. */
export class Liquid extends BaseElement {
  private readonly uniforms = { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x7bd34a) }, uStripes: { value: 0 } };
  private t = 0;

  constructor(ctx: ChamberContext, entity: Entity) {
    super(ctx, entity);
    const [x, , z] = this.size();
    const surface = this.add(
      new THREE.Mesh(new THREE.PlaneGeometry(x, z), new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: FIELD_VERT, fragmentShader: LIQUID_FRAG, transparent: true })),
    );
    surface.rotation.x = -Math.PI / 2;
    surface.position.copy(this.origin());
  }

  private size(): [number, number, number] {
    return this.prop<[number, number, number]>('size', [4, 1, 4]);
  }

  /** Is the point inside the liquid volume? */
  contains(p: THREE.Vector3): boolean {
    const [x, d, z] = this.size();
    const o = this.origin();
    return Math.abs(p.x - o.x) <= x / 2 && Math.abs(p.z - o.z) <= z / 2 && p.y <= o.y && p.y >= o.y - d - 50;
  }

  update(dt: number): void {
    this.t += dt;
    this.uniforms.uTime.value = this.t;
    const hc = this.ctx.settings.highContrastHazards;
    this.uniforms.uColor.value.setHex(hc ? 0xf2ff00 : 0x7bd34a);
    this.uniforms.uStripes.value = hc ? 1 : 0;
    if (this.ctx.playerDead()) return;
    const feet = this.ctx.player.position.clone().setY(this.ctx.player.feetY() + 0.05);
    if (this.contains(feet)) this.ctx.kill('liquid');
  }

  snapshot(): unknown {
    return { ...(super.snapshot() as object), t: this.t };
  }

  restore(state: unknown): void {
    super.restore(state);
    this.t = (state as { t: number }).t;
  }
}
