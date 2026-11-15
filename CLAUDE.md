# CLAUDE.md

## Project

A small open-world game that runs entirely in the browser. The player can walk, swim, drive cars, and fly a helicopter through a procedurally generated ~4 × 4 km world: a hilly downtown and suburbs, villages, farmland, northern hills and forest with a lake, and a beach with the sea. The world is streamed in chunks around the player. Single-player, no backend. Deployed as static files to GitHub Pages.

## Stack

- **TypeScript** (strict mode) + **Vite**
- **three.js** for rendering (WebGL 2)
- **Rapier** via `@dimforge/rapier3d-compat` for physics (the compat build embeds the WASM, which avoids Vite/WASM loading issues)
- Assets: Kenney.nl CC0 low-poly kits (city, cars, characters) as `.glb` (kenney.nl is blocked from the cloud dev environment; download kits locally if needed)
  - People (player, pedestrians, mission givers): 15 CC0 characters from Quaternius' *Ultimate Modular Men/Women* packs, all on one shared skeleton with 24 shared animation clips. `npm run build:quaternius` (`scripts/build-quaternius.mjs`) fetches the sources into `art/quaternius/` (git-ignored) and writes one GLB per character (all parts merged into one mesh/draw call; part colours in vertex colours + a `_PART` index), a shared `animations.glb` and `manifest.json` to `public/assets/characters/`. `player/characterLibrary.ts` loads them and recolours skin / hair / outfit per person; `player/character.ts` blends locomotion and plays one-shots (punch, bat, shoot, hit, wave, talk, knock-out); `ui/characterPicker.ts` is the in-game picker (P / LOOK button), saved in localStorage
  - Buildings, roads, sidewalks, terrain and water are procedural (facade shader in `world/facadeMaterial.ts`, canvas textures in `world/textures.ts`, height function in `world/terrain.ts`, water shader in `world/water.ts`), not models
  - Cars and the helicopter are procedural too (`vehicles/carModel.ts`, `vehicles/heliModel.ts`)
  - Optional, not wired in yet: Mixamo people (different `mixamorig` skeleton and animation set). Follow `docs/characters.md`, drop FBX files in `art/mixamo/`, then `npm run build:characters` writes GLBs + `manifest.json` to `public/assets/characters/mixamo/`. The build tools (`fbx2gltf`, `@gltf-transform/*`) are dev-only dependencies

Do not add new dependencies without asking first.

## Commands

```bash
npm install
npm run dev        # local dev server
npm run build      # type-check + production build to dist/
npm run preview    # serve the production build locally
npm run typecheck  # tsc --noEmit
npm run build:quaternius  # fetch + convert the Quaternius CC0 characters → public/assets/characters
npm run build:characters  # (optional) Mixamo FBX in art/mixamo → public/assets/characters/mixamo
```

Before considering any task done, `npm run typecheck` and `npm run build` must both pass.

For automated checks, `window.game` exposes the world, player, vehicles and NPCs, and `game.simulate(seconds)` runs fixed physics steps immediately (independent of frame rate — headless browsers render very slowly).

## Structure

```
src/
  main.ts          # renderer setup, game loop, fixed physics step
  world/
    layout.ts      # world data: 52×52 cells of 78 m, a zone per cell, downtown blocks, countryside features;
                   # buildStreets() lays out every road once the terrain exists
    streets.ts     # the street network: a graph of roads in world space (nodes, polyline edges, road classes),
                   # NetworkBuilder (crossings, T-junctions, junction control), segment index, occupancy raster
    suburbs.ts     # generators: arterials on a rough half-mile super-grid, subdivisions grown by curvy
                   # "walkers" (collectors, loop streets, cul-de-sacs), houses on lots, strip malls, gas stations,
                   # big-box stores, schools, parks, churches, beachfront shops, villages, winding country roads
    terrain.ts     # height function (town + country hills, lake, beach), ground colours, WATER_Y;
                   # surfaceAt(x, z): where you'd stand (sidewalk top in a block, else ground/road)
    chunks.ts      # streaming: 13×13 chunks of 312 m, far tier (terrain, roads, buildings) + near tier (trees, lamps)
    instancePool.ts# shared InstancedMesh slots borrowed by chunks (one draw call per object type)
    city.ts        # materials, pools, distant terrain, world walls; creates the streamer
    water.ts       # sea + lake surface (waves, depth colour, foam), waterSurface() for swimmers
    mapImage.ts    # world picture + vector detail + map symbols (minimap and full map)
    roadGraph.ts   # traffic lanes/turns on the street network (cached polylines + curvature speed limits),
                   # light phases, stop-sign rules
    sky.ts, dayNight.ts, facadeMaterial.ts, textures.ts, rng.ts
  player/
    state.ts       # player state machine: OnFoot | Driving | Flying
    onFoot.ts      # Rapier kinematic character controller
    character.ts   # animated character model (player + pedestrian clones)
    car.ts         # Rapier raycast vehicle controller + DrivingMode
    heli.ts        # custom helicopter forces + FlyingMode
    boat.ts        # speedboat / jet ski: buoyancy points on the wave surface, hull drag, thrust + BoatMode
  vehicles/        # procedural car / helicopter / boat models
  npc/             # traffic (IDM car following, per-driver habits, lane changes, country overtakes, brake lights),
                   # pedestrians (+ police officers), pooled around the player, and police.ts (patrols, pursuits on A*
                   # routes, roadblocks, helicopter)
  game/            # player stats (health/money/weapons), combat, cash pickups, gun stores, missions,
                   # route.ts (A* directions on the street network: click the full map to set a destination),
                   # wanted.ts (0–5 stars from crimes, lost out of police sight), jobs.ts (taxi / ambulance / delivery shifts),
                   # places.ts (hospitals = respawn points, extra stores), save.ts (progress in localStorage)
  sim/             # SimEntity interface, body interpolation, exit-spot helper, smoke, sinking vehicles
  camera/          # follow camera (on foot), chase camera (vehicles)
  input/           # keyboard/touch → abstract actions
  ui/              # HUD, minimap, full map (M), character picker, chat bubbles, debug overlay
public/
  assets/          # .glb models and textures
```

## Architecture rules

- **Fixed timestep.** Physics steps at 60 Hz using an accumulator, decoupled from render rate. Rendering interpolates between physics states. Never step physics with a variable `dt`.
- **Player state machine.** Exactly one mode is active. Each mode owns its controller and camera rig and implements `enter()`, `exit()`, `update(dt)`. Entering a vehicle transfers input and camera to that vehicle; nothing else should special-case the current mode.
- **Input is abstract.** Controllers read actions (`moveForward`, `throttle`, `interact`), never raw keys. Key bindings live only in `input/`.
- **Units.** SI throughout: meters, kilograms, seconds, radians. Y is up.
- **Physics owns transforms.** Physics bodies are the source of truth; meshes copy from them each frame. Don't move a mesh that has a physics body directly.
- **Performance.** Repeated buildings and props go into the shared `InstancePool`s (`world/instancePool.ts`), never one mesh each. World meshes and colliders are only built for chunks near the player (`world/chunks.ts`); world *data* (`world/layout.ts`) is generated for everything at startup and must stay cheap. Anything placed in the world (vehicles, pickups) must cope with its chunk not being loaded (no ground collider there). Dispose of geometries, materials, and textures when removing objects.
- **Heights.** Nothing is flat: towns are hilly. Anything placed on the ground must take its height from `terrain.surfaceAt(x, z)` (sidewalks, doors, people, pickups) or `terrain.smoothHeight(x, z)` (road level, parked cars) — never a fixed `CURB_HEIGHT`.
- **Roads are a graph.** Downtown is a grid of blocks; every road (downtown's included) is an edge in `layout.streets.net`. Use `net.distance` / `net.kerb` / `net.nearest` / `net.pointAt` rather than grid maths. Suburban houses and parcels are in `layout.streets` (`houses`, `parcels`, `driveways`, `trees`), with a `yaw`.
- **Determinism.** World generation uses a seeded PRNG and hand-written noise, so the same seed always produces the same world; each cell/chunk has its own random stream (`hashSeed`) so chunks can be built in any order.

## Deployment (GitHub Pages)

- The repo is `yonisubin.github.io` (a `username.github.io` repo), so `base` in `vite.config.ts` is `'/'` and the game is served at the site root.
- Deploy `dist/` via a GitHub Actions workflow (`.github/workflows/deploy.yml`) using the official Pages actions.
- Repo Settings → Pages → Source must be set to "GitHub Actions".
- All asset paths must resolve through `import.meta.env.BASE_URL` so they work under the subpath.

## Milestones

Work on one milestone at a time. Don't start the next until the current one feels good to play.

1. **Walking.** Vite + TS scaffold, ground plane, capsule character with Rapier character controller (walk, run, jump, gravity), third-person follow camera with mouse look.
2. **City.** Seeded procedural road grid, city blocks, buildings as instanced boxes with colliders. Debug overlay showing FPS and draw calls.
3. **Driving.** Car using Rapier's raycast vehicle controller. Enter/exit with an interact key. Chase camera.
4. **Flying.** Helicopter with custom forces: collective (lift), cyclic (pitch/roll), tail rotor (yaw). Should hover stably with no input. Enter/exit like the car.
5. **Life.** NPC traffic on the road graph, pedestrians, day/night cycle, minimap.

Gameplay beyond the milestones: health (regenerates; falls and crashes hurt; death respawns at the nearest hospital minus 20% cash — 8 hospitals, `game/places.ts`), swimming (sea and lake; C/Ctrl or DIVE to dive, 12 s of breath, then drowning damage), vehicles that drive or land in deep water eject you, wreck and sink (`sim/sinking.ts`), getting out of any vehicle at any time (bailing out at speed hurts; an abandoned car brakes to a stop, a helicopter drops, a boat slows), boats (a speedboat and a jet ski on the sea and on the lake, `player/boat.ts`: buoyancy on the waves, keel drag, thrust and rudder), cash pickups, six gun stores (bat, pistol, rifle, ammo, plus per-weapon add-ons once you own the weapon: 4× scope, light grip for run speed, armour-piercing rounds), melee and gun combat, shootable traffic cars (smoke, wreck, driver drops cash), pedestrians you can chat with / who flee, fight back or get knocked out (no gore), running people over with a car (above ~11 km/h they go down and their cash goes straight to you), carjacking traffic when armed, and missions from eight fixed, invulnerable givers with a "!" marker (`game/missions.ts`): downtown Marco (delivery / package run), Vera (wreck a marked car) and Captain Reyes (helicopter ring course); Lena at Seaside (buoy swim), Farmer Joe at Eastfield (country race through gates, driving), Ranger Kim at Pinecrest (summit hike to hilltop flags, on foot), Dusty at Westbrook (long-haul delivery, wreck) and Sam in Northside (packages, wreck). Cash reward plus time bonus; fail on timeout or death. Crimes (assault, gunfire near people, carjacking, wrecking cars, attacking police) give a 0–5 star wanted level: police chase and ram (1–2★, officers arrest you on foot), shoot (3★+), set roadblocks (4★+) and send a helicopter (5★); busted = fine and wake up at one of 5 police stations. Side jobs: in a taxi, an ambulance (one at each hospital) or a van, J / JOB starts a shift of fares, patients or delivery runs, guided by the route line. Progress (money, weapons, missions, position, time, destination) autosaves to localStorage (`game/save.ts`); "⟲ New game" on the full map starts over.

The suburbs follow American sprawl (arterials on a rough half-mile grid, curving subdivisions with loops and cul-de-sacs, strip malls / gas stations / big-box on arterial corners, schools / parks / churches on arterial frontage); country roads wind with the land.

Status: all five milestones are done (day/night: `world/dayNight.ts`, 12-minute day, hold T to fast-forward; minimap: `ui/minimap.ts`; full map: `ui/fullMap.ts`, M or tap/click the minimap; click the full map for directions, `game/route.ts`). The world has since grown to ~4 km with streaming, terrain, water, hospitals and more stores (see `DEVELOPER_GUIDE.md`).

## Working style

- Keep changes small and focused on the current task. Explain any non-obvious physics or math in comments.
- If something is ambiguous (feel, controls, scale), ask rather than guess.
- Prefer clear, simple code over clever abstractions; this is a solo project that should stay easy to change.
