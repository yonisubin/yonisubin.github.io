// `npm test`: serve the production build (dist/) and run every tests/*.test.cjs in turn.
// Set GAME_URL to test a server that's already running (e.g. the dev server) instead.
//
//   npm test                      build, serve on :4173, run all tests
//   npm test -- police save       only tests whose file name contains "police" or "save"

import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const filters = process.argv.slice(2);
const files = readdirSync(here)
  .filter((f) => f.endsWith('.test.cjs'))
  .filter((f) => !filters.length || filters.some((w) => f.includes(w)))
  .sort();

const PORT = 4173;
let server = null;
if (!process.env.GAME_URL) {
  server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', cwd: join(here, '..') });
  process.env.GAME_URL = `http://localhost:${PORT}/`;
  // Wait until it answers.
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(process.env.GAME_URL)).ok) break;
    } catch {
      // not up yet
    }
    if (i > 60) {
      console.error('vite preview did not start (is dist/ built? run `npm run build`)');
      server.kill();
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

const failed = [];
for (const file of files) {
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [join(here, file)], { stdio: 'inherit', env: process.env });
    child.on('exit', (c) => resolve(c ?? 1));
  });
  if (code !== 0) failed.push(file);
}
server?.kill();
console.log(`\n${files.length - failed.length}/${files.length} test files passed${failed.length ? ` — failed: ${failed.join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
