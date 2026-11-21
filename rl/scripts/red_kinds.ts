import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import { SimWorld } from '../sim/world';
import { DrivingEnv, Info, INFO_SIZE } from '../sim/env';
import { Policy } from '../../src/ai/policy';
// Why a policy runs red lights: node red_kinds.mjs <policy.json>
await RAPIER.init();
const sim = new SimWorld();
const policy = new Policy(JSON.parse(readFileSync(process.argv[2], 'utf8')));
const cars = 16;
const env = new DrivingEnv(sim, { cars, seed: 21, stage: 5, randomize: false, area: 'train' });
const act = new Float32Array(cars * 2);
type Rec = { stop: number; light: string; v: number; thr: number; step: number };
const hist: Rec[][] = env.agents.map(() => []);
const kinds: Record<string, number> = {};
let eps = 0, shown = 0;
for (let k = 0; k < 5000; k++) {
  policy.act(env.obs, cars, act);
  env.agents.forEach((a, i) => hist[i].push({ stop: a.stopDist, light: a.light, v: a.vFwd, thr: act[i * 2 + 1], step: a.steps }));
  env.step(act);
  for (let i = 0; i < cars; i++) if (env.done[i]) {
    eps++;
    const h = hist[i];
    hist[i] = [];
    if (!env.info[i * INFO_SIZE + Info.RedLight]) continue;
    const last = h[h.length - 1];
    // When did this light turn red, and how far / fast was the car then?
    let j = h.length - 1;
    while (j > 0 && h[j - 1].light === 'red' && h[j - 1].stop < 80) j--;
    const atRed = h[j];
    const need = (atRed.v * atRed.v) / (2 * 6);
    let kind: string;
    if (h.length <= 3) kind = 'spawned at the line';
    else if (last.v < 1.5) kind = 'crept over while waiting';
    else if (atRed.stop < need) kind = 'light went red too late to stop (≥6 m/s²)';
    else kind = 'did not stop (could have)';
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    if (shown < 4 && kind.startsWith('did not')) {
      shown++;
      console.log(kind, h.slice(Math.max(0, j - 3)).filter((_, q) => q % 3 === 0).map((r) => `${r.stop.toFixed(0)}m ${r.light} v=${r.v.toFixed(1)} t=${r.thr.toFixed(2)}`).join(' | '));
    }
  }
}
console.log('episodes', eps, kinds);
