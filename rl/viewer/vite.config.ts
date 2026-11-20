import { defineConfig } from 'vite';

// The RL viewer: a separate page (not part of the game or its deploy). `npm run rl:viewer`.
export default defineConfig({
  root: import.meta.dirname,
  base: './',
  server: { port: 5190, fs: { allow: ['../..'] } },
  build: { outDir: 'dist', emptyOutDir: true },
});
