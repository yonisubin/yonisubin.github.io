import { readFileSync } from 'node:fs';
import { Policy } from '../../src/ai/policy';
// Time one forward pass of the driving policy (1 car), as the game runs it.
const buf = readFileSync(process.argv[2]);
const p = Policy.fromBinary(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const obs = new Float32Array(71).map(() => Math.random());
const out = new Float32Array(2);
for (let i = 0; i < 2000; i++) p.act(obs, 1, out);
const t0 = performance.now();
for (let i = 0; i < 20000; i++) p.act(obs, 1, out);
console.log('act  ms per car', ((performance.now() - t0) / 20000).toFixed(4));
const ref = Array.from(p.act(obs, 1, out));
for (let i = 0; i < 2000; i++) p.act1(obs, out);
const t1 = performance.now();
for (let i = 0; i < 20000; i++) p.act1(obs, out);
console.log('act1 ms per car', ((performance.now() - t1) / 20000).toFixed(4), 'max diff', Math.max(Math.abs(out[0] - ref[0]), Math.abs(out[1] - ref[1])));
