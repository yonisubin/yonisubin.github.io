# Hexborne

A turn-based, hex-map strategy game in the browser: found cities, grow an empire, research
technologies, fight rivals and barbarians. Served at **https://yonisubin.github.io/civilization/**.
It's independent of the open-world game at the site root. Rules and design: `CLAUDE.md`.

## Commands (run from the repo root)

```bash
npm run dev:civ        # dev server → http://localhost:5174/civilization/
npm run typecheck:civ  # tsc --noEmit on civilization/
npm run build:civ      # type-check + production build to civilization/dist/
npm run preview:civ    # serve that build → http://localhost:4174/civilization/
npm run test:civ       # headless checks (build first; needs Playwright) — see tests/README.md
```

## How to play

- **Play now** starts a game on a tiny continents map; *Set up a game* picks civilization, map, size,
  difficulty, pace and seed.
- Click a unit to select it, then click (or right-click) a tile to move or attack. Hover a tile for
  its yields, a move's cost, or a full combat preview.
- The Settler founds a city (**B**). Click a city to choose what it builds, buy things with gold,
  set its citizens' focus, lock tiles and buy tiles next to its border.
- The **End Turn** button tells you what still needs a decision (research, production, a captured
  city, a promotion). Other civilizations then play their turns.
- **T** tech tree · **Y** yield icons · **Relations** for war and peace · **Menu** to save and load.
  Full controls are under Menu → Controls.
- Win by holding every other civilization's original capital (domination), or by having the
  best score when the turn limit is reached.

## What's in it (phases 1–6 of the spec)

Seeded world generation (continents or pangaea, rivers on hex edges, resources, ruins, barbarian
camps), fog of war, A* movement with roads, rivers, zones of control and one military + one
civilian unit per tile, Settlers and Workers, cities (citizens, growth, production queue with
overflow, buying, culture borders, buying tiles, 21 buildings + uniques), 41 techs from Ancient to
Renaissance, happiness and luxuries, combat (melee, ranged, siege, cities; terrain, rivers,
flanking, fortify), XP and promotions, upgrades, city capture (annex / puppet / raze), barbarians,
ancient ruins, six original civilizations with abilities and unique units/buildings, a utility AI,
a simple war/peace switch, autosave and named saves.

Not yet (later phases of the spec): policies, golden ages, great people, wonders, religion,
diplomacy screens, city-states, trade routes, naval and air units, tourism, World Congress,
espionage, other victory types, multiplayer.

## How it stays separate from the main game

- **Own folder, own Vite config.** Everything lives in `civilization/` (`index.html`, `src/`,
  `vite.config.ts` with `base: '/civilization/'`). The root build (`npm run build`) never sees it,
  and the root game never imports from it. Never import across the two folders.
- **Shared `node_modules`.** There is no second `package.json`; `pixi.js`, `zod` and `zustand` in
  the root `package.json` are only used here. Adding a dependency still needs asking first.
- **Separate deploy job.** `.github/workflows/deploy.yml` builds it in its own job
  (`build-civilization`, `continue-on-error`) and copies the result into `dist/civilization/`.
  If this game fails to build, the main game still deploys; only `/civilization/` is missing
  from that deploy.
- **Storage.** Both games share the `yonisubin.github.io` origin. Saves use IndexedDB database
  `hexborne`; any `localStorage` key starts with `civ:`.
- **Asset paths.** Put static files in `civilization/public/` and reference them through
  `import.meta.env.BASE_URL`, so they resolve under `/civilization/`.

## Multiplayer

- **Hotseat:** on the setup screen open *Hotseat* and name a seat per player. Players take their turns one after another on the same device; a cover screen hides the map between seats.
- **Online:** GitHub Pages only serves files, so online games go through a small relay server (Node, no dependencies): `npm run server:civ` (port 8787, or `node civilization/server/server.mjs <port>`). It also serves the built game at `http://<that-computer>:8787/civilization/` (after `npm run build:civ`), so on a LAN everyone can open that address. One player clicks *Host a game*, the others *Join a game* with the room code; the host's browser runs the game (and the AI) and the others' actions go through it. Turn modes (Advanced setup): one after another, simultaneous, or hybrid (simultaneous unless two humans are at war). A player who drops out can rejoin with the same name and room code.
- Playing over the internet needs the relay on a reachable host; a page loaded over `https` (like GitHub Pages) can only reach `wss://` servers or `ws://localhost`, so put the relay behind TLS (any reverse proxy or tunnel) or open the game from the relay itself.
