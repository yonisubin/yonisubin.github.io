import RAPIER from '@dimforge/rapier3d-compat';
import { DrivingEnv, INFO_SIZE } from './env';
import { OBS_SIZE } from './observe';
import { SimWorld } from './world';

// A simulation worker for the Python trainer (rl/train/node_vec_env.py): one city, N cars,
// driven over stdin/stdout with tiny binary messages.
//
//   in:  'S' + N×2 float32 actions   → out: the step result (below)
//        'G' + int32 stage           → out: 1 byte (ack)
//        'O'                         → out: the step result with the current observations
//        'Q'                         → exit
//   out (step result, float32): obs N×OBS | reward N | done N | info N×INFO | terminal obs N×OBS
//
// Usage: node rl/dist/worker.mjs <cars> <seed> <stage> <train|test|any> <randomize 0|1>

const [cars, seed, stage] = process.argv.slice(2, 5).map(Number);
const area = (process.argv[5] ?? 'train') as 'train' | 'test' | 'any';
const randomize = process.argv[6] !== '0';

await RAPIER.init();
const sim = new SimWorld();
const env = new DrivingEnv(sim, { cars, seed, stage, randomize, area });

const N = cars;
const out = new Float32Array(N * OBS_SIZE * 2 + N * 2 + N * INFO_SIZE);
function writeResult(): void {
  let k = 0;
  out.set(env.obs, k);
  k += N * OBS_SIZE;
  out.set(env.reward, k);
  k += N;
  for (let i = 0; i < N; i++) out[k + i] = env.done[i];
  k += N;
  out.set(env.info, k);
  k += N * INFO_SIZE;
  out.set(env.terminalObs, k);
  process.stdout.write(Buffer.from(out.buffer));
}

let buf: Buffer = Buffer.alloc(0);
const actions = new Float32Array(N * 2);
process.stdin.on('data', (chunk: Buffer) => {
  buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
  for (;;) {
    if (!buf.length) return;
    const op = String.fromCharCode(buf[0]);
    if (op === 'S') {
      const need = 1 + N * 8;
      if (buf.length < need) return;
      for (let i = 0; i < N * 2; i++) actions[i] = buf.readFloatLE(1 + i * 4);
      buf = buf.subarray(need);
      env.step(actions);
      writeResult();
    } else if (op === 'G') {
      if (buf.length < 5) return;
      env.setStage(buf.readInt32LE(1));
      buf = buf.subarray(5);
      process.stdout.write(Buffer.from([1]));
    } else if (op === 'O') {
      buf = buf.subarray(1);
      env.reward.fill(0);
      env.done.fill(0);
      env.info.fill(0);
      writeResult();
    } else if (op === 'Q') {
      process.exit(0);
    } else {
      throw new Error(`worker: unknown op ${op}`);
    }
  }
});
process.stdin.on('end', () => process.exit(0));
