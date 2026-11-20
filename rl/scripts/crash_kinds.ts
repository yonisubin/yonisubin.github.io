import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import { SimWorld } from '../sim/world';
import { DrivingEnv, Info, INFO_SIZE } from '../sim/env';
import { Policy } from '../../src/ai/policy';
import { RAYS } from '../../src/ai/observe';
// What a policy crashes into, by what its sensors saw just before: node crash_kinds.mjs <policy.json> <stage>
await RAPIER.init();
const sim = new SimWorld();
const policy = new Policy(JSON.parse(readFileSync(process.argv[2], 'utf8')));
const cars = 16;
const env = new DrivingEnv(sim, { cars, seed: 11, stage: Number(process.argv[3] ?? 4) - 1, randomize: false, area: 'train' });
const act = new Float32Array(cars * 2);
const last: { front: number; side: number; v: number; frontCar: number }[] = [];
const kinds: Record<string, number> = {};
let eps = 0;
for (let k = 0; k < 6000; k++) {
  policy.act(env.obs, cars, act);
  env.agents.forEach((a, i) => {
    const mid = (RAYS - 1) / 2;
    let front = 99, side = 99, frontCar = 0;
    for (let r = 0; r < RAYS; r++) {
      const ang = Math.abs(r - mid) * (180 / (RAYS - 1));
      if (ang <= 26) { if (a.rays.dist[r] < front) { front = a.rays.dist[r]; frontCar = a.rays.car[r]; } }
      else side = Math.min(side, a.rays.dist[r]);
    }
    last[i] = { front, side, v: a.vFwd, frontCar };
  });
  env.step(act);
  for (let i = 0; i < cars; i++) if (env.done[i]) {
    eps++;
    if (!env.info[i * INFO_SIZE + Info.Crash]) continue;
    const l = last[i];
    const kind = l.front < 15 ? (l.frontCar ? 'front: car ahead' : 'front: wall/building') : l.side < 4 ? 'side: something alongside' : 'unseen (behind / sudden)';
    kinds[kind] = (kinds[kind] ?? 0) + 1;
  }
}
console.log('episodes', eps, kinds);
