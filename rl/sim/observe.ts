import RAPIER from '@dimforge/rapier3d-compat';
import { MAX_STEER, TOP_SPEED } from '../../src/sim/carDynamics';
import type { Path } from './path';
import { RAY_GROUPS, type SimWorld } from './world';

// The observation: everything the driver sees, about 60 numbers scaled to roughly −1…1. This
// one function is used in training (Node) and in the browser viewer, so the policy sees
// identical inputs in both.

/** Distances ahead along the route of the waypoints the driver sees, m. */
export const WAYPOINTS = [4, 8, 14, 22, 32, 45];
export const RAYS = 15; // fanned over 180°, −90° (left) … +90° (right)
export const RAY_LENGTH = 40;
export const LIGHT_RANGE = 60;

export const OBS_SIZE = 4 + WAYPOINTS.length * 2 + 3 + 2 + RAYS * 2 + 3 + 2; // 56

/** A car's pose in the ground plane, from its rigid body. */
export interface Frame {
  x: number;
  y: number;
  z: number;
  /** Unit forward and right in the ground plane. */
  fx: number;
  fz: number;
  rx: number;
  rz: number;
  /** World up of the car's roof (1 = upright). */
  upY: number;
}

export function frameOf(body: RAPIER.RigidBody, out: Frame): Frame {
  const t = body.translation();
  const q = body.rotation();
  // Rotate +X (forward) by the quaternion.
  let fx = 1 - 2 * (q.y * q.y + q.z * q.z);
  let fz = 2 * (q.x * q.z - q.w * q.y);
  const l = Math.hypot(fx, fz) || 1;
  fx /= l;
  fz /= l;
  out.x = t.x;
  out.y = t.y;
  out.z = t.z;
  out.fx = fx;
  out.fz = fz;
  // Right of travel (+Z is right of +X): (−fz, fx).
  out.rx = -fz;
  out.rz = fx;
  out.upY = 1 - 2 * (q.x * q.x + q.z * q.z);
  return out;
}

export interface RayHit {
  /** Distance to the hit (RAY_LENGTH if nothing), m. */
  dist: Float32Array;
  /** 1 = a car, 0 = a building / nothing. */
  car: Float32Array;
}

const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });

/** Cast the sensor fan from a car (its own body excluded). */
export function castRays(sim: SimWorld, body: RAPIER.RigidBody, f: Frame, out: RayHit): RayHit {
  for (let i = 0; i < RAYS; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / (RAYS - 1);
    const c = Math.cos(a);
    const s = Math.sin(a);
    ray.origin.x = f.x;
    ray.origin.y = f.y + 0.75;
    ray.origin.z = f.z;
    ray.dir.x = c * f.fx + s * f.rx;
    ray.dir.y = 0;
    ray.dir.z = c * f.fz + s * f.rz;
    const hit = sim.world.castRay(ray, RAY_LENGTH, true, undefined, RAY_GROUPS, undefined, body);
    if (hit) {
      out.dist[i] = hit.timeOfImpact;
      out.car[i] = sim.kind.get(hit.collider.handle) === 1 ? 1 : 0;
    } else {
      out.dist[i] = RAY_LENGTH;
      out.car[i] = 0;
    }
  }
  return out;
}

export interface DriverState {
  frame: Frame;
  /** Velocity in the ground plane: forward and sideways (slip), m/s. */
  vFwd: number;
  vSide: number;
  yawRate: number;
  /** Front-wheel angle, rad. */
  steer: number;
  path: Path;
  /** Projection onto the path. */
  s: number;
  lat: number;
  rays: RayHit;
  /** The next lit stop line ahead: distance (m, Infinity if none in range) and its light. */
  stopDist: number;
  light: 'green' | 'yellow' | 'red';
  prevAction: [number, number];
}

const P = { x: 0, z: 0, tx: 0, tz: 0 };
const clamp = (v: number) => Math.max(-1, Math.min(1, v));

export function observe(d: DriverState, out: Float32Array, offset = 0): void {
  let k = offset;
  const f = d.frame;
  // Own motion.
  out[k++] = clamp(d.vFwd / 20);
  out[k++] = clamp(d.vSide / 5);
  out[k++] = clamp(d.yawRate / 2);
  out[k++] = clamp(d.steer / MAX_STEER);
  // Route ahead in the car's frame (forward, right), scaled by how far ahead each one is.
  for (const ahead of WAYPOINTS) {
    d.path.at(d.s + ahead, P);
    const dx = P.x - f.x;
    const dz = P.z - f.z;
    const scale = ahead + 5;
    out[k++] = clamp((dx * f.fx + dz * f.fz) / scale);
    out[k++] = clamp((dx * f.rx + dz * f.rz) / scale);
  }
  // Lane: offset from the lane centre, heading error (sin, cos).
  d.path.at(d.s, P);
  out[k++] = clamp(d.lat / 3);
  out[k++] = -f.fx * P.tz + f.fz * P.tx; // sin of heading error (forward · the path's right; + = pointing right)
  out[k++] = f.fx * P.tx + f.fz * P.tz; // cos
  // Speed limits: the road's, and what the curves in the next 40 m allow.
  const i = d.path.index(d.s);
  out[k++] = d.path.limit[i] / 20;
  out[k++] = Math.min(TOP_SPEED, d.path.curveLimit(d.s, 40)) / 20;
  // Raycasts.
  for (let r = 0; r < RAYS; r++) {
    out[k++] = d.rays.dist[r] / RAY_LENGTH;
    out[k++] = d.rays.car[r];
  }
  // Traffic light ahead.
  const near = d.stopDist < LIGHT_RANGE;
  out[k++] = near ? d.stopDist / LIGHT_RANGE : 1;
  out[k++] = near && d.light === 'red' ? 1 : 0;
  out[k++] = near && d.light === 'yellow' ? 1 : 0;
  // The last action (steering and throttle), so the policy can be smooth.
  out[k++] = d.prevAction[0];
  out[k++] = d.prevAction[1];
}
