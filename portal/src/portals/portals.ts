// The device's two portals: placement (hitscan, surface tags, fit + nudge, fizzle), the invisible
// tunnel around each hole, and which walls are "masked" for an object overlapping a portal.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG, type PortalId } from '../core/config';
import type { FaceKey, SurfaceTag } from '../levels/level';
import type { Physics } from '../physics/world';
import { type PortalFrame, toLocal } from './transform';

export interface Portal extends PortalFrame {
  id: PortalId;
  normal: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  /** Index of the brush the portal sits on: masked (non-solid) for things passing through. */
  brushIndex: number;
  face: FaceKey;
  /** Four colliders lining the hole behind the surface, so you can't slip sideways into the wall. */
  tunnel: RAPIER.Collider[];
}

export type PlaceFailReason = 'nothing' | 'not-portalable' | 'glass' | 'no-room' | 'overlap' | 'blocked';

export type PlaceResult =
  | { ok: true; portal: Portal }
  | { ok: false; reason: PlaceFailReason; point?: THREE.Vector3; normal?: THREE.Vector3; tag?: SurfaceTag };

const W = CONFIG.portal.width;
const H = CONFIG.portal.height;
const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];

export class PortalSystem {
  a: Portal | null = null;
  b: Portal | null = null;
  /** Portals placed so far (for the challenge counter later, and tests). */
  placedCount = 0;

  constructor(private readonly physics: Physics) {}

  get(id: PortalId): Portal | null {
    return id === 'a' ? this.a : this.b;
  }

  other(id: PortalId): Portal | null {
    return id === 'a' ? this.b : this.a;
  }

  /** Both ends exist: the pair is open and things can pass. */
  linked(): boolean {
    return !!(this.a && this.b);
  }

  clear(): void {
    for (const id of ['a', 'b'] as const) this.remove(id);
  }

  remove(id: PortalId): void {
    const p = this.get(id);
    if (!p) return;
    for (const c of p.tunnel) {
      this.physics.unregister(c);
      this.physics.world.removeCollider(c, false);
    }
    if (id === 'a') this.a = null;
    else this.b = null;
  }

  /**
   * Fire portal `id` along a ray. `upHint` is the camera's up vector, used to orient a portal on a
   * floor or ceiling when looking straight down/up.
   */
  fire(id: PortalId, origin: THREE.Vector3, dir: THREE.Vector3, upHint: THREE.Vector3, exclude?: RAPIER.Collider): PlaceResult {
    const world = this.physics.world;
    const ray = new RAPIER.Ray(origin, dir);
    // Portal shots ignore portal tunnels and the shooter; glass stops them (and fizzles).
    const hit = world.castRayAndGetNormal(ray, CONFIG.portal.range, true, undefined, undefined, exclude, undefined, (c) => {
      const i = this.physics.infoOf(c);
      return !!i && i.kind === 'brush';
    });
    if (!hit) return { ok: false, reason: 'nothing' };
    const point = new THREE.Vector3().copy(origin).addScaledVector(dir, hit.timeOfImpact);
    const normal = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
    const surface = this.physics.surfaceAt(hit.collider, normal);
    if (!surface) return { ok: false, reason: 'not-portalable', point, normal };
    if (surface.tag === 'glass') return { ok: false, reason: 'glass', point, normal, tag: 'glass' };
    if (surface.tag !== 'portalable') return { ok: false, reason: 'not-portalable', point, normal, tag: surface.tag };

    // Orientation: walls keep "up" = world up; on floors/ceilings "up" points along the view.
    const n = AXES[['x', 'y', 'z'].indexOf(surface.face[1])].clone().multiplyScalar(surface.face[0] === '+' ? 1 : -1);
    let up: THREE.Vector3;
    if (Math.abs(n.y) > 0.99) {
      up = new THREE.Vector3(dir.x, 0, dir.z);
      if (up.lengthSq() < 1e-6) up.set(upHint.x, 0, upHint.z);
      if (up.lengthSq() < 1e-6) up.set(0, 0, -1);
      up.normalize();
    } else {
      up = new THREE.Vector3(0, 1, 0);
    }
    const right = new THREE.Vector3().crossVectors(up, n).normalize();
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, n));

    // Fit: the opening must lie on this one face, clear of anything standing on the face (another
    // brush poking through it) and clear of the other portal. If the spot you hit doesn't work, try
    // spots nearby (a 5 cm grid within nudgeMax) and take the closest one that does.
    const b = surface.brush;
    const planeK = [0, 1, 2].find((k) => Math.abs(n.getComponent(k)) > 0.5)!;
    const axisIdx = [0, 1, 2].filter((k) => k !== planeK);
    const planeV = n.getComponent(planeK) > 0 ? b.max[planeK] : b.min[planeK];
    const hitOnPlane = point.clone().setComponent(planeK, planeV);
    const ext = axisIdx.map((k) => (Math.abs(right.getComponent(k)) * W) / 2 + (Math.abs(up.getComponent(k)) * H) / 2);
    if (axisIdx.some((k, i) => b.max[k] - b.min[k] < 2 * ext[i] - 1e-6)) return { ok: false, reason: 'no-room', point, normal: n };

    // Brushes that stick out of this face near the hit (their footprint on the face blocks it).
    const reach = Math.max(W, H) + CONFIG.portal.nudgeMax;
    const blockers: [number, number, number, number][] = [];
    this.physics.level?.brushes.forEach((o, idx) => {
      if (idx === surface.index) return;
      const lo = planeV + (n.getComponent(planeK) > 0 ? 0.001 : -0.05);
      const hi = planeV + (n.getComponent(planeK) > 0 ? 0.05 : -0.001);
      if (o.max[planeK] <= lo || o.min[planeK] >= hi) return;
      const [k1, k2] = axisIdx;
      if (o.max[k1] < hitOnPlane.getComponent(k1) - reach || o.min[k1] > hitOnPlane.getComponent(k1) + reach) return;
      if (o.max[k2] < hitOnPlane.getComponent(k2) - reach || o.min[k2] > hitOnPlane.getComponent(k2) + reach) return;
      blockers.push([o.min[k1], o.max[k1], o.min[k2], o.max[k2]]);
    });
    const other = this.other(id);
    const fits = (c: THREE.Vector3): boolean => {
      for (let i = 0; i < 2; i++) {
        const k = axisIdx[i];
        const v = c.getComponent(k);
        if (v < b.min[k] + ext[i] - 1e-6 || v > b.max[k] - ext[i] + 1e-6) return false;
      }
      for (const [a0, a1, b0, b1] of blockers) {
        if (this.rectHitsBox(c, right, up, axisIdx, a0, a1, b0, b1)) return false;
      }
      return !(other && this.overlaps(other, c, right, up, n));
    };
    let center: THREE.Vector3 | null = null;
    if (fits(hitOnPlane)) center = hitOnPlane;
    else {
      const step = 0.05;
      const maxR = CONFIG.portal.nudgeMax;
      let best = Infinity;
      const c = new THREE.Vector3();
      for (let i = -maxR; i <= maxR + 1e-9; i += step) {
        for (let j = -maxR; j <= maxR + 1e-9; j += step) {
          const d2 = i * i + j * j;
          if (d2 > maxR * maxR + 1e-9 || d2 >= best) continue;
          c.copy(hitOnPlane);
          c.setComponent(axisIdx[0], c.getComponent(axisIdx[0]) + i);
          c.setComponent(axisIdx[1], c.getComponent(axisIdx[1]) + j);
          if (fits(c)) {
            best = d2;
            center = c.clone();
          }
        }
      }
    }
    if (!center) {
      const reason: PlaceFailReason = other && this.overlaps(other, hitOnPlane, right, up, n) ? 'overlap' : blockers.length ? 'blocked' : 'no-room';
      return { ok: false, reason, point, normal: n };
    }

    // Success: (re)place this colour.
    this.remove(id);
    const portal: Portal = {
      id,
      position: center,
      quaternion,
      normal: n,
      right,
      up,
      brushIndex: surface.index,
      face: surface.face,
      tunnel: [],
    };
    portal.tunnel = this.buildTunnel(portal);
    if (id === 'a') this.a = portal;
    else this.b = portal;
    this.placedCount++;
    return { ok: true, portal };
  }

  /** Does the portal rectangle at `c` overlap an axis-aligned box footprint on the face? (SAT) */
  private rectHitsBox(c: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, axisIdx: number[], a0: number, a1: number, b0: number, b1: number): boolean {
    const boxC = [(a0 + a1) / 2, (b0 + b1) / 2];
    const boxH = [(a1 - a0) / 2, (b1 - b0) / 2];
    const d = [c.getComponent(axisIdx[0]) - boxC[0], c.getComponent(axisIdx[1]) - boxC[1]];
    const r2 = [right.getComponent(axisIdx[0]), right.getComponent(axisIdx[1])];
    const u2 = [up.getComponent(axisIdx[0]), up.getComponent(axisIdx[1])];
    const axes = [[1, 0], [0, 1], r2, u2];
    for (const ax of axes) {
      const ra = (Math.abs(r2[0] * ax[0] + r2[1] * ax[1]) * W) / 2 + (Math.abs(u2[0] * ax[0] + u2[1] * ax[1]) * H) / 2;
      const rb = Math.abs(ax[0]) * boxH[0] + Math.abs(ax[1]) * boxH[1];
      if (Math.abs(d[0] * ax[0] + d[1] * ax[1]) >= ra + rb - 1e-4) return false;
    }
    return true;
  }

  /** Rectangles on the same plane overlapping? (2-D separating-axis test in the plane.) */
  private overlaps(o: Portal, c: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, n: THREE.Vector3): boolean {
    if (o.normal.dot(n) < 0.99) return false;
    if (Math.abs(o.position.clone().sub(c).dot(n)) > 0.02) return false;
    const d = c.clone().sub(o.position);
    for (const axis of [right, up, o.right, o.up]) {
      const ra = (Math.abs(right.dot(axis)) * W) / 2 + (Math.abs(up.dot(axis)) * H) / 2;
      const rb = (Math.abs(o.right.dot(axis)) * W) / 2 + (Math.abs(o.up.dot(axis)) * H) / 2;
      if (Math.abs(d.dot(axis)) >= ra + rb - 1e-4) return false;
    }
    return true;
  }

  private buildTunnel(p: Portal): RAPIER.Collider[] {
    const T = CONFIG.portal.tunnelWall;
    const D = CONFIG.portal.tunnelDepth;
    // [local centre, half extents] in the portal frame (x right, y up, z out of the wall).
    const parts: [THREE.Vector3, THREE.Vector3][] = [
      [new THREE.Vector3(-(W / 2 + T / 2), 0, -D / 2), new THREE.Vector3(T / 2, H / 2 + T, D / 2)],
      [new THREE.Vector3(W / 2 + T / 2, 0, -D / 2), new THREE.Vector3(T / 2, H / 2 + T, D / 2)],
      [new THREE.Vector3(0, H / 2 + T / 2, -D / 2), new THREE.Vector3(W / 2, T / 2, D / 2)],
      [new THREE.Vector3(0, -(H / 2 + T / 2), -D / 2), new THREE.Vector3(W / 2, T / 2, D / 2)],
    ];
    return parts.map(([c, h]) => {
      const world = c.clone().applyQuaternion(p.quaternion).add(p.position);
      const desc = RAPIER.ColliderDesc.cuboid(h.x, h.y, h.z)
        .setTranslation(world.x, world.y, world.z)
        .setRotation({ x: p.quaternion.x, y: p.quaternion.y, z: p.quaternion.z, w: p.quaternion.w });
      const col = this.physics.world.createCollider(desc);
      this.physics.register(col, { kind: 'tunnel', portal: p.id });
      return col;
    });
  }

  /**
   * Which portals a vertical capsule is passing through right now: for those, the wall the portal
   * sits on is ignored and the portal's tunnel collides instead (a hole in the wall).
   * `reach` is how far ahead (m) the capsule may move this step.
   */
  overlapping(center: THREE.Vector3, halfSeg: number, radius: number, reach: number): Portal[] {
    if (!this.linked()) return [];
    const out: Portal[] = [];
    for (const p of [this.a!, this.b!]) {
      const e1 = toLocal(p, new THREE.Vector3(center.x, center.y + halfSeg, center.z));
      const e2 = toLocal(p, new THREE.Vector3(center.x, center.y - halfSeg, center.z));
      const uMin = Math.min(e1.x, e2.x) - radius, uMax = Math.max(e1.x, e2.x) + radius;
      const vMin = Math.min(e1.y, e2.y) - radius, vMax = Math.max(e1.y, e2.y) + radius;
      const zMin = Math.min(e1.z, e2.z) - radius, zMax = Math.max(e1.z, e2.z) + radius;
      const inRect = uMax > -W / 2 && uMin < W / 2 && vMax > -H / 2 && vMin < H / 2;
      if (inRect && zMin < reach + 0.05 && zMax > -CONFIG.portal.tunnelDepth) out.push(p);
    }
    return out;
  }
}
