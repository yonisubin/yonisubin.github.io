import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import { SimWorld } from '../sim/world';
import { DrivingEnv, Info, INFO_SIZE } from '../sim/env';
import { Policy } from '../sim/policy';
// Trace a policy's failed episodes: node rl/dist/debug_policy.mjs <policy.json> <stage 1-6>
await RAPIER.init();
const sim = new SimWorld();
const policy = new Policy(JSON.parse(readFileSync(process.argv[2], 'utf8')));
const cars = 16;
const env = new DrivingEnv(sim, { cars, seed: 9, stage: Number(process.argv[3] ?? 2) - 1, randomize: false, area: 'train' });
const act = new Float32Array(cars * 2);
const hist: string[][] = env.agents.map(() => []);
const count: Record<string, number> = {};
let shown = 0;
for (let k = 0; k < 3000; k++) {
  policy.act(env.obs, cars, act);
  env.agents.forEach((a, i) => {
    const pi = a.path.index(a.s);
    hist[i].push(`s=${a.s.toFixed(1)}/${a.path.length.toFixed(0)} lat=${a.lat.toFixed(2)} v=${a.vFwd.toFixed(1)} lim=${a.path.limit[pi].toFixed(1)} curve=${a.path.curveLimit(a.s, 30).toFixed(1)} act=${act[i * 2].toFixed(2)},${act[i * 2 + 1].toFixed(2)} ray=${a.rays.dist[7].toFixed(0)} stop=${a.stopDist.toFixed(0)}${a.light} pos=${a.frame.x.toFixed(0)},${a.frame.z.toFixed(0)}`);
  });
  env.step(act);
  for (let i = 0; i < cars; i++) if (env.done[i]) {
    const inf = Array.from(env.info.slice(i * INFO_SIZE, i * INFO_SIZE + INFO_SIZE));
    const kind = ['success', 'crash', 'offroad', 'red', 'timeout'][inf.slice(0, 5).indexOf(1)];
    count[kind] = (count[kind] ?? 0) + 1;
    if (kind !== 'success' && shown < 6) { console.log(kind, 'len', inf[Info.Length], '\n  ' + hist[i].filter((_, j) => j % Math.ceil(hist[i].length / 12) === 0).join('\n  ')); shown++; }
    hist[i] = [];
  }
}
console.log(count);
