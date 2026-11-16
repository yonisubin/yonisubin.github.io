// `npm run test:civ`: serve Hexborne's production build (civilization/dist) and run every
// civilization/tests/*.test.cjs. It does NOT build: run `npm run build:civ` first.
//   npm run test:civ -- rules      only files whose name contains "rules"
//   CIV_URL=http://localhost:5174/civilization/ npm run test:civ   test a running dev server
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const filters = process.argv.slice(2);
const files = readdirSync(here)
  .filter((f) => f.endsWith('.test.cjs'))
  .filter((f) => !filters.length || filters.some((w) => f.includes(w)))
  .sort();

const PORT = 4174;
const up = async (url) => {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
};
let server = null;
if (!process.env.CIV_URL) {
  process.env.CIV_URL = `http://localhost:${PORT}/civilization/`;
  if (await up(process.env.CIV_URL)) {
    console.error(`Port ${PORT} is already in use (an old preview?). Stop it, or set CIV_URL to test that server.`);
    process.exit(1);
  }
  const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  server = spawn(process.execPath, [vite, 'preview', '--config', 'civilization/vite.config.ts', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', cwd: root });
  server.on('error', (e) => {
    console.error(`could not start vite preview: ${e.message}`);
    process.exit(1);
  });
  for (let i = 0; ; i++) {
    if (await up(process.env.CIV_URL)) break;
    if (i > 60) {
      console.error('vite preview did not start (is civilization/dist built? run `npm run build:civ`)');
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
