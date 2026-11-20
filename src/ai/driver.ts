import type RAPIER from '@dimforge/rapier3d-compat';
import type { RoadGraph, Light } from '../world/roadGraph';
import { castRays, frameOf, RAYS, type DriverState, type Frame, type RayHit, type RaySensors } from './observe';
import type { Path } from './path';

// One AI driver's view of the world, refreshed before each decision: pose and velocities from
// its rigid body, where it is along its route, the sensor rays and the next traffic light.
// Shared by RL training (rl/sim/env.ts), NPC traffic and the player's autopilot.

export class DriverView implements DriverState {
  frame: Frame = { x: 0, y: 0, z: 0, fx: 1, fz: 0, rx: 0, rz: 1, upY: 1 };
  vFwd = 0;
  vSide = 0;
  yawRate = 0;
  steer = 0;
  path!: Path;
  s = 0;
  lat = 0;
  rays: RayHit = { dist: new Float32Array(RAYS), car: new Float32Array(RAYS), closing: new Float32Array(RAYS) };
  stopDist = Infinity;
  light: Light = 'green';
  prevAction: [number, number] = [0, 0];
  /** The action being applied (steering, throttle). */
  action: [number, number] = [0, 0];
}

const proj = { s: 0, lat: 0 };

/**
 * Refresh a driver's view. `steer` is the car's current front-wheel angle; `time` the clock
 * the traffic lights run on.
 */
export function senseDriver(
  d: DriverView,
  body: RAPIER.RigidBody,
  steer: number,
  sensors: RaySensors,
  graph: RoadGraph,
  time: number,
): void {
  frameOf(body, d.frame);
  const v = body.linvel();
  d.vFwd = v.x * d.frame.fx + v.z * d.frame.fz;
  d.vSide = v.x * d.frame.rx + v.z * d.frame.rz;
  d.yawRate = body.angvel().y;
  d.steer = steer;
  d.path.project(d.frame.x, d.frame.z, d.s, proj);
  d.s = proj.s;
  d.lat = proj.lat;
  castRays(sensors, body, d.frame, d.rays);
  d.stopDist = Infinity;
  d.light = 'green';
  for (const st of d.path.stops) {
    if (st.s < d.s - 0.5) continue;
    d.stopDist = st.s - d.s;
    d.light = graph.lightState(st.lane, time);
    break;
  }
}
