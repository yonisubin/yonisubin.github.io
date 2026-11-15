// `npm test`: serve the production build (dist/) and run every tests/*.test.cjs in turn.
// It does NOT build: run `npm run build` first, or the tests check whatever dist/ holds.
// Set GAME_URL to test a server that's already running (e.g. the dev server) instead.
//
//   npm test                      serve dist/ on :4173, run all tests
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
const up = async (url) => {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
};
let server = null;
if (!process.env.GAME_URL) {
  process.env.GAME_URL = `http://localhost:${PORT}/`;
  // Something already answering on the port would be tested instead of this build.
  if (await up(process.env.GAME_URL)) {
    console.error(`Port ${PORT} is already in use (an old \`vite preview\`?). Stop it, or set GAME_URL to test that server.`);
    process.exit(1);
  }
  // Run vite's own script with node (not through npx), so kill() stops vite itself and this
  // works on Windows too.
  const vite = join(here, '..', 'node_modules', 'vite', 'bin', 'vite.js');
  server = spawn(process.execPath, [vite, 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', cwd: join(here, '..') });
  server.on('error', (e) => {
    console.error(`could not start vite preview: ${e.message}`);
    process.exit(1);
  });
  // Wait until it answers.
  for (let i = 0; ; i++) {
    if (await up(process.env.GAME_URL)) break;
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
