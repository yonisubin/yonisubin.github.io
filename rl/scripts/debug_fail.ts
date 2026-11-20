import RAPIER from '@dimforge/rapier3d-compat';
import { SimWorld } from '../sim/world';
import { DrivingEnv, Info, INFO_SIZE } from '../sim/env';
import { baselineAction } from '../../src/ai/baseline';
await RAPIER.init();
const sim = new SimWorld();
const cars = 16;
const env = new DrivingEnv(sim, { cars, seed: 7, stage: 2, randomize: false, area: 'train' });
const act = new Float32Array(cars * 2);
const o: [number, number] = [0, 0];
const hist: string[][] = env.agents.map(() => []);
let shown = 0;
for (let k = 0; k < 1500 && shown < 8; k++) {
  env.agents.forEach((a, i) => {
    baselineAction(a, o); act[i * 2] = o[0]; act[i * 2 + 1] = o[1];
    const pi = a.path.index(a.s);
    hist[i].push(`s=${a.s.toFixed(1)}/${a.path.length.toFixed(0)} lat=${a.lat.toFixed(2)} v=${a.vFwd.toFixed(1)} lim=${a.path.limit[pi].toFixed(1)} curve=${a.path.curve[pi].toFixed(1)} act=${o.map(x=>x.toFixed(2))} pos=${a.frame.x.toFixed(0)},${a.frame.y.toFixed(1)},${a.frame.z.toFixed(0)} rays=${Array.from(a.rays.dist.slice(5,10)).map(x=>x.toFixed(1))} cars=${Array.from(a.rays.car.slice(5,10))} stop=${a.stopDist.toFixed(0)}${a.light} up=${a.frame.upY.toFixed(2)} gy=${sim.height(a.frame.x,a.frame.z).toFixed(1)}`);
    if (hist[i].length > 200) hist[i].shift();
  });
  env.step(act);
  for (let i = 0; i < cars; i++) if (env.done[i]) {
    const inf = Array.from(env.info.slice(i * INFO_SIZE, i * INFO_SIZE + INFO_SIZE));
    if (inf[Info.Timeout]) { console.log('FAIL', inf.join(','), '\n  ' + hist[i].filter((_, j) => j % 25 === 0).join('\n  ')); shown++; }
    hist[i] = [];
  }
}
