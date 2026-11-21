import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import { SimWorld } from '../sim/world';
import { DrivingEnv } from '../sim/env';
import { Policy } from '../../src/ai/policy';
import { OBS_SIZE } from '../../src/ai/observe';
// Does the policy react to the red-light input? Throttle with the light shown red vs green,
// in real approach states (light ahead within 15–50 m, moving). node light_sens.mjs <policy.json>
await RAPIER.init();
const sim = new SimWorld();
const policy = new Policy(JSON.parse(readFileSync(process.argv[2], 'utf8')));
const cars = 16;
const env = new DrivingEnv(sim, { cars, seed: 5, stage: 5, randomize: false, area: 'train' });
const act = new Float32Array(cars * 2);
const RED = OBS_SIZE - 4, YEL = OBS_SIZE - 3, DIST = OBS_SIZE - 5;
let n = 0, sumRed = 0, sumGreen = 0, brakeRed = 0;
const o = new Float32Array(OBS_SIZE), out = new Float32Array(2);
for (let k = 0; k < 3000; k++) {
  policy.act(env.obs, cars, act);
  env.agents.forEach((a, i) => {
    if (a.stopDist < 15 || a.stopDist > 50 || a.vFwd < 5) return;
    o.set(env.obs.subarray(i * OBS_SIZE, (i + 1) * OBS_SIZE));
    o[RED] = 1; o[YEL] = 0; policy.act1(o, out); const r = out[1];
    o[RED] = 0; policy.act1(o, out); const g = out[1];
    n++; sumRed += r; sumGreen += g; if (r < -0.2) brakeRed++;
  });
  env.step(act);
}
console.log('states', n, 'mean throttle red', (sumRed / n).toFixed(2), 'green', (sumGreen / n).toFixed(2), 'brakes when red', (brakeRed / n * 100).toFixed(0) + '%', 'dist idx value sample', env.obs[DIST].toFixed(2));
