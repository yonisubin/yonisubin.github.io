# Twinfold tests

Headless checks of the real game: each `*.test.cjs` opens the production build in Chromium
(Playwright), drives it through `window.twinfold` (end of `src/main.ts`) and prints ✓ / ✗ per check.
`twinfold.simulate(seconds)` runs fixed 60 Hz physics steps immediately, so results don't depend
on the (very slow) headless frame rate.

```bash
npm run build:portal                  # the tests run against portal/dist
npm run test:portal                   # serves it on :4175 and runs every test file
npm run test:portal -- travel         # only files whose name contains "travel"
PORTAL_URL=http://localhost:5175/portal/ npm run test:portal   # against a running dev server
```

Playwright is not a dependency; install it once if needed:
`npm install --no-save playwright && npx playwright install chromium`.

| File | What it checks |
|---|---|
| `transform.test.cjs` | the teleport transform: position / velocity / orientation round trips A→B→A over 200 random portal pairs, speed preserved, entering A's front exits B's front |
| `movement.test.cjs` | eye height, walk speed 4.5 m/s, fast ground friction, jump height 1.1 m, crouch (height, 1/3 speed, standing up), stepping onto a 0.4 m crate, air control that steers but never brakes |
| `placement.test.cjs` | white panels take portals; metal and glass fizzle; failed shots leave portals alone; nudging (wall bottom → floor line, clear of a pillar); re-firing moves; overlap with the other portal; faces too small; floor portals face along the view |
| `travel.test.cjs` | walking through a wall pair (speed and facing kept), the infinite fall (loops, reaches and holds 38 m/s), the fling over the 6 m chasm, the minimum exit speed out of floor portals, the camera rolling back upright within ~0.5 s |
| `render.test.cjs` | a lone portal draws no window; facing portals recurse exactly to the depth limit (one view per level); the depth setting; portals out of view cost nothing; no flash of the wall behind a portal on any frame while walking through |
