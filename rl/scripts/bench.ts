import RAPIER from '@dimforge/rapier3d-compat';
import { SimWorld } from '../sim/world';
import { DrivingEnv, Info, INFO_SIZE } from '../sim/env';

// Throughput check (the spec's week-one gate): car-decisions and car-physics-steps per second
// on one core, with random-ish actions.
await RAPIER.init();
const sim = new SimWorld();
for (const [stage, cars] of [[0, 16], [2, 16], [2, 32], [5, 16]] as const) {
  const env = new DrivingEnv(sim, { cars, seed: 1, stage, randomize: true, area: 'train' });
  const act = new Float32Array(cars * 2);
  const steps = 300;
  let eps = 0, crash = 0, off = 0;
  const t0 = performance.now();
  for (let k = 0; k < steps; k++) {
    for (let i = 0; i < cars; i++) { act[i * 2] = Math.random() * 0.4 - 0.2; act[i * 2 + 1] = 0.6; }
    env.step(act);
    for (let i = 0; i < cars; i++) if (env.done[i]) { eps++; crash += env.info[i * INFO_SIZE + Info.Crash]; off += env.info[i * INFO_SIZE + Info.Offroad]; }
  }
  const s = (performance.now() - t0) / 1000;
  console.log(`stage ${stage + 1} cars ${cars} bots ${env.bots.length}: ${(steps * cars / s).toFixed(0)} decisions/s, ${(steps * cars * 4 / s).toFixed(0)} car-physics-steps/s; episodes ${eps} crash ${crash} off ${off}`);
  for (const a of env.agents) a.car.dispose(sim.world);
  for (const b of env.bots) sim.world.removeRigidBody(b.body);
}
