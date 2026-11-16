import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// The second game, served at https://yonisubin.github.io/civilization/.
// It shares the repo's node_modules (no package.json of its own) but nothing else:
// the open-world game at the site root is built separately and never imports from here.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/civilization/',
  server: { port: 5174 },
  preview: { port: 4174 },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
