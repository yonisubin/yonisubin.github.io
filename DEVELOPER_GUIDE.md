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

The world is a grid of **52 × 52 cells**, each 78 m (`PITCH`). Grid lines (road centre lines) sit at multiples of 78 m; line 26 runs through the origin. North is −Z.

**Each cell has a zone:**

| Zone | Where | What's in it |
|---|---|---|
| `downtown` | the centre, ±400 m | today's towers: a block of sidewalk + lot with glass/brick/concrete buildings |
| `suburb` | a ring out to ~1 km (stretched south) | houses with pitched roofs, front gardens, lawns |
| `beachtown` | the row just north of the coastal road, centre | low pastel shops and flats, houses |
| `village` | 3 spots on country-road crossings (Eastfield, Westbrook, Pinecrest) | a few house blocks |
| `farm` | east, west and south countryside | open fields; now and then a red barn + farmhouse |
| `forest` | north of ~−700 m | hills covered in low-poly trees |
| `lake` | an ellipse in the northern hills | water |
| `beach` | south of the coastal road (line 46) | sand, then the sea |

**Town zones** are blocks exactly like the original city:
- each block is 64 m: a 56 m lot plus 4 m sidewalks, on a 15 cm curb slab;
- roads are 14 m wide.

**Roads** (`RoadNet`): a segment between two neighbouring grid intersections exists if:
- either cell beside it is a town (so towns are fully gridded and ringed by roads); or
- it's on every 4th grid line in the countryside (lines 2, 6, … 50), giving country roads ~312 m apart;
- and in either case it doesn't cross the lake or the sea.

The coastal road falls on one of those lines (46). Each segment also knows if it's rural (no town either side: faster traffic, no lights). An intersection gets **traffic lights** only if it's in town and 3+ roads meet.

**Blocks** are generated per zone (`generateBlock`):
- downtown towers, as before;
- suburban and village houses: 1–2 floors, a pitched roof, set back from the street, a garden tree;
- seaside shops.

Countryside features (forest trees, farmsteads, hedgerow trees) are generated **per cell when its chunk is built** (`ruralFeatures`). That keeps startup fast, since there are tens of thousands of forest trees.

**Determinism.** `rng.ts` uses **mulberry32** (a tiny 32-bit PRNG) and `hashSeed(seed, x, z)` to give every cell its own random stream. A cell's content never depends on the order cells are generated, which is what lets chunks stream in any order.

### 4.2 Terrain: the height function (`terrain.ts`)

`Terrain.heightAt(x, z)` gives the ground height anywhere, from **hand-written value noise** (random values at grid points, smoothly blended; `fbm` stacks several octaves). It's built in layers:

1. **Smooth hills** (`smoothHeight`): wavelength ~750 m.
   - About 6 m on farmland and up to ~50 m in the northern forest, plus a rim of high hills at the world's edge.
   - Faded to **zero in and near towns, by the coast and around the lake**.
   - **Roads follow this layer**, so they climb gently over the hills.
2. **Detail bumps**: ~110 m wavelength, faded out near roads and towns so those stay smooth.
3. **Lake**: a bowl carved below the water level.
4. **Beach**: south of the coastal road, sand slopes into the sea. The waterline wanders with a couple of sine waves.
5. **No stray ponds**: away from the lake and sea, the ground is clamped above the water level. The water surface spans the whole map, so any dip below it would show water.

**Decision: roads ride the smooth layer.** Making roads follow the terrain (instead of flattening valleys for them) gives rolling country roads. I measured every road: the steepest stretch is ~22 % (short, climbing out of a town), and only 0.3 % of road length is steeper than 15 %. Early versions hit 56 % near the lake, until the shore flattening was widened.

`colorAt()` picks the ground colour from height, slope and zone:
- grass (lush ↔ dry) and darker forest floor;
- a **patchwork of fields** on farmland (wheat, young crops, ploughed earth, pasture, with faint crop rows);
- rock on steep slopes;
- sand on the beach and lake shore (darker where wet);
- sea bed darkening with depth.

Helpers used everywhere: `roadDistance`, `townDistance` (a precomputed per-cell distance grid makes this fast), `zoneAt`, `isClear` (where trees and farms may go).

### 4.3 Streaming chunks (`chunks.ts`, `instancePool.ts`)

The world is cut into **13 × 13 chunks of 4 × 4 cells (312 m)**, built in two tiers by distance from the player:

| Tier | Loads within | Unloads beyond | Contents |
|---|---|---|---|
| **far** | 850 m | 1000 m | terrain mesh + **Rapier heightfield collider**, road surface and paint, block slabs, lawns, buildings, pitched roofs (+ colliders) |
| **near** | 400 m | 520 m | street, park and forest trees, lamps (+ light pools), rooftop AC units and tanks (+ colliders) |

- **Hysteresis:** the unload distance is larger than the load distance, so walking back and forth over a boundary doesn't rebuild chunks.
- **Per-frame budget:** jobs are queued nearest first and built for up to ~4 ms per frame, so streaming never causes a long hitch.
- **Startup:** only the chunks within 450 m of the spawn are built before the game starts. Startup stays ~1.2 s; the rest streams in while you play.
- **Teleports:** respawning at a hospital calls `loadAround()` first.

**Per chunk meshes** are only three: the **terrain**, the **road surface** and the **road paint**.
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

Intersections are nodes. A car's route is a chain of pieces:
- **lane:** straight along a road segment, in the inner lane on the right;
- **turn:** a quadratic Bézier through the intersection (left, right or straight);
- **U-turn:** only at dead ends, for example where a country road stops at the lake.

The graph reads the `RoadNet` from the layout, so missing segments simply aren't there.

`lightState(i, j, dir, time)` gives lit intersections a 24 s cycle in which north–south and east–west alternate.

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
- One spotlight is shared by whichever vehicle you're in (headlights or searchlight). It's created once and only moved, because adding or removing lights makes three.js recompile every shader.

---

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

- **Pool:** 24 cars kept around the player. They spawn on lanes within a few blocks (60–220 m away) and are recycled beyond 260 m.
- **On the hills:** each car's height and pitch come from the smooth terrain layer ahead of and behind it. Country roads have a higher cruise speed (16 m/s).
- **Not physics-driven.** Each car chooses its speed along its route, and a *kinematic* body is moved to match, so your car bumps into them as solid objects. This is far cheaper and more predictable than simulating 24 cars.
- **Driving rules:**
  - Cruise at 11 m/s, slow to 6 m/s in turns.
  - Brake for red lights at the stop line.
  - Keep a gap to whatever is ahead in the lane (cars, you).
- **Rendering:** a handful of `InstancedMesh`es, one per car part per type.
- **Damage:** 150 health. They smoke when damaged (`sim/smoke.ts`, one `Points` draw call for all puffs). At 0 they become wrecks (a matte body so they don't look silver), the driver bails and drops cash, and the wreck is cleared after 20 s.

### 6.2 Pedestrians (`pedestrians.ts`)

- **Pool:** about 16 people kept around the player. Each walks a square loop on one block's sidewalk, pausing now and then and waiting if you block them.
- **No physics:** they follow their loop exactly.
- **States:**
  - `walk`;
  - `talk`: stop and face you;
  - `flee`: 9 s of running away after violence;
  - `angry`: chase you and punch, 7 damage every 1.1 s, giving up beyond 30 m;
  - `down`: knocked out, lie flat, then sink away after 12 s and respawn.
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

`createPlaces()` picks town blocks deterministically: the nearest suitable block to a target point in the right zone, avoiding the spawn, helipad and mission-giver blocks. It replaces their buildings **before any chunk is built**, so the streamed meshes and colliders include the new places.

- **8 hospitals:** City General (downtown), Northside, Eastside, Westside, Seaside, and a clinic in each village.
  - Each is a white building with a red-cross **HOSPITAL** sign over the entrance and a forecourt.
  - Each has **two parked cars** in the street outside, which respawn like the others.
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

Three fixed, invulnerable givers with a "!" marker. They're not pedestrians: just a model with a solid collider, so bullets and fists stop on them.

| Giver | Missions | Base reward + bonus per second left |
|---|---|---|
| **Marco** | Delivery: drive to a spot in time | $150 + $2/s |
| **Marco** | Package run: collect several packages | $200 + $1.5/s |
| **Vera** | Wreck a marked traffic car before it escapes | $250 + $2/s |
| **Captain Reyes** | Fly the helicopter through rings | $300 + $3/s |

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
| Change the world size, zones or road spacing | `world/layout.ts` (`CELLS`, `zoneOf`, `RURAL_EVERY`, `VILLAGES`, `LAKE`) |
| Change hills, the beach or ground colours | `world/terrain.ts` (`smoothHeight`, `heightAt`, `colorAt`) |
| Change streaming distances or chunk size | `world/chunks.ts` (`FAR_LOAD`, `NEAR_LOAD`…, `CHUNK_CELLS`) |
| Change waves or water colour | `world/water.ts` (`WAVES`, amplitudes, shader colours) |
| Change swimming, breath or drowning | `player/onFoot.ts` (`SWIM_*`, `BREATH`, `DROWN_DAMAGE`) |
| Change how vehicles sink | `sim/sinking.ts` |
| Move or add hospitals and stores | `game/places.ts` (`HOSPITAL_TARGETS`, `STORE_TARGETS`) |
| Change building looks | `world/facadeMaterial.ts` (shader) and `layout.ts` (styles) |
| Change day length or start time | `world/dayNight.ts` |
| Change weapon prices or damage | `game/stats.ts` (`WEAPONS`, `ADDONS`, `AP_AMMO`) |
| Change mission rewards or add missions | `game/missions.ts` (`REWARDS`, giver specs) |
| Change pedestrian behaviour | `npc/pedestrians.ts` constants and the state switch in `fixedUpdate` |
| Change traffic density or speed | `npc/traffic.ts` (`POOL_SIZE`, `CRUISE_SPEED`…) |
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
