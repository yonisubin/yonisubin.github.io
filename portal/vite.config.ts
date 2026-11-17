import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// The third game, Twinfold, served at https://yonisubin.github.io/portal/.
// It shares the repo's node_modules (no package.json of its own) but nothing else:
// the open-world game at the site root and Hexborne (civilization/) never import from here.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/portal/',
  server: { port: 5175 },
  preview: { port: 4175 },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
