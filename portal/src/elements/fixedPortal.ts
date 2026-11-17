// A pre-placed portal end (early chambers: no device, or a device that fires only one colour).
//   props.which   'a' | 'b'
//   props.normal  surface normal (the entity position is the portal centre on the surface)
//   props.up      optional "up" for floor/ceiling portals (default -Z)
//   props.cycle   optional list of [position, normal] pairs: the end flips between them every
//                 props.period seconds (the "flipping exit")
// Input: active (default true) — off closes this end. Grills don't erase fixed ends.
import * as THREE from 'three';
import { CONFIG, type PortalId } from '../core/config';
import type { ChamberContext } from '../game/context';
import type { Entity, Vec3 } from '../levels/level';
import { BaseElement } from './base';

/** Portal orientation for a surface normal: walls keep world up, floors/ceilings use `upHint`. */
export function portalFrame(normal: THREE.Vector3, upHint?: THREE.Vector3): THREE.Quaternion {
  const n = normal.clone().normalize();
  const up = Math.abs(n.y) > 0.99 ? (upHint?.clone() ?? new THREE.Vector3(0, 0, -1)) : new THREE.Vector3(0, 1, 0);
  up.addScaledVector(n, -up.dot(n)).normalize();
  const right = new THREE.Vector3().crossVectors(up, n).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, n));
}

export class FixedPortal extends BaseElement {
  private index = 0;
  private timer = 0;
  private placedOk = false;

  constructor(ctx: ChamberContext, entity: Entity) {
    super(ctx, entity);
    // Opens on the first update (once the wiring says whether it is active).
  }

  which(): PortalId {
    return this.prop<PortalId>('which', 'b');
  }

  private spots(): [THREE.Vector3, THREE.Vector3][] {
    const cycle = this.prop<Vec3[][]>('cycle', []);
    if (cycle.length) return cycle.map((c) => [new THREE.Vector3(...c[0]), new THREE.Vector3(...c[1])]);
    return [[this.origin(), this.vec('normal', [0, 0, 1])]];
  }

  private place(): void {
    const [pos, n] = this.spots()[this.index % this.spots().length];
    const up = this.entity.props?.up ? this.vec('up', [0, 0, -1]) : undefined;
    const p = this.ctx.portals.placeAt(this.which(), pos, portalFrame(n, up), true);
    this.placedOk = !!p;
  }

  isPlaced(): boolean {
    return this.placedOk;
  }

  update(dt: number): void {
    const active = this.input('active', true);
    const mine = this.ctx.portals.get(this.which());
    if (!active) {
      if (mine?.fixed) this.ctx.portals.remove(this.which());
      return;
    }
    // Not open yet, or the device's portal of this colour is there: (re)open the fixed end.
    if (!mine || !mine.fixed) this.place();
    const spots = this.spots();
    if (spots.length < 2) return;
    this.timer += dt;
    if (this.timer >= this.prop('period', CONFIG.elements.fixedPortalPeriod)) {
      this.timer = 0;
      this.index = (this.index + 1) % spots.length;
      this.place();
      this.ctx.sfx('portalFlip', 'Portal shifts');
    }
  }

  snapshot(): unknown {
    return { ...(super.snapshot() as object), index: this.index, timer: this.timer };
  }

  restore(state: unknown): void {
    super.restore(state);
    const s = state as { index: number; timer: number };
    this.index = s.index;
    this.timer = s.timer;
  }

  dispose(): void {
    super.dispose();
  }
}
