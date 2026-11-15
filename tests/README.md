# Tests

Headless checks of the real game in a browser: each `*.test.cjs` opens the built game in
Chromium (Playwright), drives it through `window.game` (see the end of `src/main.ts`) and
prints a ✓ / ✗ per check.

```bash
npm run build      # the tests run against dist/
npm test           # serves dist/ on :4173 and runs every test file
npm test -- police # only files whose name contains "police"
GAME_URL=http://localhost:5173/ npm test   # against a server you already run (e.g. npm run dev)
```

Playwright is not a dependency of the game. Install it once if your machine doesn't have it:
`npm install --no-save playwright && npx playwright install chromium`.

| File | What it checks |
|---|---|
| `world.test.cjs` | the forest pool holds the densest forest (no invisible tree colliders), unloading frees every pool slot and collider, same seed → same world, far-chunk build time |
| `police.test.cjs` | patrols, stars → pursuit, officers arrest you on foot (fine, police station), busted in a stopped car without being smashed, never busted while hovering, the chase thins when stars drop, busted-then-killed pays only the death penalty |
| `gameplay.test.cjs` | wreck cash at road height and collectable, dropped cash expires, a boat left on land doesn't fall when its ground unloads, menus don't unfreeze each other, P closes the look picker, carjacking Vera's target ends the mission, at most 4 carjacked cars kept, weapon models reused |
| `save.test.cjs` | progress survives a reload; corrupt or hostile saves fall back safely; New game |
| `jobs.test.cjs` | taxi, ambulance and delivery shifts end to end |
| `route.test.cjs` | A* is optimal (vs Dijkstra), off-road legs, trimming, re-routing, arrival |
| `sound.test.cjs` | audio starts on a click, plays when driving, one-shots clean up, a hidden tab suspends it, mute |

`game.simulate(seconds)` runs physics steps immediately, so tests don't depend on the headless
frame rate (a few frames per second). Tests that need wall-clock time (fades, audio) wait.
