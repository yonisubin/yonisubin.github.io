import RAPIER from '@dimforge/rapier3d-compat';
import { SimWorld } from '../sim/world';
import { DrivingEnv, Info, INFO_SIZE, STAGES } from '../sim/env';
import { baselineAction } from '../sim/baseline';
await RAPIER.init();
const sim = new SimWorld();
const stages = process.argv[2] ? process.argv[2].split(',').map(Number) : STAGES.map((_, i) => i);
for (const stage of stages) {
  const cars = 16;
  const env = new DrivingEnv(sim, { cars, seed: 7, stage, randomize: false, area: 'train' });
  const act = new Float32Array(cars * 2);
  const o: [number, number] = [0, 0];
  const c = [0, 0, 0, 0, 0];
  let prog = 0;
  for (let k = 0; k < 2000; k++) {
    env.agents.forEach((a, i) => { baselineAction(a, o); act[i * 2] = o[0]; act[i * 2 + 1] = o[1]; });
    env.step(act);
    for (let i = 0; i < cars; i++) if (env.done[i]) { for (let j = 0; j < 5; j++) c[j] += env.info[i * INFO_SIZE + j]; prog += env.info[i * INFO_SIZE + Info.Progress]; }
  }
  const n = c.reduce((a, b) => a + b, 0);
  console.log(`${STAGES[stage].name}: episodes ${n} success ${(c[0] / n * 100).toFixed(0)}% crash ${c[1]} off ${c[2]} red ${c[3]} timeout ${c[4]}`);
  for (const a of env.agents) a.car.dispose(sim.world);
  for (const b of env.bots) sim.world.removeRigidBody(b.body);
}
