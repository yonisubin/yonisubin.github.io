# Hexborne tests

Headless checks of the real game: each `*.test.cjs` opens the production build in Chromium
(Playwright), drives it through `window.hexborne` (end of `src/main.ts`) and prints ✓ / ✗ per check.

```bash
npm run build:civ                  # the tests run against civilization/dist
npm run test:civ                   # serves it on :4174 and runs every test file
npm run test:civ -- rules          # only files whose name contains "rules"
CIV_URL=http://localhost:5174/civilization/ npm run test:civ   # against a running dev server
```

Playwright is not a dependency; install it once if needed:
`npm install --no-save playwright && npx playwright install chromium`.

| File | What it checks |
|---|---|
| `rules.test.cjs` | growth and damage formulas, path costs (flat vs road), rivers, zone of control, one unit per tile, founding (distance rule, 7 tiles, capital), growth/production/research over turns, melee and ranged combat, capturing a city |
| `ai.test.cjs` | a 150-turn six-AI game: everyone expands, researches, improves land, goes to war; same seed → same game |
| `save.test.cjs` | IndexedDB save → load gives back the identical game; saves show on the setup screen |
| `ui.test.cjs` | Play now, B founds a city, End Turn prompts for research then production, the turn runs in the worker, tooltips, tech tree |

`window.flatten(state, tile, radius)` (installed by `harness.cjs`) turns an area into empty
grassland and removes all units and cities, for scenario tests.
