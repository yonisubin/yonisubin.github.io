import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import { CarDynamics } from '../../src/sim/carDynamics';
import { SimWorld } from '../sim/world';
import { DrivingEnv } from '../sim/env';
import { baselineAction } from '../../src/ai/baseline';

// Checks for the RL simulator: node rl/dist/test_sim.mjs
//  1. The shared car physics (src/sim/carDynamics.ts) reproduces, bit for bit, the poses the
//     game's car (player/car.ts) reached before the physics was extracted from it.
//  2. The driving environment is deterministic: same seed + same actions → same positions.
await RAPIER.init();
let failed = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

{
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(1, 3, 10).setTranslation(60, 2, 8));
  const got: number[][] = [];
  for (const type of ['sedan', 'van'] as const) {
    const car = new CarDynamics(world, type, 0, 0, type === 'van' ? 30 : 0, 0.1);
    for (let i = 0; i < 600; i++) {
      const t = i / 60;
      car.step({ driven: true, throttle: t < 4 ? 1 : t < 6 ? -1 : 0.4, steer: Math.sin(t * 1.3) * 0.8, handbrake: t > 7 && t < 7.5 }, 1 / 60);
      world.step();
    }
    const p = car.body.translation();
    const r = car.body.rotation();
    got.push([p.x, p.y, p.z, r.x, r.y, r.z, r.w]);
  }
  const ref = JSON.parse(readFileSync(new URL('../tests/car_reference.json', import.meta.url), 'utf8')) as number[][];
  check(JSON.stringify(got) === JSON.stringify(ref), 'car physics matches the game car (sedan + van, 10 s of mixed inputs)');
}

{
  // A fresh world each time: Rapier is deterministic for the same sequence of insertions and
  // removals, so the same world reused after other episodes would not replay identically.
  const trace = () => {
    const sim = new SimWorld();
    const env = new DrivingEnv(sim, { cars: 6, seed: 5, stage: 5, randomize: true, area: 'train' });
    const act = new Float32Array(12);
    const o: [number, number] = [0, 0];
    for (let k = 0; k < 400; k++) {
      env.agents.forEach((a, i) => {
        baselineAction(a, o);
        act[i * 2] = o[0];
        act[i * 2 + 1] = o[1];
      });
      env.step(act);
    }
    const out = env.agents.map((a) => [a.frame.x, a.frame.z, a.s]);
    return JSON.stringify(out);
  };
  check(trace() === trace(), 'environment is deterministic (6 cars, traffic + lights, 400 decisions)');
}
process.exit(failed ? 1 : 0);
