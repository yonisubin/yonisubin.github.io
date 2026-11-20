// Bundle the Node entry points of the RL simulator (TypeScript → rl/dist/*.mjs) with rolldown,
// which Vite already ships. `npm run rl:build`.
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, '..', 'node_modules', '.bin', 'rolldown');
const entries = ['sim/worker.ts', ...readdirSync(join(here, 'scripts')).filter((f) => f.endsWith('.ts')).map((f) => `scripts/${f}`)];
for (const e of entries) {
  const name = e.split('/').pop().replace(/\.ts$/, '.mjs');
  execFileSync(bin, [join(here, e), '-o', join(here, 'dist', name), '--platform', 'node'], { stdio: ['ignore', 'ignore', 'inherit'] });
  console.log('built', name);
}
