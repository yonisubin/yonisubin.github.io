# Civilization

The second game in this repo, served at **https://yonisubin.github.io/civilization/**.
It is independent of the open-world game at the site root.

## Commands (run from the repo root)

```bash
npm run dev:civ        # dev server → http://localhost:5174/civilization/
npm run typecheck:civ  # tsc --noEmit on civilization/
npm run build:civ      # type-check + production build to civilization/dist/
npm run preview:civ    # serve that build → http://localhost:4174/civilization/
```

## How it stays separate from the main game

- **Own folder, own Vite config.** Everything lives in `civilization/` (`index.html`, `src/`,
  `vite.config.ts` with `base: '/civilization/'`). The root build (`npm run build`) never sees it,
  and the root game never imports from it. Never import across the two folders.
- **Shared `node_modules`.** There is no second `package.json`: it uses the root's TypeScript,
  Vite (and three.js, if wanted). Adding a dependency still needs asking first.
- **Separate deploy job.** `.github/workflows/deploy.yml` builds it in its own job
  (`build-civilization`, `continue-on-error`) and copies the result into `dist/civilization/`.
  If this game fails to build, the main game still deploys; only `/civilization/` is missing
  from that deploy.
- **Storage.** Both games share the `yonisubin.github.io` origin, so they share `localStorage`.
  Every key this game writes must start with `STORAGE_PREFIX` (`'civ:'`, in `src/main.ts`).
- **Asset paths.** Put static files in `civilization/public/` and reference them through
  `import.meta.env.BASE_URL`, so they resolve under `/civilization/`.
