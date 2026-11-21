import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { SimWorld } from '../sim/world';
import { DECISION_DT, DrivingEnv, Info, INFO_SIZE, STAGES } from '../sim/env';
import { OBS_SIZE, observe } from '../../src/ai/observe';
import { baselineAction } from '../../src/ai/baseline';
import { Policy, type PolicyWeights } from '../../src/ai/policy';

// Evaluate drivers on fixed, seeded routes that start in the held-out south-east of the city
// (training never starts a route there):
//   empty  — random city routes, no other traffic (stage 3 conditions), 200 routes
//   heavy  — rule-based traffic, stopped cars, lights (stage 6 conditions, more traffic), 200 routes
//
// node rl/dist/eval.mjs rl/viewer/public/policies/final.json [more policies…]  → rl/results/eval.{json,md}

await RAPIER.init();
// One world for every run; each run starts from a fresh copy so results don't depend on what
// ran before (Rapier replays identically only for identical insertion histories).
const base = new SimWorld();
const EPISODES = Number(process.env.EPISODES ?? 200);

interface Metrics {
  episodes: number;
  success: number;
  crash: number;
  offroad: number;
  redLight: number;
  timeout: number;
  km: number;
  laneSq: number;
  laneN: number;
  steerChange: number;
  seconds: number;
  speedFrac: number;
  speedN: number;
  speeding: number;
  /** Yaw rate² summed where the route ahead is straight (weaving), and the count. */
  weaveSq: number;
  weaveN: number;
  /** Stopped at a red light: distance from the stop line, summed, and the count. */
  redGap: number;
  redN: number;
  inferMs: number;
  decisions: number;
}

type Driver = { name: string; act: (env: DrivingEnv, out: Float32Array) => void };

function run(driver: Driver, set: 'empty' | 'heavy'): Metrics {
  const sim = new SimWorld(undefined, { layout: base.layout, terrain: base.terrain });
  const stage = set === 'empty' ? 2 : 6;
  const cars = set === 'empty' ? 8 : 4;
  const env = new DrivingEnv(sim, { cars, seed: set === 'empty' ? 101 : 202, stage, randomize: false, area: 'test' });
  if (set === 'heavy') env.stage = { ...STAGES[6], traffic: 18 };
  let next = 0;
  const seedOf = (k: number) => 50_000 + k * 7919;
  const owner: number[] = [];
  for (let i = 0; i < cars; i++) {
    owner[i] = next;
    env.spawn(i, seedOf(next++));
    env.sense(i);
  }
  const m: Metrics = { episodes: 0, success: 0, crash: 0, offroad: 0, redLight: 0, timeout: 0, km: 0, laneSq: 0, laneN: 0, steerChange: 0, seconds: 0, speedFrac: 0, speedN: 0, speeding: 0, weaveSq: 0, weaveN: 0, redGap: 0, redN: 0, inferMs: 0, decisions: 0 };
  const act = new Float32Array(cars * 2);
  const prevSteer = new Float32Array(cars);
  while (m.episodes < EPISODES) {
    const t0 = performance.now();
    driver.act(env, act);
    m.inferMs += performance.now() - t0;
    m.decisions += cars;
    env.step(act);
    for (let i = 0; i < cars; i++) {
      if (owner[i] >= EPISODES) continue;
      const a = env.agents[i];
      if (!env.done[i]) {
        m.laneSq += a.lat * a.lat;
        m.laneN++;
        m.steerChange += Math.abs(act[i * 2] - prevSteer[i]);
        m.seconds += DECISION_DT;
        const lim = a.path.limit[a.path.index(a.s)];
        m.speedFrac += Math.max(0, a.vFwd) / lim;
        m.speedN++;
        if (a.vFwd > lim + 1) m.speeding++;
        // Weaving: turning while the next 40 m of route are straight (curve limit > 25 m/s).
        if (a.path.curveLimit(a.s, 40) > 25 && a.vFwd > 3) {
          m.weaveSq += a.yawRate * a.yawRate;
          m.weaveN++;
        }
        // Waiting at a red light: how far short of the line (only when nothing in front within 12 m).
        if (a.light === 'red' && a.stopDist < 60 && Math.abs(a.vFwd) < 0.3) {
          let blocked = false;
          for (let r = 5; r <= 9; r++) if (a.rays.dist[r] < 12 && Math.abs(a.rays.dist[r] * Math.sin(((r - 7) * Math.PI) / 14)) < 1.6) blocked = true;
          if (!blocked) {
            m.redGap += a.stopDist;
            m.redN++;
          }
        }
        prevSteer[i] = act[i * 2];
        continue;
      }
      const o = i * INFO_SIZE;
      m.episodes++;
      m.success += env.info[o + Info.Success];
      m.crash += env.info[o + Info.Crash];
      m.offroad += env.info[o + Info.Offroad];
      m.redLight += env.info[o + Info.RedLight];
      m.timeout += env.info[o + Info.Timeout];
      prevSteer[i] = 0;
      owner[i] = next;
      // The env already respawned this car at random; put it on the next fixed route instead.
      env.spawn(i, seedOf(next++));
      env.sense(i);
    }
    // Distance: accumulate from the agents' odometers at episode ends is awkward with
    // respawns, so integrate speed instead.
    for (let i = 0; i < cars; i++) if (owner[i] < EPISODES && !env.done[i]) m.km += (Math.max(0, env.agents[i].vFwd) * DECISION_DT) / 1000;
  }
  sim.world.free();
  return m;
}

function policyDriver(file: string): Driver {
  const w = JSON.parse(readFileSync(file, 'utf8')) as PolicyWeights;
  const p = new Policy(w);
  const name = `RL (${(w.steps / 1e6).toFixed(1)}M steps)`;
  return {
    name,
    act(env, out) {
      // Observations rebuilt here: the eval respawns cars by hand onto its fixed routes.
      p.act(observeAll(env), env.agents.length, out);
    },
  };
}

function observeAll(env: DrivingEnv): Float32Array {
  const obs = new Float32Array(env.agents.length * OBS_SIZE);
  env.agents.forEach((a, i) => observe(a, obs, i * OBS_SIZE));
  return obs;
}

const baseline: Driver = {
  name: 'Baseline (pure pursuit + PID)',
  act(env, out) {
    const o: [number, number] = [0, 0];
    env.agents.forEach((a, i) => {
      baselineAction(a, o);
      out[i * 2] = o[0];
      out[i * 2 + 1] = o[1];
    });
  },
};

const drivers: Driver[] = [baseline, ...process.argv.slice(2).map(policyDriver)];
const results: Record<string, Record<string, Metrics>> = {};
for (const set of ['empty', 'heavy'] as const) {
  for (const d of drivers) {
    const t0 = performance.now();
    const m = run(d, set);
    (results[d.name] ??= {})[set] = m;
    console.log(set, d.name, `${((performance.now() - t0) / 1000).toFixed(0)}s`, `success ${((m.success / m.episodes) * 100).toFixed(1)}%`);
  }
}

const pct = (a: number, b: number) => `${((a / b) * 100).toFixed(1)}%`;
const lines: string[] = [];
for (const set of ['empty', 'heavy'] as const) {
  lines.push(`### ${set === 'empty' ? 'Empty roads (random city routes)' : 'Heavy traffic (rule-based cars, stopped cars, traffic lights)'}`, '');
  lines.push('| Driver | Route completion | Crashes | Off road | Red lights | Timeouts | Collisions / km | Mean speed (% of limit) | Time over limit | Lane deviation RMS (m) | Steering change / s | Weave (yaw rate RMS on straights, rad/s) | Gap to the line at a red, clear lane (m) | Inference (ms / car / decision, Node) |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const d of drivers) {
    const m = results[d.name][set];
    lines.push(
      `| ${d.name} | ${pct(m.success, m.episodes)} | ${m.crash} | ${m.offroad} | ${m.redLight} | ${m.timeout} | ${(m.crash / Math.max(1e-6, m.km)).toFixed(2)} | ${((m.speedFrac / m.speedN) * 100).toFixed(0)}% | ${pct(m.speeding, m.speedN)} | ${Math.sqrt(m.laneSq / m.laneN).toFixed(2)} | ${(m.steerChange / m.seconds).toFixed(2)} | ${Math.sqrt(m.weaveSq / Math.max(1, m.weaveN)).toFixed(3)} | ${m.redN ? (m.redGap / m.redN).toFixed(1) : '–'} | ${(m.inferMs / m.decisions).toFixed(3)} |`,
    );
  }
  lines.push('', `${EPISODES} episodes each, routes starting in the held-out south-east (x > 450 m, z > 450 m).`, '');
}
mkdirSync('rl/results', { recursive: true });
writeFileSync('rl/results/eval.json', JSON.stringify(results, null, 2));
writeFileSync('rl/results/eval.md', lines.join('\n'));
console.log(lines.join('\n'));
