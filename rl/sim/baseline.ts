import { MAX_STEER, MIN_STEER, TOP_SPEED } from '../../src/sim/carDynamics';
import { CAR_DIMENSIONS } from '../../src/vehicles/carDimensions';
import { RAYS, type DriverState } from './observe';

// The hand-written opponent: pure-pursuit steering + a proportional speed controller, with
// raycast braking and stopping for red lights. It reads the same DriverState the policy's
// observation is built from, and outputs the same two actions.

const WHEELBASE = CAR_DIMENSIONS.sedan.wheelBase;
const COMFORT_DECEL = 3.5; // m/s² it plans to brake at
const P = { x: 0, z: 0, tx: 0, tz: 0 };

export function baselineAction(d: DriverState, out: [number, number]): [number, number] {
  const f = d.frame;
  const v = Math.max(0, d.vFwd);

  // --- Pure pursuit: aim at a point a speed-dependent distance ahead on the route; the arc
  // through it has curvature κ = 2·y / L² (y = sideways offset of the point), and a bicycle
  // model needs a wheel angle of atan(wheelbase · κ) to drive that arc.
  const L = 4 + 0.4 * v;
  d.path.at(d.s + L, P);
  const dx = P.x - f.x;
  const dz = P.z - f.z;
  const fwd = dx * f.fx + dz * f.fz;
  const side = dx * f.rx + dz * f.rz;
  const dist2 = Math.max(1, fwd * fwd + side * side);
  const delta = Math.atan((WHEELBASE * 2 * side) / dist2);
  const t = Math.min(1, v / TOP_SPEED);
  const lock = (1 - t) * MAX_STEER + t * MIN_STEER;
  const steer = Math.max(-1, Math.min(1, delta / lock));

  // --- Speed: the road's limit, slowed for curves within braking distance, for obstacles
  // straight ahead, and for a red light.
  const i = d.path.index(d.s);
  let target = Math.min(d.path.limit[i], d.path.curveLimit(d.s, 8 + (v * v) / (2 * COMFORT_DECEL)));
  // The middle rays (roughly ±20°) see what's in the lane ahead.
  const mid = (RAYS - 1) / 2;
  for (let r = mid - 2; r <= mid + 2; r++) {
    const gap = d.rays.dist[r] - 7;
    target = Math.min(target, Math.sqrt(2 * COMFORT_DECEL * Math.max(0, gap)));
  }
  if (d.stopDist < 80 && (d.light === 'red' || (d.light === 'yellow' && d.stopDist > (v * v) / (2 * COMFORT_DECEL)))) {
    target = Math.min(target, Math.sqrt(2 * COMFORT_DECEL * Math.max(0, d.stopDist - 1.5)));
  }
  const err = target - v;
  let throttle = err > 0 ? Math.min(1, 0.15 + 0.35 * err) : Math.max(-1, 0.35 * err);
  if (target < 0.3 && v < 0.5) throttle = 0; // hold still (coasting brakes gently)
  out[0] = steer;
  out[1] = throttle;
  return out;
}
