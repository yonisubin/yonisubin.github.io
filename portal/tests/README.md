# Twinfold tests

Headless checks of the real game: each `*.test.cjs` opens the production build in Chromium
(Playwright), drives it through `window.twinfold` (end of `src/game/game.ts`: `twinfold.session` is the
GameSession, `twinfold.levels` the built-in levels, `twinfold.element(id)` an element, `twinfold.log`
every event emitted) and prints ✓ / ✗ per check.
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
| `props.test.cjs` | cubes come to rest; props dropped into a floor portal at 1 / 6 / 15 m/s leave five different exits with velocity and angular velocity rotated by M (speed kept, floor-exit boost); a cube thrown through a wall pair, with a clone while straddling; the prop infinite fall (capped at 38 m/s); standing on and pushing cubes; carrying (prompt, hold point, yaw lock, through a portal pair, forced drop, can't stand on what you hold) |
| `elements.test.cjs` | the sandbox loads and renders; all 8 floor-button combinations through and/or/not gates to a door and an indicator; cube-/sphere-only plates; the player on plates; the timer gate; pedestal countdown (ticks) and toggle; riding a platform; moving surfaces refuse portals; a panel closing its portal; the lift; once-triggers and checkpoints; entry and exit elevators (`exitReached` counters, `elevatorDone` after the ride); a cycling fixed portal with a one-colour device; `device: 'none'` |
| `hazards.test.cjs` | pellets bounce, expire and relaunch, go through portals into the catcher (which latches and stops the launcher) and kill; death → respawn in < 2 s at the autosave / last checkpoint; grills pass shots, erase portals, dissolve carried and loose cubes; toxic liquid, the bottomless pit and the crusher kill; damage and regeneration |
| `turrets.test.cjs` | idle → active (wind-up, bursts of 4–10 damage) → searching → idle; barks; knocked over → wild fire → shut down; carried from behind (no fire) vs from the front; dissolved by a grill; destroyed by a fall; the rocket turret (off until wired on, blasts hurt); a rocket redirected through portals into the boss core, then hit → detach → dispose ×3 → defeated |
| `session.test.cjs` | `chamberStart` + autosave; reloading leaves no colliders / bodies / scene objects behind; snapshot → restore → snapshot identical (carrying, pellet and timer running) and two restores have the same future; counters; pause; every setting takes effect; idle after 20 s; out of bounds; `respawn()` / `restartChamber()` |
