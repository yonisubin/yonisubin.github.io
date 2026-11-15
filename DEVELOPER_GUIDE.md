# Developer guide: how this game is built, and why

This document explains the whole codebase: what each part does, which libraries it uses, how the parts talk to each other, and the decisions (and trade-offs) behind them. Read it top to bottom once; after that, use it as a map. `CLAUDE.md` is the short rules file; this is the long explanation.

---

## 1. The big picture

A single-player open-world game that runs entirely in the browser. You walk, swim, drive cars and fly a helicopter through a procedurally generated ~4 × 4 km world (a downtown, suburbs, villages, farmland, forested hills with a lake, a beach and the sea), streamed in around you. There's traffic, pedestrians, a day/night cycle, gun stores, hospitals, combat and missions. No server: it's a folder of static files hosted on GitHub Pages at the root of `https://yonisubin.github.io/`.

**Everything procedural except people.**
- Buildings, roads, terrain, water, trees, cars, the helicopter and all textures are generated in code. This keeps the download small and avoids licensing issues.
- The only downloaded art is the people: 15 CC0 characters, about 3 MB in total.

### How the work was done (history)

The project followed the milestones in `CLAUDE.md`, one commit each, then gameplay layers on top. `git log` tells the story:

| Commit | What it added |
|---|---|
| `b5627a6` | Vite + TypeScript scaffold, Milestone 1 (walking), GitHub Pages deploy workflow |
| `2c9e533` | Removed the old personal website; the repo is now only the game |
| `66938e6` | Touch controls for phones (floating joystick, drag-to-look, buttons) |
| `2beb065` | Milestone 2: procedural city, animated character, realistic lighting |
| `853f4c6`, `cd61d5c` | Lighting fixes, including the phone "black surfaces" bug (see §4.7) |
| `4dcf874` | Milestone 3: drivable cars (ray-cast vehicle physics) |
| `1f9cc09` | Milestone 4: helicopter (collective / cyclic / tail rotor) |
| `e396186` | Milestone 5a: NPC traffic with traffic lights; pedestrians |
| `ec0b229` | Milestone 5b: day/night cycle and minimap |
| `d2c710a` | Health, damage, money, gun store |
| `8ed2419` | Combat; chatting with pedestrians |
| `1d8b5af` | Carjacking |
| `24e6208` | Economy rebalance (prices vs. how fast you earn cash) |
| `779b6d6` | Weapon add-ons (scope, grip, AP rounds); shootable traffic cars |
| `1357591` | Mission givers and four mission types |
| `2d1ffe0` | Optional Mixamo character pipeline (guide + FBX→GLB converter) |
| `d4cd158`, `db24f61` | 15 CC0 Quaternius characters, recolouring, character picker; Soldier model removed |
| `334082c` | Natural walking (gait fixes) and knock-outs that lie flat |
| `f469ea8` | The 4 km world: zones, terrain, country roads, streaming chunks, instance pools, distant terrain; sea, lake, waves and swimming |
| `543da38` | Vehicles that drive or land in deep water eject you, wreck and sink |
| `a258943` | Hospitals (respawn at the nearest one) and five more gun stores |
| `2497a27` | Full-screen world map (M or tap the minimap) |
| `e73e0fd` | Hilly towns (sidewalks draped over the hills), more relief in the country, five new mission givers around the map |
| `fbf08cd` | Realistic traffic (IDM car following, driver personalities, lane changes, overtaking, brake lights); a short-lived "road warp" that bent the grid (replaced next) |
| *(next)* | American suburbs and winding country roads: a free-form street network (arterials, subdivisions, loops, cul-de-sacs), houses on lots, strip malls, gas stations, big-box stores, schools, parks, churches, parked cars; traffic and pedestrians on the new network |

---

## 2. Tools and libraries

Only two runtime dependencies. Everything else is either a build tool or our own code.

| Library | Role | Why this one |
|---|---|---|
| **TypeScript** (strict) | Language | Catches mistakes before running. `tsconfig.json` also turns on `noUnusedLocals` / `noUnusedParameters`. |
| **Vite** | Dev server and production bundler | Instant reloads in development; `npm run build` produces a small static `dist/`. `vite.config.ts` only sets `base: '/'` (the site root). |
| **three.js** | 3D rendering (WebGL 2) | The standard browser 3D library. Used for meshes, instancing, shaders, skinned/animated characters, the physical sky, shadows and tone mapping. |
| **Rapier** (`@dimforge/rapier3d-compat`) | Physics | Fast physics engine compiled to WebAssembly. The **compat** build embeds the WASM inside the JavaScript, which avoids Vite's WASM-loading issues. It provides rigid bodies, colliders, ray casts, a **kinematic character controller** (walking) and a **ray-cast vehicle controller** (cars). |
| `@gltf-transform/*`, `fbx2gltf` (dev only) | Asset build scripts | Convert and optimise character models offline. Never shipped to players. |
| **Playwright** (pre-installed in the dev environment, not a project dependency) | Automated testing | Headless Chromium drives the real game through `window.game` (see §11). |

**Deployment.** `.github/workflows/deploy.yml` runs on every push to `main`: `npm ci`, then `npm run build`, then the official Pages actions publish `dist/`. Repo setting: Pages → Source = "GitHub Actions".

**Rule:** no new dependencies without asking. Things a library might do (seeded random numbers, textures, UI) are written by hand in a few dozen lines.

---

## 3. Core architecture (read this first)

### 3.1 The game loop and the fixed timestep (`src/main.ts`)

Physics must not depend on frame rate. A 30 fps phone and a 144 Hz monitor should behave identically. So:

- **Physics steps at exactly 60 Hz** (`PHYSICS_STEP = 1/60`).
- Each rendered frame, the real elapsed time is added to an **accumulator**. We run as many whole physics steps as fit and keep the remainder. Elapsed time is capped at 0.25 s (`MAX_FRAME_TIME`) so a background tab doesn't cause a "spiral of death".
- **Rendering interpolates.** `alpha = accumulator / PHYSICS_STEP` says how far "now" is between the last two physics states. Meshes are drawn blended between them, so motion is smooth even when the frame rate and the physics rate don't line up.

One physics step (`step()` in `main.ts`) does this, in order:

```
player.update(dt)            // the active mode reads input, sets forces / controls
entities.fixedUpdate(dt)     // vehicles, NPCs, stats, missions… apply their logic
world.step()                 // Rapier advances the simulation
entities.afterStep()         // record the new physics poses for interpolation
```

Then, once per frame:
1. `entities.render(alpha)`
2. `player.render(alpha)` (cameras last, so they follow the already-placed meshes)
3. Sky, HUD, minimap, dialogue, picker
4. `renderer.render()`

### 3.2 `SimEntity` and `BodyInterpolator` (`src/sim/entity.ts`)

Anything simulated implements `SimEntity { fixedUpdate, afterStep, render }`. `BodyInterpolator` stores a rigid body's previous and current pose (`capture()` after each step) and blends them at render time. `snap()` forgets the previous pose after a teleport, so we don't interpolate across the jump.

**Rule: physics owns transforms.** A mesh with a physics body is never moved directly. You move the body; the mesh copies it.

### 3.3 The player state machine (`src/player/state.ts`)

Exactly one `PlayerMode` is active: `OnFootMode`, `DrivingMode` (one per car) or `FlyingMode`. Each mode owns:
- its controller and its camera rig;
- `enter()`, `exit()`, `update(dt)` (physics step) and `render(alpha, dt)`;
- `focus()`: where the "player" is, used by the sky, minimap and NPC pools;
- `prompt()` ("E — drive"), `status()` (speed/altitude), `controlsHint`;
- `touchButtons`: which on-screen buttons it needs;
- optionally `scopedIn()`.

Getting into a car is `player.setMode(car.mode)`. Nothing else in the game asks "is the player driving?". Input and camera simply go to whichever mode is active. This rule keeps features from tangling.

### 3.4 Abstract input (`src/input/actions.ts`, `src/input/touch.ts`)

Controllers never read raw keys. They ask about **actions**:
- **Movement and combat:** `moveForward/Back/Left/Right`, `run`, `jump`, `interact`, `handbrake`, `ascend`, `descend`, `attack`, `aim`, `aimToggle`, `nextWeapon`.
- **Dialogue choices:** `choice1–3`.
- **Swimming:** `dive` (C / Ctrl; the DIVE button on touch). Space (`jump`) swims up.
- **Menus and toggles:** `characterMenu` (P), `timeSkip` (T), `toggleMap` (M: the full map), `toggleDebug`.

All key bindings live in one table in `actions.ts`. It uses `KeyboardEvent.code` (physical key position), so WASD stays put on Hebrew or AZERTY layouts. One key can mean different things per mode (Space = jump / handbrake / climb); each mode only reads the actions it cares about.

**Touch** (`touch.ts`) feeds the *same* `Input`:
- **Left half:** a floating joystick. Pushing it past 85% runs.
- **Right half:** drag to look.
- **Buttons:** stacked bottom-right, whatever the current mode asks for (JUMP, DRIVE, BRAKE, UP/DOWN, EXIT, ATTACK…).

Pointer Events with per-finger tracking allow moving and looking at once. `isTouchDevice()` checks for a coarse primary pointer, so touchscreen laptops keep mouse controls.
- **Never pointer lock on touch.** `Input.requestPointerLock()` does nothing on a coarse pointer. Android Chrome grants pointer lock from a tap, and then every touch goes to the locked canvas instead of the joystick. That was the "no control after closing the map" bug: the map and the look picker request pointer lock as they close, to put desktop players back into mouse look.
- **Self-healing finger slots.** The stick and look each remember their finger. A slot is freed on `pointerup`, `pointercancel` and `lostpointercapture`, and a slot whose finger we no longer see is taken over by the next touch. The map and the picker also call `TouchControls.reset()` when they open or close, since fingers lifted over a menu never reach the touch layer.

Other `Input` features:
- `moveAxis()` merges keys and the stick.
- `setBlocked()` freezes input while menus or the death screen are up.
- Pointer lock handles mouse look on desktop (the "Click to play" overlay exists because browsers only grant pointer lock after a click).

### 3.5 Conventions

- **SI units:** metres, kilograms, seconds, radians. **Y is up.**
- People face **−Z** at yaw 0.
- Vehicles use body space **+X forward, +Y up, +Z right**, because Rapier's vehicle controller expects that.
- **Determinism:** the world comes from a seeded PRNG and noise (`CITY_SEED = 1337`), so it is the same every time.

---

## 4. The world (`src/world/`)

The world grew from a 640 m city (8 × 8 blocks) to a **~4 × 4 km world** with towns, countryside, a lake and a beach. The 640 m city could be built all at once at startup. A world 40× larger can't, so it's split in two:

- **World data** (`layout.ts`, `terrain.ts`): generated for everything at startup. It's cheap: plain numbers and lists, with no meshes and no physics.
- **Meshes and colliders** (`chunks.ts`): built only for the chunks around the player, and removed again when they're far away (streaming).

### 4.1 Layout: cells, zones, roads, blocks (`layout.ts`, `rng.ts`)

The world is a grid of **52 × 52 cells**, each 78 m (`PITCH`), each with a zone. Downtown's road centre lines sit on the grid lines (multiples of 78 m; line 26 runs through the origin). Everything else's roads are free-form (§4.1b). North is −Z.

**Each cell has a zone:**

| Zone | Where | What's in it |
|---|---|---|
| `downtown` | the centre, ±400 m | towers: a block of sidewalk + lot with glass/brick/concrete buildings, in a gentle valley |
| `suburb` | a ring out to ~1 km (stretched south) | American subdivisions: winding streets, cul-de-sacs, houses on lots; strip malls, gas stations, schools, parks, churches on the arterials |
| `beachtown` | the row just north of the coastal road, centre | a strip of pastel shops facing the coastal road, houses behind |
| `village` | 3 spots in the countryside (Eastfield, Westbrook, Pinecrest) | a main street with shops, a few side streets with houses |
| `farm` | east, west and south countryside | open fields; now and then a red barn + farmhouse |
| `forest` | north of ~−700 m | hills covered in low-poly trees |
| `lake` | an ellipse in the northern hills | water |
| `beach` | south of the coastal road (line 46) | sand, then the sea |

**Downtown** is blocks exactly like the original city:
- each block is 64 m: a 56 m lot plus 4 m sidewalks, on a 15 cm curb slab, with towers (`generateBlock`);
- its roads are 14 m wide (two 3.5 m lanes each way), with lights at every crossing.

Countryside features (forest trees, farmsteads, hedgerow trees) are generated **per cell when its chunk is built** (`ruralFeatures`). That keeps startup fast, since there are tens of thousands of forest trees.

### 4.1b The street network and the suburbs (`streets.ts`, `suburbs.ts`)

Outside downtown, roads aren't on a grid. **Every road in the world lives in one graph** (`StreetNet`), in world coordinates:
- **Nodes:** junctions, dead ends and cul-de-sac bulbs, each with its control: `lights`, `stop` (smaller roads give way) or `none`.
- **Edges:** a polyline (a point every 5–8 m) and a road class (`ROAD_SPECS`):

| Class | Width | Lanes each way | Sidewalk | Speed | Where |
|---|---|---|---|---|---|
| `downtown` | 14 m | 2 | (block slabs) | 45 km/h | downtown grid |
| `arterial` | 14 m | 2 | 2 m | 60 km/h | the suburbs' main roads |
| `collector` | 10 m | 1 | 1.8 m | 43 km/h | the road through a subdivision; village main streets |
| `local` | 8 m | 1 | 1.6 m | 36 km/h | residential streets, cul-de-sacs |
| `rural` | 8 m | 1 | — | 68 km/h | country roads |

**How it's generated** (`generateStreets`, deterministic, ~200 ms at startup). It follows how American sprawl is laid out (Plano, Phoenix suburbs, Irvine):
1. **Arterials** on a rough half-mile super-grid (lines every 470 m, continuing downtown's edge lines outward). Each line is a smooth curve through control points ~170 m apart, pushed sideways by a random amount: ±20 m in town (nearly straight), up to ±115 m in the country, where it picks the offset with the gentlest climb from the last point (so country roads follow valleys and contours). Lines are cut at the lake, and classed `arterial` in or beside town, `rural` elsewhere (smoothed so a road doesn't flicker between the two).
2. **Villages:** a gently curved main street through the middle, joined at both ends to the nearest roads by winding country connectors, with shops along it and two or three side streets.
3. **Superblocks**, the land between arterials, where it's mostly suburb:
   - **Commercial corners:** where two arterials cross, a strip mall (one-storey row of shops at the back, a striped parking lot in front), a gas station, or now and then a big-box store with a huge lot. Parcels shrink and slide until they fit.
   - **Civic frontage:** schools (L-shaped building, a car park, a playing field), churches (with a steeple), parks (lawn, trees, a pond), mid-block strip malls and gas stations, facing the arterial with entrance driveways.
   - **The subdivision:** 2–4 entrances off the arterials. From each, a **walker** grows a collector road: it steps 15–18 m at a time and turns a little each step (a random walk on the turn rate, so curves tighten and relax and never repeat like a wave). It stops before crossing a road or leaving the superblock, joins a street close ahead (a loop), or ends in a **cul-de-sac** bulb. Local streets branch off every 60–110 m; about a third are **loop streets** that curl round and rejoin their parent. An infill pass sprouts more local streets wherever open land is left.
   - **Houses** on lots along both sides of every local street and collector (~20 m frontage, set back 5–9 m, a driveway, a back-yard tree), and pie-shaped lots round cul-de-sacs. Houses face their street at whatever angle it runs and never face the arterials (they back onto them).
   - **Beach town:** a row of shops along the coastal road.
4. **The builder** (`NetworkBuilder`) turns all the polylines into the graph: it finds every crossing, puts a node wherever a street joins another (a T-junction), splits lines into edges, removes stubs, prunes about a third of the country-road links between junctions (only where everything stays connected) to break up the pattern, and sets junction control: lights where two big roads cross, stop signs on the smaller road elsewhere.

**Helpers:**
- `SegmentIndex`: a spatial hash of road segments. It gives `net.distance()`, `net.kerb()` (distance to the nearest kerb, cul-de-sacs included, and that road's sidewalk width), `net.nearest()` and roads near a point.
- `Raster`: a 4 m occupancy grid over the world (road / parcel / house / blocked). Generators check it so nothing overlaps.

**Decision:** a real graph, not a grid bent by noise. An earlier attempt pushed the grid sideways with a smooth noise field ("road warp"); it read as regular waves, not real streets. Subdivisions need branching, looping and dead-end streets that no deformed grid can make.

**Determinism.** `rng.ts` uses **mulberry32** (a tiny 32-bit PRNG) and `hashSeed(seed, x, z)` to give every cell its own random stream. A cell's content never depends on the order cells are generated, which is what lets chunks stream in any order.

### 4.2 Terrain: the height function (`terrain.ts`)

`Terrain.heightAt(x, z)` gives the ground height anywhere, from **hand-written value noise** (random values at grid points, smoothly blended; `fbm` stacks several octaves). It's built in layers:

1. **Smooth hills** (`smoothHeight`):
   - **In towns:** rolling hills and valleys ~520 m across, 3–37 m in the suburbs and villages, gentler downtown (3–25 m).
   - **In the country:** ~14 m rolling farmland and up to ~50 m in the northern forest (~750 m across), plus a rim of high hills at the world's edge.
   - Towns blend into the countryside over a few hundred metres; everything flattens toward the coast and the lake shore.
   - **Roads follow this layer**, so streets climb and dip with the hills, and so do **town blocks** (§4.3).
2. **Detail bumps**: ~110 m wavelength, faded out near roads and towns so those stay smooth.
3. **Lake**: a bowl carved below the water level.
4. **Beach**: south of the coastal road, sand slopes into the sea. The waterline wanders with a couple of sine waves.
5. **No stray ponds**: away from the lake and sea, the ground is clamped above the water level. The water surface spans the whole map, so any dip below it would show water.

**Decision: roads ride the smooth layer.** Making roads follow the terrain (instead of flattening valleys for them) gives rolling streets and country roads. Measured over every road:
- **town streets** peak at ~15 %, with under 1 % of their length over 10 % (like a hilly real city);
- **country roads** have under 1 % of their length over 15 %, and a couple of short spots near the edge hills are steeper.

Early versions hit 56 % near the lake, until the shore flattening was widened. The first version of the town hills was too subtle to see; the final one is about 50 % bigger and tighter.

`colorAt()` picks the ground colour from height, slope and zone:
- grass (lush ↔ dry) and darker forest floor;
- a **patchwork of fields** on farmland (wheat, young crops, ploughed earth, pasture, with faint crop rows);
- rock on steep slopes;
- sand on the beach and lake shore (darker where wet);
- sea bed darkening with depth.

Helpers used everywhere:
- `roadDistance`, `townDistance` (a precomputed per-cell distance grid makes this fast), `zoneAt`, `isClear` (where trees and farms may go);
- **Roads:** the ground dips just below every road and rises back within `VERGE` (4.5 m) of the kerb, so the road surface (its own mesh and collider) always sits on top. In town zones the lawns are `CURB_HEIGHT` above road level.
- **`surfaceAt(x, z)`: where you'd stand.**
  - On a downtown block: the slab top.
  - On a road: road level.
  - On a sidewalk: a curb above it.
  - On the verge: sloping to the lawn.
  - Elsewhere: the ground. Pedestrians, cash, shop and hospital doors, mission givers and spots, traffic-light poles, the helipad and the spawn all use it. Parked cars use `smoothHeight` (road level).

### 4.3 Streaming chunks (`chunks.ts`, `instancePool.ts`)

The world is cut into **13 × 13 chunks of 4 × 4 cells (312 m)**, built in two tiers by distance from the player:

| Tier | Loads within | Unloads beyond | Contents |
|---|---|---|---|
| **far** | 850 m | 1000 m | terrain mesh + **Rapier heightfield collider**; roads (asphalt ribbons, junction discs, cul-de-sac circles, sidewalks with curbs, grass verges, markings), driveways and parking lots, with **one trimesh collider** for every paved surface; downtown block slabs; houses and other buildings, pitched roofs, steeples (+ colliders) |
| **near** | 400 m | 520 m | street, garden, park and forest trees, lamps (+ light pools), rooftop clutter, gas-station canopies and pumps, **parked cars** in the lots (+ colliders) |

**Roads from the graph.** Each chunk builds the road segments whose midpoints fall inside it, and the nodes, houses and parcels whose centres do, so every piece is built once whatever order chunks load in:
- Ribbons follow the polyline with mitred normals.
- Sidewalks and verges are skipped where they'd cross another road or lie on a downtown block.
- Markings depend on the class:
  - arterial and downtown: double yellow line and lane dashes;
  - collector: a dashed yellow centre line;
  - country road: dashed yellow centre and white edge lines;
  - quiet residential streets: none.
- Stop lines are painted before lights and before stop signs (on the smaller road); zebra crossings are painted downtown.

- **Hysteresis:** the unload distance is larger than the load distance, so walking back and forth over a boundary doesn't rebuild chunks.
- **Per-frame budget:** jobs are queued nearest first and built for up to ~4 ms per frame, so streaming never causes a long hitch.
- **Startup:** only the chunks within 450 m of the spawn are built before the game starts. Startup stays ~1.2 s; the rest streams in while you play.
- **Teleports:** respawning at a hospital calls `loadAround()` first.

**Downtown blocks on hills.** Each block's raised slab is **draped over the smooth layer**: a grid every 8 m at `smoothHeight + 15 cm`, with curb faces down each side and the lawn draped the same way. A small **triangle-mesh collider** per block matches the top.
- **Decision:** the first attempt tilted each block as a flat plane. It left curbs from −0.6 to +0.9 m on 6.6 % of block edges, because the hills curve within 64 m. Draping keeps the curb at exactly 15 cm all round.
- **Buildings stay upright:** the base sits at the lowest point of the footprint and the walls grow by the drop to the highest point, so nothing floats and the uphill side is set into the slope. Rooftop clutter goes on the adjusted roof (each roof prop remembers its building).
- Intersections are draped like the road strips, so there's no step where slopes meet.

**No invisible steps (draping).** Every paved surface is draped point by point over `terrain.smoothHeight`, and its trimesh collider uses exactly the visible vertices. The terrain heightfield dips 0.6 m under roads (`heightAt`), so it always stays below.
- **The bug this fixed:** cars hit invisible steps of up to 0.86 m and took crash damage. There were four causes:
  - ribbons were level across their width at the centre line's height, so on a cross-slope the hillside poked up through the uphill edge (the road material's `polygonOffset` hid it);
  - junction discs and cul-de-sac circles were flat, leaving a lip on the downhill side;
  - cul-de-sac sidewalk rings ran across the street mouth;
  - driveways had no curb cut.
- **The fixes:**
  - ribbon corners, discs (a fan to r/2 plus a ring) and rings take the height at their own position;
  - cul-de-sac sidewalk and verge rings skip the street mouth (`ring(..., skip)`);
  - driveway and lot heights ramp from road level to sidewalk height over the first 1.5 m from the kerb.
- **Also in `terrain.ts`:** `townDistanceGrid` gave up beyond 5 cells and returned "far", which made `smoothHeight` jump ~2 m at some cell boundaries. It now searches up to 8 cells.
- **Measured** with a downward ray scan of the static colliders along every road: the worst step went from 0.86 m to 0.15 m (that's a real downtown block curb), and the terrain sits above the road surface 0 times (was 256).

**Per chunk meshes** are six: the **terrain**, the **road surface** (with parking lots), the **paint** (with ponds and field lines), the **pavement** (sidewalks, curbs, driveways, block slabs), the **verges** and the **lawns**.
- Terrain: a grid every 6 m, with vertex colours from `colorAt` times a neutral grain texture.
- Road surface: quads draped over the smooth layer, with world-space UVs so the asphalt never stretches.
- Road paint: centre lines, dashes, edge lines on country roads, stop lines at lights, zebras at town junctions.

The heightfield collider uses the same 6 m samples as the terrain mesh.

**Instance pools.** Everything repeated goes into a shared `InstancePool`: a fixed-capacity `InstancedMesh` that chunks borrow slots from and give back. That keeps buildings, roofs, trees and so on at **one draw call each, whatever is loaded**.
- The pool always hands out the **lowest free slot** and only draws up to the highest slot in use.
- The first version drew every slot (hidden ones at zero scale): 5 M triangles. Drawing only up to the top slot halved that, and lower-poly tree canopies brought it to ~1.7 M (including the shadow pass).

**Vehicles outside loaded chunks** would fall through missing ground, so `main.ts` disables parked cars' and the helicopter's bodies while their chunk isn't loaded.

### 4.4 Distant terrain and the edge of the world (`city.ts`)

- **Distant terrain:** a **coarse whole-world terrain** (heights every 32 m, out past the world's edge) is one extra mesh, so hills and the coast show on the horizon and from the helicopter.
  - Its fragment shader **discards pixels inside loaded chunks**. It reads the streamer's loaded-chunk mask from a tiny 13 × 13 texture, so the coarse and detailed terrain never overlap.
  - The same coarse grid feeds the map picture.
- **Fog** runs from 180 to 1100 m; the camera's far plane is 2500 m.
- **World edge:** invisible walls just inside the rim hills (and out at sea).

### 4.5 Procedural facades (`facadeMaterial.ts`)

All buildings share one unit box, stretched per instance. A stretched texture would look smeared, so a custom **fragment shader** draws the windows mathematically from the pixel's position *in metres* on the facade. It works out the column and floor and decides: window, shopfront, sign, wall or roof.

**Styles:** glass tower, brick, concrete, and **house** (residential windows on every floor, a front door; also used for barns and farmhouses).

**Per-instance data:** the wall colour, the style, and a seed that varies curtains, lit windows at night and sign colours.

Glass is shiny and slightly metallic so it reflects the sky. It's injected into three.js's standard material with `onBeforeCompile`, so lighting and shadows still work.

**Pitched roofs** are a separate unit prism, stretched and rotated so the ridge runs along the longer side.

### 4.6 Textures (`textures.ts`)

Asphalt, sidewalk, grass, the helipad, glow sprites and the terrain grain are painted onto a `<canvas>` at startup and tiled seamlessly. There are no image downloads.

### 4.7 Sky, sun and lighting (`sky.ts`, `dayNight.ts`)

- **Sky:** three.js `Sky` (physically based scattering). The dome follows the camera.
- **Sun:** one directional light that is the sun by day and the moon by night, with shadows (2048² map). The shadow box follows the player.
- **Ambient light:** a hemisphere fill light plus an **environment map** for reflections and soft sky light.
- **Tone mapping:** ACES filmic, exposure 1.2.
- **Day/night** (`dayNight.ts`): a 12-minute day starting at 10:00 (hold **T** to fast-forward ×40). It advances with the physics clock and drives the sun/moon, sky, lit windows, street lamps and vehicle lights.

**Decision: the environment map is a baked gradient, not the `Sky`.** Baking the physical sky produced values so bright that many phones overflowed their half-float render target and drew black surfaces. A hand-made gradient environment at intensity 3.0 looks almost the same and is safe everywhere.

### 4.8 Road graph and traffic lights (`roadGraph.ts`)

Traffic runs on the street network. A car's route is a chain of pieces, each a polyline in the world:
- **lane:** along one edge in one direction, 1.75 m right of the centre line, trimmed back from the junctions at both ends. Cars carry a lateral offset from it: `0` = inner lane, `LANE_SPACING` (3.5 m) = outer lane on two-lane-each-way roads. On one-lane country roads `−3.5` is the oncoming lane (overtaking).
- **turn:** a cubic Bézier through a junction from the end of one lane to the start of the next, at any angle, between given lane offsets (`turn(from, to, offIn, offOut)`). Its control points lie along the two lanes' own directions, so the heading is continuous.
- **U-turn:** round a cul-de-sac's circle, or at a dead end.

**Pieces are cached and shared:** two cars on the same piece hold the same object, so "is that car on my lane?" is an identity check. Each piece also stores a **curvature speed limit** every few metres: *v = √(a_lat / κ)* with a comfortable a_lat = 3 m/s² (κ from the circle through three neighbouring points).

`turnKind(dirIn, dirOut)` classifies a turn from the angle between the headings: right, left, straight or U-turn. `mustStop(lane)` says whether a lane's road gives way at a stop-sign junction.

At a lit junction the approaches are split into two **phase groups** by direction (roughly along the first road's axis, or across it). `lightPhase(group, node, time)` alternates them on a 24 s cycle, with yellow and an all-red gap, and an offset per junction.

### 4.9 Water: the sea and the lake (`water.ts`)

**One water surface** at `WATER_Y = −0.5 m` covers both the sea and the lake. It's a 2 km grid every 10 m that follows the player, moving in whole grid cells so its vertices don't swim.

- **Waves:** three long sine waves travelling toward the shore, summed in **world space** in the vertex shader. The normal comes from their analytic slope, and per-pixel ripples are added (faded with distance to avoid shimmer).
  - Sea waves are ~0.35 m; they calm down in the last metre of depth so they meet the sand gently.
  - Lake waves are ~6 cm.
- **Depth:** the shader computes the depth itself, with no texture.
  - For the sea, it uses the same beach formula as `terrain.ts`.
  - For the lake, it uses the ellipse.
- **Colour:** turquoise and see-through in the shallows, dark blue deeper, and a **foam line** where waves wash onto the sand.
- **Decision: tint the sky reflection blue.** The game's sky lighting is a near-white gradient, and mirrored off water at low angles it made the sea look white. The shader tints the reflected sky toward summer blue and reduces reflection strength.
- `surfaceAt(x, z)` evaluates the **same wave formula in TypeScript**, so swimmers float on the waves you see.
- When the camera goes under, `render()` switches the fog to murky blue-green 0.5–28 m, and the HUD adds a tint.

---

## 5. Moving around

### 5.1 Walking (`player/onFoot.ts`)

Uses Rapier's **kinematic character controller**. The capsule is 1.8 m tall, radius 0.35 m. Each step:
1. **We decide the desired move:** input direction relative to the camera, plus gravity that we integrate ourselves.
2. **Rapier resolves it** against the world: sliding along walls, stepping up curbs, snapping down slopes.
3. **We apply the corrected move** with `setNextKinematicTranslation`.

Tuning:
- Walk 2.0 m/s, run 5.5 m/s, jump height 1.2 m.
- **Gravity is 20 m/s², not 9.81.** Games feel floaty at real gravity. Vehicles still use the world's real 9.81.
- Acceleration is smoothed: quick on the ground, weak in the air.
- The body turns smoothly toward the movement direction.

**Fall damage.** Landing faster than 11 m/s hurts by 7 health per extra m/s. Roughly: a 5 m drop costs ~25 health, a 10 m drop ~65, and ~15 m is fatal.

OnFoot also handles:
- "interactables": anything with a position, a radius and an action (cars, the heli, the shop, givers, peds);
- the weapon held in the hand;
- aiming/scope;
- combat input;
- the player's character model.

### 5.2 Cameras (`camera/`)

**`followCamera.ts` (on foot).**
- An orbit camera on a sphere around a pivot at head height, 5 m away.
- Mouse/drag changes yaw and pitch. Pitch is clamped between slightly below horizontal and ~70° looking down.
- A ray cast pulls the camera in front of walls, then it eases back out.
- Smoothing uses frame-rate-independent exponential approach: `1 − e^(−k·dt)`.

**`chaseCamera.ts` (vehicles).**
- Sits behind the vehicle's heading and swings around as it turns.
- You can orbit it; after 1.5 s without input it re-centres behind the vehicle.

### 5.3 Cars (`player/car.ts`, `vehicles/carModel.ts`)

Uses Rapier's **ray-cast vehicle controller**. The chassis is one dynamic rigid body. Each wheel is a ray cast downward instead of a physical wheel: a spring-damper pushes the chassis up, and tyre friction applies engine, brake and grip impulses at the contact point. This is the classic arcade-sim approach: cheap and very stable.

Tuning:
- **Suspension:** stiffness and damping are per kg, so a sedan and a van feel consistent. Static sag is about 7 cm, damping about 0.4 of critical.
- **Grip:** tyre friction ≈ 1.6. That grips well but won't roll the car over in hard turns.
- **Power and speed:** engine 5.5 m/s² of push, top speed 32 m/s (~115 km/h), set by drag.
- **Steering:** lock reduces from 0.6 rad when stopped to 0.14 rad at top speed, for stability.
- **Recovery:** after 2 s upside-down the car is put back on its wheels.
- **Crash damage:** a sudden velocity change above 4 m/s hurts by 3.5 health per extra m/s.

**Models.** Car models are procedural: side profiles extruded with bevelled edges. Three types: sedan, taxi, van. Geometry is built once per type and shared. The player's cars get their own paint material; traffic reuses the same geometry through instancing.

### 5.4 Helicopter (`player/heli.ts`, `vehicles/heliModel.ts`)

One dynamic rigid body (1500 kg) pushed by three forces, like a real helicopter:
- **Collective:** main-rotor lift along the heli's own up axis. Tilting the heli tilts the lift, and its horizontal part is what moves you.
- **Cyclic:** pitch and roll torques.
- **Tail rotor:** yaw torque.

On top sits an **arcade flight assist**. It only *chooses* the forces; physics still does the motion:
- **Collective:** chases a target climb rate. With no input that target is 0, so it holds altitude.
- **Cyclic:** a PD controller aims for a target tilt. That tilt comes from the stick, or, with the stick centred, from a counter-tilt that cancels drift. **So it hovers stably hands-off**, as Milestone 4 required.
- **Rotor:** spins up over 3 s after you get in and winds down over 7 s after you leave.
- **Crashes:** hurt above 6.5 m/s.

### 5.5 Getting in and out (`sim/exit.ts`, `sim/vehicleLight.ts`)

- `findFreeSpot` tests candidate spots around the vehicle and places you at the first one where the capsule fits.
- **You can get out at any time** (`getOut` in `main.ts`):
  - **Bailing out at speed:** above 4 m/s you take 3 health per m/s of ground speed beyond that (≈ 35 at 50 km/h, 70 at 90 km/h). Half that off a boat, since you land in the water.
  - **Out of a helicopter in the air:** you fall, and the fall hurts like any other (a 24 m drop is fatal).
  - **What happens to the vehicle:**
    - An abandoned car brakes at full brake force (9 m/s²) until it stops.
    - A helicopter with no pilot has no collective, so it drops (its attitude hold keeps it roughly level while the rotor spins down). If it ends up on its side it's set back on its skids after 3 s.
    - A boat's engine dies and it slows at 3 m/s².
- One spotlight is shared by whichever vehicle you're in (headlights or searchlight). It's created once and only moved, because adding or removing lights makes three.js recompile every shader.

---

### 5.5b Boats and jet skis (`player/boat.ts`, `vehicles/boatModel.ts`)

- **Where:** a speedboat and a jet ski float off the beach (near Lena) and another pair on the lake, each where the water is at least 1.6 m deep. Board with **E** from the shore or while swimming alongside. They're marked "B" on both maps.
- **Controls:** W throttle, S reverse, A/D steer, E get out (into the water, swimming).
- **Models:** procedural, like the cars. The hull is built from V-shaped cross-sections tapering to the bow, with a flat transom. The speedboat has a stripe, windscreen, console, seats and an outboard; the jet ski has a seat, handlebars and a jet nozzle.
- **Physics:** one dynamic body (a box collider; its density gives the mass).
  - **Buoyancy:** at five points on the hull bottom, each a spring on its depth under the actual wave surface (`Water.surfaceAt`). The stiffness k = m·g / (5·draft) floats the boat at its draft, so it pitches and rolls over the swell; a damper on each point's vertical speed stops the bobbing.
  - **Hull drag, in the boat's frame:**
    - quadratic along it, which sets the top speed (speedboat ~75 km/h, jet ski ~70 km/h);
    - strong and linear sideways, like a keel, so turns carve instead of skid;
    - vertical water resistance.
  - **Thrust:** only while the stern is wet.
  - **Steering:** chases a turn rate, stronger with speed (a rudder needs flow). The jet ski can turn a little even when stopped.
  - **Planing:** the bow lifts a few degrees at speed.
  - **On land:** no water forces; it rests on its hull ("Aground").
- **Crashes:** a jolt over 5 m/s hurts the driver.
- **Not affected by sinking:** boats don't use `sim/sinking.ts`. That's only for cars and the helicopter.

### 5.6 Swimming (`player/onFoot.ts`)

Swimming is part of `OnFootMode`, because it uses the same capsule and camera. Swimming starts when the water is more than 1.25 m above your feet; shallower water is still walking (wading).

**Moving:**
- Swim at 1.6 m/s, or 2.6 m/s with run held. Acceleration is sluggish, like water.
- **Buoyancy** eases the body back to floating height (head above the waves) when there's no vertical input.
- **C / Ctrl** (DIVE) swims down and **Space** swims up. You can't leap out of the water.
- No attacks or interacting while swimming, and the weapon is hidden.

**Breath:**
- **12 s** of breath while your head is under the surface, shown as a blue bar under health. It turns red when you're nearly out.
- After that you lose **10 health per second**, applied in one-second chunks so there's one hurt flash per second, not one per physics step.
- Breath refills 4× as fast at the surface.

**Animation:** there's no swimming clip in the Quaternius set.
- Moving: `CharacterModel.setSwimming()` tilts the whole body ~75° forward and plays the walk cycle as a kick.
- Treading water: nearly upright, in the idle pose.
- The tilt pivots about the middle of the body so the swimmer stays centred on the capsule.

### 5.7 Vehicles in deep water (`sim/sinking.ts`)

Shared by `Car` and `Helicopter`. A vehicle sinks when its floor (a car) or skids (the helicopter) go under in water deeper than 1 m.

1. **Wreck:** every material is swapped for a dark, waterlogged one, and the engine or rotor stops.
2. **Eject:** `main.ts`'s `onSink` puts the driver or pilot in the water beside the driver's door (swimming), with a splash and a "sinking!" message.
3. **Sink:** while sinking, the vehicle's own forces are replaced by water forces: heavy drag plus a push of 70 % of its weight. That leaves 30 % of gravity against strong drag, so it settles at ~1 m/s instead of dropping like a stone.
4. **Clear up:** after 25 s, parked cars return to their spot and the helicopter to its helipad; jacked cars are gone for good.

Sinking or sunken vehicles can't be entered.

---

## 6. Life in the city (`src/npc/`)

### 6.1 Traffic (`traffic.ts`)

- **Pool:** 28 cars kept around the player. They spawn on roads 60–220 m away (weighted toward the busier roads) and are recycled beyond 260 m.
- **Placement:** two points 1.5 m ahead and behind along the piece, shifted by the lateral offset. Their midpoint is the car, the line between them its heading, and the road heights there its pitch. While changing lanes the nose turns toward the side it's drifting to.
- **Routes:** at the end of each lane a driver picks the next road. They mostly go straight on, prefer roads at least as big as the current one, and rarely take a U-turn, so cul-de-sacs see only the odd car.
- **Not physics-driven.** Each car chooses its speed along its route, and a *kinematic* body is moved to match, so your car bumps into them as solid objects. This is far cheaper and more predictable than simulating the cars.
- **Speed limits:** 12.5 m/s (45 km/h) in town and 19 m/s (~70 km/h) on country roads, times each driver's pace. Curves cap it further (the piece's curvature limits, braked for in advance: *v² = v_lim² + 2·b·d*).
- **Car following: the Intelligent Driver Model (IDM).** Each step a car's acceleration is *a·[1 − (v/v0)⁴ − (s\*/s)²]* with *s\* = s0 + v·T + v·Δv / (2√(a·b))*. Here *s* is the gap to the leader and *Δv* how fast it's closing. Red lights, give-way lines and obstacles (you, your cars) are leaders that stand still. IDM gives smooth, collision-free following, queues that start and stop naturally, and stop-and-go waves, from one formula.
- **Driver personalities:** each driver gets their own pace (85–120 % of the limit, triangular spread; 12 % are dawdlers at 68–80 %; vans a bit slower), time gap *T* 1–2 s, acceleration *a*, braking *b* and stopping gap *s0*. So traffic spreads out, platoons form behind slow drivers, and fast drivers want to get past.
- **Lane changes (town roads): a simplified MOBIL.** A couple of times a second (staggered), a car compares the IDM acceleration it would have in the other lane with its current one:
  - it switches if the gain beats a threshold, with a bias that keeps cars right;
  - only if the car that would end up behind it wouldn't have to brake harder than 3 m/s²;
  - within 60 m of a junction it moves to the lane for its turn (right turns from the right lane, left turns from the left);
  - it never moves sideways into a car that's alongside.
- **Overtaking (country roads).** Stuck behind something slower, a driver estimates how long passing takes. It pulls into the oncoming lane only if:
  - the manoeuvre fits before the next junction or bend (along the straight run of road ahead);
  - the oncoming lane is clear for that whole time, assuming cars coming at ~20 m/s.

  It aborts and tucks back in if something appears, passes a whole queue if there's no gap to return to, and oncoming cars brake for anyone in their lane.
- **Junctions and lights:**
  - Red lights and stoppable yellows stop cars at the stop line.
  - Left turns at lights wait for oncoming cars going straight or right.
  - **Stop signs:** cars on the smaller road come to a full stop. They go once no other car is crossing and nothing on the main road is within ~4 s. Where roads of equal rank meet, it's an all-way stop.
- **Brake lights:** an extra instanced mesh per car type over the tail lights (unlit, so they glow at night), shown while a car is braking or standing.
- **Cost:** ~0.15 ms per physics step for all 28 cars, measured in headless Chromium:
  - the leader search is a scan over the other cars with identity checks on shared pieces;
  - lane decisions are staggered and run ~2× a second;
  - curvature limits are precomputed per piece and each car's planned turn is cached;
  - traffic-light lamp colours are refreshed 10× a second instead of every step (cars read the light state directly).
- **Rendering:** a handful of `InstancedMesh`es, one per car part per type.
- **Damage:** 150 health. They smoke when damaged (`sim/smoke.ts`, one `Points` draw call for all puffs). At 0 they become wrecks (a matte body so they don't look silver), the driver bails and drops cash, and the wreck is cleared after 20 s.

### 6.2 Pedestrians (`pedestrians.ts`)

- **Pool:** about 16 people kept around the player. Each walks a loop (a closed polyline), pausing now and then and waiting if you block them:
  - downtown: round one block's sidewalk;
  - in the suburbs: out along one sidewalk of a street and back along the other.
- **No physics:** they follow their loop exactly.
- **States:**
  - `walk`;
  - `talk`: stop and face you;
  - `flee`: 9 s of running away after violence;
  - `angry`: chase you and punch, 7 damage every 1.1 s, giving up beyond 30 m;
  - `down`: knocked out, lie flat, then sink away after 12 s and respawn.
- **Run over:** a player car moving faster than 3 m/s (~11 km/h) knocks down anyone inside its footprint, throwing them up to 4 m along its path. Their cash ($10–60) goes straight to the player, since you can't pick cash up from a car, and people nearby flee. Slower than that, a car only nudges past (`checkVehicles` in `pedestrians.ts`, the `vehicles` and `runOver` hooks in `main.ts`).
- **Hit test for bullets:** a cylinder of radius 0.4 m and height 1.75 m. That's cheaper and more forgiving than per-bone hit boxes.
- **Performance:**
  - beyond 70 m their animation is frozen;
  - beyond 90 m they're hidden;
  - each person is one draw call (see §8).

### 6.3 Minimap and full map (`ui/minimap.ts`, `ui/fullMap.ts`, `world/mapImage.ts`)

**Map picture** (`mapImage.ts`): the whole world is drawn once at 0.5 px/m (~2200 px square).
- Land colours and water come from the coarse height grid; roads, blocks and buildings are drawn on top.
- Drawing 4 km at 1 px/m would need ~70 MB of canvas memory, too much for phones. So when zoomed in, the maps also draw **sharp vector detail** for the area on screen (`drawDetail`).
- Map symbols come from one shared function (`drawMarker`).

**Minimap:**
- Round, top right. It turns so your view direction points up and zooms out with altitude.
- Hospitals, gun stores, mission givers, cars, the helicopter and objectives are shown; objectives off the edge are pinned to the rim.
- **Click or tap it** to open the full map.

**Full map:**
- Opens with **M** or from the minimap; closes with M, Esc or ✕. Game input is paused while it's open.
- North is up. Drag to pan; zoom with the wheel or a pinch, around the cursor.
- Markers, a legend, a scale bar and a "◎ Me" button that re-centres on you.

### 6.4 Directions (`game/route.ts`)

**Set a destination:** click or tap the full map (a drag doesn't count). Click the flag again, or "✕ Clear route", to clear it. The route is drawn in magenta on both maps, the remaining distance shows under the minimap ("⚑ 1.4 km"), and "You have arrived" appears within 15 m.

**`Router.find(x0, z0, x1, z1, mode)`:** A* on `layout.streets.net`.
- **Edge cost:** travel time when driving (length ÷ the class speed in `ROAD_SPECS`, so arterials win) and distance on foot.
- **Heuristic:** straight-line distance (÷ the top road speed when driving). It never overestimates, so the route is optimal. A test against plain Dijkstra on 30 random pairs found no longer routes; A* expands ~150 of ~850 junctions, and a 2.4 km route takes ~5 ms.
- **Start and end:** both points snap to the nearest road (`net.nearest`). The route starts along your edge toward whichever end is better, ends along the destination's edge, and handles both on the same edge.
- **Off-road destinations:** more than 8 m from a road, the final straight leg is drawn dashed (`Route.offroad` is the index where it starts).
- **Helicopter and boats:** a straight line (`'direct'`).

**`Navigator`** (owned by `main.ts`):
- The part behind you is trimmed twice a second.
- It re-routes when you're more than 25 m off the line (at most every 2 s) or switch between walking and driving.

## 7. Gameplay systems (`src/game/`, `src/ui/`)

### 7.1 Health, money, weapons (`game/stats.ts`)

- **Health:** 100. Regen starts 6 s after the last damage, at 5 health per second.
- **Death:**
  1. Fade to "You were knocked out" (`main.ts`).
  2. After 2.5 s, wake up at the nearest hospital, minus 20% of your cash. You keep your weapons.
- **Money:** you start with $200.

| Weapon | Price | Damage | Range | Notes |
|---|---|---|---|---|
| Fists | free | 12 | 1.7 m | |
| Baseball bat | $100 | 35 | 2.3 m | |
| Pistol | $300 | 34 | 80 m | ammo $30 / 12 |
| Rifle | $800 | 50 | 150 m | automatic, ammo $60 / 30 |

**Add-ons** (sold only once you own the weapon):
- **Scope** (pistol $150, rifle $200): 4× zoom while aiming.
- **Light grip** (bat $60, pistol $80, rifle $120): +20% run speed while holding that weapon. Guns otherwise slow you slightly.
- **AP rounds** (pistol $75 / 12, rifle $150 / 30): +50% damage. They're separate ammo, fired before normal rounds.

**Economy decision** (commit `24e6208`). Prices were set against how fast you actually earn. You can afford the bat at once and the pistol after a little exploring. The rifle and its add-ons need several missions.

### 7.2 Combat (`game/combat.ts`, `game/weaponModels.ts`)

- **Melee** hits the nearest pedestrian in a cone in front of you.
- **Guns** fire a ray **from the camera through the screen centre**, where the crosshair is. That way the bullet goes where you aim, not where the gun barrel points.
  - The ray starts level with the player, so things between the camera and the player can't be hit.
  - It stops at the first wall (Rapier ray cast) or pedestrian (our cylinder test).
  - Traffic cars hit by a shot take damage.
- **Feedback:** a tracer and muzzle flash. Violence alarms pedestrians within 12 m (melee) or 45 m (guns).
- **Phones:** tapping to shoot gets a 7° aim-assist cone.
- **Weapon models** are simple procedural meshes attached to the character's right-hand bone.

### 7.3 Cash pickups (`game/pickups.ts`)

Glowing, spinning bundles on town sidewalks, placed with the world's seeded RNG. Walk over one to collect it; it comes back after 2 minutes. Knocked-out pedestrians drop one-off cash. All bundles render as one `InstancedMesh`, and only the ones within 180 m are drawn (there are hundreds).

### 7.4 Gun stores (`game/shop.ts`)

There are six stores:
- one on the building nearest the spawn;
- five more placed by `game/places.ts`: Seaside, Northside, Eastside, Westside and Eastfield. These are small brick shops along a southern sidewalk.

Each has a lit sign, a door and a pulsing marker. **E** at any door opens the same buy menu (weapons, ammo, add-ons). Input is blocked while the menu is open.

### 7.4b Hospitals and respawning (`game/places.ts`)

`createPlaces()` picks places deterministically, nearest to a target point, and replaces their buildings **before any chunk is built**, so the streamed meshes and colliders include them:
- **Downtown:** a block, avoiding the spawn, helipad and mission-giver blocks.
- **Elsewhere:** a parcel.
  - A hospital takes over a strip mall, school or big-box parcel: the building at the back, the lot in front, two cars parked facing the door.
  - Villages and the beach town get a smaller clinic in a shop's place.
  - Gun stores become one unit of a strip mall, or a village or beachfront shop.

- **8 hospitals:** City General (downtown), Northside, Eastside, Westside, Seaside, and a clinic in each village.
  - Each is a white building with a red-cross **HOSPITAL** sign over the entrance and a forecourt.
  - Each has **two parked cars** outside (in the street downtown, in the lot elsewhere), which respawn like the others.
- **When you're knocked out**, you wake up at the hospital **nearest to where you fell**, with a toast naming it. The chunks there are loaded first.
- Hospitals are marked on both maps.

### 7.5 Chatting (`ui/dialogue.ts`)

**E** near a pedestrian opens a speech bubble with a greeting (different at night) and three replies (keys 1–3 or tap):
1. **friendly:** a friendly answer;
2. **"where can I get a weapon?":** directions to the store;
3. **rude:** they storm off or pick a fight.

### 7.6 Carjacking (in `npc/traffic.ts` + `main.ts`)

With a weapon in hand, **E** next to a stopped or slow traffic car (the driver runs off) pulls it out of the traffic pool and turns it into a player `Car`. Unarmed, you get a hint to visit the store. The traffic pool refills itself.

### 7.7 Missions (`game/missions.ts`)

Eight fixed, invulnerable givers with a "!" marker: three downtown, five out in the world. They're not pedestrians: just a model with a solid collider, so bullets and fists stop on them.

| Giver | Missions | Base reward + bonus per second left |
|---|---|---|
| **Marco** | Delivery: drive to a spot in time | $150 + $2/s |
| **Marco** | Package run: collect several packages | $200 + $1.5/s |
| **Vera** | Wreck a marked traffic car before it escapes | $250 + $2/s |
| **Captain Reyes** | Fly the helicopter through rings: six rings at rising altitude meandering away from the helipad. Every ring keeps 15 m (`RING_CLEARANCE`) from all buildings, roofs and steeples included, and from the ground; it tries up to 40 spots and otherwise climbs clear (`ringCourse`, `ringClear`) | $300 + $3/s |

**Five more givers out in the world**, each standing on the sidewalk of the street nearest a chosen spot, facing the road:

| Giver | Where | Missions | How it's checked |
|---|---|---|---|
| **Lena** | Seaside | **Buoy swim**: 5 buoys in a zig-zag line out to sea (≥ 1.2 m deep), in order, 150 s | only counts while swimming |
| **Farmer Joe** | Eastfield | **Country race**: ~8 gates along a route generated on the street network. It wanders the bigger roads, never back the way it came, avoiding junctions already passed, with a gate every ~160 m or more. The clock starts at the first gate, with time for the rest at ~15 m/s | only counts while driving |
| **Ranger Kim** | Pinecrest | **Summit hike**: flags on the 3 highest spots 150–650 m away, at least 150 m apart, 300 s | only counts on foot (not by helicopter) |
| **Dusty** | Westbrook | **Long haul**: delivery 1.2–2.2 km away; base pay $150 + $0.15/m. Also **wreck** | — |
| **Sam** | Northside | **Package run**, **wreck** | — |

`main.ts` passes hooks (`isDriving`, `isSwimming`, `isOnFoot`, `ground`, `usedBlocks`). Buoys bob on the swell, gates are green rings, and flags are red pennants on poles. All show on both maps as objectives.

One mission at a time. You fail on timeout or death, at no cost, and can ask again.

### 7.8 HUD and other UI (`ui/`)

- `hud.ts`:
  - health bar, cash and weapon/ammo;
  - crosshair and scope overlay;
  - red hurt flash;
  - toasts and the mode's prompt and status;
  - the death fade and the desktop "Click to play" overlay.
- `debug.ts`: FPS / draw calls / triangles (F3 or `` ` ``).
- `characterPicker.ts`: see §8.4.

All UI is plain DOM elements styled inline. A UI framework would be a dependency for very little gain.

---

### 7.9 Saved progress (`game/save.ts`)

- **Where:** one JSON object in `localStorage['opencity.save.v1']`.
- **What:** money, health, weapons, ammo, add-ons, the weapon in hand, missions completed per giver (`Missions.record`), where you are, the time of day and the map destination. The wanted level is never saved.
  - In a vehicle, the saved spot is the nearest road, so you never wake up in the air or at sea.
- **Loading:** at startup, `PlayerStats.load()` restores the stats, ignoring unknown weapons and add-ons. It wakes you with at least 20 health. The world around the saved spot is loaded before you're placed there.
  - A version mismatch, a missing field or JSON that doesn't parse all mean a new game.
- **When it saves (`Autosave`):** every 30 s, about 1 s after your money changes (a purchase, reward, payout, death or fine), and on `pagehide` / `visibilitychange`.
- **New game:** the "⟲ New game" button on the full map asks to confirm, stops autosave (so the reload's `pagehide` can't write the old game back), clears the key and reloads.
- **To add something to the save:** add a field to `SaveData`, write it in main.ts's `Autosave` callback, read it after `loadSave()`, and give it a default (`??=`) in `loadSave` so older saves still load.

## 8. People: characters, animation, recolouring

This was the most recent and most involved piece of work.

### 8.1 Where the people come from, and the decision path

1. **First version:** everyone was the three.js "Soldier" example: one model with only idle/walk/run, tinted per pedestrian. It wasn't CC0 and wasn't diverse.
2. **Mixamo** (Adobe) was your first choice, but it needs an Adobe login that can't be used from the build environment. I wrote a full download guide (`docs/characters.md`) and a converter (`scripts/build-characters.mjs`, `npm run build:characters`) so you could do it by hand. It's still there as an **optional** route; its output goes to `public/assets/characters/mixamo/`.
3. **Chosen:** 15 **CC0** (public domain) characters from **Quaternius' Ultimate Modular Men & Women** packs. They were fetched from a public GitHub mirror, because Google Drive refused downloads from the cloud environment.
   - All 15 share **one 62-bone skeleton** and the **same 24 animation clips**.
   - Clips include: Idle, Walk, Run, Punch_Left/Right, Sword_Slash, Idle_Gun, Idle_Gun_Pointing, Idle_Gun_Shoot, HitRecieve, Death, Interact, Wave and more.
   - The licence text is in `public/assets/characters/LICENSE-QUATERNIUS.txt`.

### 8.2 The asset build (`scripts/build-quaternius.mjs`, `npm run build:quaternius`)

Runs offline in Node using **glTF-Transform**. The sources go to `art/quaternius/`, which is git-ignored (45 MB of sources never enter the repo).

**Shared animations.** Taken from one character, with meshes removed, keyframes resampled and duplicates removed. Output: `animations.glb`, about 680 KB.

**Per character:**
1. Remove its animations, including the leftover samplers and accessors, which otherwise tripled the file size.
2. Remove built-in props: the suit and SWAT outfits come holding a pistol.
3. **Merge every part into ONE mesh with ONE material.** Each part's colour is baked into the vertex colours (`COLOR_0`), plus a per-vertex part index (`_PART`). Result: **one draw call per person** instead of 6–11, which matters on phones with a dozen people on screen.
4. Weld, deduplicate and **meshopt**-compress. Output: about 140–230 KB per character.
5. Name the mesh node `CharacterMesh`. *Not* `Body`: that's the root bone's name, and three.js renames duplicate names, which silently sent every hip animation to the mesh object instead of the skeleton (see §8.5).

**Manifest.** `manifest.json` lists each character's id, name, gender, authored height and parts (name, kind, original colour).

**Part kinds:**
- `skin`, `hair`, `cloth` (shifted with the outfit colour), or `fixed` (eyes, gold, visors, ties).
- Classification goes by material name, with a few per-character **overrides** where names lie: the formal-dress woman's hair is a material called "Red", the worker woman's is "DarkBrown", and the women's eyes are "Brown".

### 8.3 Loading and recolouring (`player/characterLibrary.ts`)

`CharacterLibrary.load()`:
1. Fetches the manifest.
2. Loads the shared animations.
3. Loads your own character first; `preloadAll()` streams the rest in while you play.

Loading uses three.js `GLTFLoader` + `MeshoptDecoder`.

A **Look** is `{ id, skin, hair, outfit, height }`. `create(look)`:
1. Clones the model with `SkeletonUtils.clone`, so each person gets their own skeleton.
2. Gives the clone its own **colour attribute**, sharing all other geometry, so memory stays low.
3. Paints each vertex by its part kind:
   - **skin:** the chosen tone (slightly darker for "darker" skin parts);
   - **hair:** the chosen colour (eyebrows slightly darker);
   - **cloth:** the original colour with its hue rotated by the outfit shift, saturation capped at 0.55 (no neon clothes);
   - **fixed:** unchanged.
4. Scales the model to the requested height.

**Palettes:**
- **6 skin tones.** The lightest are kept a little deep, because bright daylight washes pale skin out to white.
- **6 hair colours.** Random pedestrians are weighted toward dark hair: about 30% black, 28% dark brown, 14% brown, 9% blond, 7% red, 12% grey.
- **6 outfit hue shifts.**
- **Heights:** men 1.70–1.88 m, women 1.58–1.74 m.

All people share **one** `MeshStandardMaterial` with `vertexColors`.

### 8.4 Character picker (`ui/characterPicker.ts`)

- Opens automatically on your first visit; later with **P**, or the **LOOK** button on touch screens.
- **Controls:** ◀/▶ cycles the 15 people; swatches pick skin, hair and outfit colour.
- **Preview:** the main camera slowly circles your character.
- **Saving:** the choice is saved in `localStorage` (`city.look.v1`), wrapped in try/catch so private browsing just falls back to the default.
- **Rebuilding:** each change creates a new model. A ticket counter ignores a slow older model finishing after a newer one.

### 8.5 Animation (`player/character.ts`)

`CharacterModel` is purely visual: physics decides where a person is, and this class chooses poses. It uses three.js `AnimationMixer` with **layered blending**.

**Upper/lower body split.** Every clip is split once (cached) into upper-body tracks (torso, arms, head, fingers) and lower-body tracks. That lets the legs keep walking while the arms aim a gun.

**Locomotion: idle / walk / run, blended by the speed the body *actually* moved.** Walking into a wall stops the legs.
- **Shared stride phase.** Walk and run are driven from one shared phase, set by hand, instead of letting each clip play freely.
- **Phase offset.** The run clip has its left foot forward 0.375 of a cycle later than the walk. `RUN_PHASE_OFFSET` lines them up, so a blend never tangles the legs.
- **Measured clip speeds.** Walk = 1.32 m/s, run = 3.02 m/s. I measured how fast a planted foot slides backward during ground contact, at scale 1. Clip playback is then scaled by actual speed ÷ clip speed, so **feet stay planted**.
- **Speed bands:**
  - idle → walk;
  - **pure walk up to 2.3 m/s**, so normal walking (pedestrians 1.45–1.8, you 2.0) never mixes in the run;
  - a walk→run blend only as a jog, 2.3–3.4 m/s;
  - pure run above that.
- **Run cadence.** Above the run clip's speed, cadence grows with speed^0.6 rather than linearly, so sprints show longer strides rather than frantic legs. Small foot slip at full sprint is the accepted cost.

**Upper-body overrides.** Each one fades in and out, and **weights always sum to 1** with the locomotion they replace, so poses are never accidentally averaged:
- **aim:** pistol → Idle_Gun_Pointing, rifle → Idle_Gun;
- **talk:** Interact;
- **one-shots:**

| One-shot | Clip | Duration |
|---|---|---|
| punch | Punch_Left / Punch_Right, alternating | 0.45 s |
| bat | Sword_Slash | 0.65 s |
| shoot | Idle_Gun_Shoot | 0.28 s |
| hit | HitRecieve / HitRecieve_2 | 0.45 s |
| wave | Wave | 1.6 s |

Each one-shot is retimed so it lasts as long as the gameplay action.

**Knock-out.** The full-body Death clip plays, then holds its last frame: lying flat on the back.

**Facing.** Quaternius models face +Z, and the game's forward is −Z, so the model's scene is rotated by π.

**The `Body` bug** (fixed in `334082c`).
- **Cause:** the merged mesh had been named `Body`, the same as the root bone. three.js's loader renames duplicates (the bone became `Body_1`), so every clip's hip track drove the mesh object instead of the hips.
- **Effects:** stiff walking, and the Death clip snapping back upright.
- **Lesson:** never give a mesh node a bone's name.

**Who uses it:**
- the player (`onFoot.ts`): attack animations, aim pose, flinch on damage, knock-out on death;
- pedestrians (`pedestrians.ts`): talk gesture, flinch, angry punches, knock-out;
- mission givers (`missions.ts`): distinct fixed looks, an occasional wave, the talk gesture while offering a job.

---

## 9. Performance decisions

- **Streaming:**
  - Meshes and colliders exist only for chunks near the player, in two tiers (§4.3).
  - World data for everything is generated at startup, which stays ~1.2 s.
  - Chunk building is budgeted to ~4 ms per frame.
- **Traffic:** ~0.15 ms per physics step for 28 cars (§6.1).
- **Street network:** generated once at startup (~200 ms). Distance queries go through a 32 m spatial hash of segments, and chunks build only the segments, houses and parcels they own.
- **Parked cars:** three instanced pools (body, glass, tyres) for every car in the loaded lots.
- **Instance pools:** one draw call per object type, drawing only up to the highest slot in use.
- **Per-chunk meshes** are just terrain, road surface and road paint (3 draw calls per loaded far chunk).
- **Typical load:** ~200 draw calls and ~1.7 M triangles counting the shadow pass, downtown with ~36 far and ~10 near chunks loaded.
- **Cheaper objects:**
  - Street-tree canopies are 140 triangles (one rounder blob plus three simpler ones).
  - Forest trees are ~40 triangles and cast no shadows.
- **One draw call per person** (merged meshes + vertex colours + one shared material).
- **Pedestrians:** animation freezes beyond 70 m; they're hidden beyond 90 m.
- **Water:** a 40 k-vertex grid with per-pixel ripples; the depth is computed in the shader without textures.
- **Maps:** one 0.5 px/m picture plus vector detail drawn only for what's on screen.
- **Fixed lights:** a fixed set of lights (the shared vehicle light), because changing the number of lights recompiles shaders.
- **Dispose** chunk geometries when unloading, and release their pool slots and colliders.

---

## 10. Commands

```bash
npm install               # once
npm run dev               # local dev server with hot reload
npm run typecheck         # tsc --noEmit
npm run build             # type-check + production build to dist/
npm run preview           # serve dist/ locally (port 4173)
npm run build:quaternius  # re-fetch + rebuild the CC0 characters
npm run build:characters  # optional Mixamo pipeline (see docs/characters.md)
```

**Rule:** `typecheck` and `build` must both pass before anything is considered done. Pushing to `main` deploys.

---

## 11. How the game was tested

There is no unit-test suite. Instead the real game is driven in **headless Chromium via Playwright** against `npm run preview`:

- **`window.game`** exposes the world, camera, player and modes, cars, heli, traffic, pedestrians, dialogue, missions, city, day/night, stats, cash, shop, renderer, input, the picker and the character library.
- **`game.simulate(seconds)`** runs fixed physics steps immediately. Headless browsers render at ~4 fps, so tests don't wait in real time; they simulate. Tests often pause the real loop with `renderer.setAnimationLoop(null)`.
- **Input in tests:** tests press actions with `input.pressAction()` / `releaseAction()`, the same abstract layer the keyboard uses.
- **What was checked:**
  - walking and jumping distances;
  - car top speed and handling;
  - the helicopter holding a hover with zero drift;
  - traffic gaps and stopping for the player;
  - traffic over 2 minutes in town and in the country: no overlapping cars, no cars off the road, the spread of cruise speeds, lane changes, overtakes started/completed/aborted, and the cost per step;
  - the street world: every road connected, road grades, houses and parcel buildings clear of the roads, curb heights, pedestrians on sidewalks; map previews of the network rendered in a page during development;
  - pedestrians staying on sidewalks;
  - chat outcomes;
  - damage per weapon, fall and crash damage, regen, death and respawn;
  - store purchases and add-ons;
  - carjacking;
  - every mission type, including timeout and death;
  - touch controls under phone emulation.
- **Visual checks:** screenshots, plus measurements such as foot-contact speeds, animation phases and the death end pose.

When adding a feature, the quickest check is the browser console in `npm run dev`: e.g. `game.stats.money = 5000`, or `game.simulate(5)`.

---

## 12. Where to change common things

| You want to… | Look in |
|---|---|
| Change walk/run speed, jump, gravity, fall damage | `player/onFoot.ts` constants |
| Tune car handling | `player/car.ts` constants (top of file) |
| Tune the helicopter | `player/heli.ts` constants |
| Rebind keys | `input/actions.ts` (the key table) |
| Change touch controls | `input/touch.ts` |
| Change the world size or zones | `world/layout.ts` (`CELLS`, `zoneOf`, `VILLAGES`, `LAKE`) |
| Change hills, the beach or ground colours | `world/terrain.ts` (`smoothHeight`, `heightAt`, `colorAt`) |
| Change streaming distances or chunk size | `world/chunks.ts` (`FAR_LOAD`, `NEAR_LOAD`…, `CHUNK_CELLS`) |
| Change waves or water colour | `world/water.ts` (`WAVES`, amplitudes, shader colours) |
| Change swimming, breath or drowning | `player/onFoot.ts` (`SWIM_*`, `BREATH`, `DROWN_DAMAGE`) |
| Change how vehicles sink | `sim/sinking.ts` |
| Move or add hospitals and stores | `game/places.ts` (`HOSPITAL_TARGETS`, `STORE_TARGETS`) |
| Make towns hillier or flatter | `world/terrain.ts` (`TOWN_HILLS`, `TOWN_HILLS_DOWNTOWN`, the town noise scale in `smoothHeight`) |
| Add or move mission givers | `game/missions.ts` (`OUTER_GIVERS`; mission set-up in `start()`, completion in `fixedUpdate()`) |
| Change building looks | `world/facadeMaterial.ts` (shader) and `layout.ts` (styles) |
| Change day length or start time | `world/dayNight.ts` |
| Change weapon prices or damage | `game/stats.ts` (`WEAPONS`, `ADDONS`, `AP_AMMO`) |
| Change mission rewards or add missions | `game/missions.ts` (`REWARDS`, giver specs) |
| Change pedestrian behaviour | `npc/pedestrians.ts` constants and the state switch in `fixedUpdate` |
| Change traffic density or speed | `npc/traffic.ts` (`POOL_SIZE`, `TOWN_SPEED`, `RURAL_SPEED`, `newDriver()` for the spread of driver habits) |
| Change how drivers change lanes or overtake | `npc/traffic.ts` (`decideLane`, `decideOvertake`, `updateOvertake`) |
| Change the suburbs' layout (arterial spacing, how streets wind, cul-de-sacs, lot sizes) | `world/suburbs.ts` (`SPACING`, the `walk()` options in `superblock()`, `lotsAlong`) |
| Add a kind of commercial or civic place | `world/suburbs.ts` (`placeParcel` and where it's called), then its details in `world/chunks.ts` |
| Change road widths, lanes, sidewalks or speeds | `world/streets.ts` (`ROAD_SPECS`) |
| Change junction rules (lights, stop signs) | `world/streets.ts` (`compact`: which junctions get lights), `world/roadGraph.ts` (`mustStop`, `lightPhase`) |
| Change route preferences, re-route distance or arrival radius | `game/route.ts` (`Router.cost`; the 15 m arrival and 25 m off-route distances in `Navigator.update`) |
| Change the route's look | `world/mapImage.ts` (`ROUTE_COLOR`, `drawRoute`) |
| Change skin/hair/outfit palettes | `player/characterLibrary.ts` |
| Change which clip plays for an action | `player/character.ts` (`ONE_SHOTS`, aims) |
| Add or replace characters | `scripts/build-quaternius.mjs` (`CHARACTERS`, `OVERRIDES`), then `npm run build:quaternius` |
| Change chat lines | `ui/dialogue.ts` |
| Add a new player mode | implement `PlayerMode` (`player/state.ts`) and switch to it with `player.setMode()` |
| Add a new simulated thing | implement `SimEntity` (`sim/entity.ts`) and push it into `entities` in `main.ts` |

## 13. Known limitations and next ideas

- Mixamo characters aren't wired in. They'd need a second roster and Mixamo bone names in the animation code.
- Sprinting shows slight foot slip (the accepted trade-off for natural-looking strides).
- The punk outfits share one material for hair and clothes, so their hair follows the outfit colour. The formal-dress woman's shoes match her hair.
- No jump animation (the stride nearly freezes in the air).
- Forest trees and other near-tier details only exist within ~400 m, so distant hills look bare from the helicopter (the distant terrain darkens forests to suggest a canopy).
- There are no bridges: country roads that would cross the lake stop at it (traffic makes a U-turn).
- There's no swimming clip: swimming is the walk cycle on a tilted body.
- The map's countryside colours come from a 32 m grid, so they're soft when zoomed in (roads and buildings stay sharp).
- Audio doesn't exist yet.
