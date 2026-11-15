# Developer guide: how this game is built, and why

This document explains the whole codebase: what each part does, which libraries it uses, how the parts talk to each other, and the decisions (and trade-offs) behind them. Read it top to bottom once; after that, use it as a map. `CLAUDE.md` is the short rules file; this is the long explanation.

---

## 1. The big picture

A single-player open-world city game that runs entirely in the browser. You walk, drive cars and fly a helicopter through a procedurally generated city with traffic, pedestrians, a day/night cycle, a gun store, combat and missions. No server: it's a folder of static files hosted on GitHub Pages at the root of `https://yonisubin.github.io/`.

**Everything procedural except people.**
- Buildings, roads, sidewalks, trees, cars, the helicopter and all textures are generated in code at startup. This keeps the download small and avoids licensing issues.
- The only downloaded art is the people: 15 CC0 characters, about 3 MB in total.

### How the work was done (history)

The project followed the milestones in `CLAUDE.md`, one commit each, then gameplay layers on top. `git log` tells the story:

| Commit | What it added |
|---|---|
| `b5627a6` | Vite + TypeScript scaffold, Milestone 1 (walking), GitHub Pages deploy workflow |
| `2c9e533` | Removed the old personal website; the repo is now only the game |
| `66938e6` | Touch controls for phones (floating joystick, drag-to-look, buttons) |
| `2beb065` | Milestone 2: procedural city, animated character, realistic lighting |
| `853f4c6`, `cd61d5c` | Lighting fixes, including the phone "black surfaces" bug (see §6.4) |
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
- **Menus and toggles:** `characterMenu`, `timeSkip`, `toggleMap`, `toggleDebug`.

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
- **Determinism:** the city comes from a seeded PRNG (`CITY_SEED = 1337`), so it is the same every time.

---

## 4. The city (`src/world/`)

### 4.1 Layout as plain data (`layout.ts`, `rng.ts`)

`generateCity(seed)` returns plain data with no three.js and no physics: blocks, buildings, trees, lamps, roof props, parking spots, the helipad and the spawn point.

- **Grid:** 8 × 8 blocks.
- **Each block:** 64 m square, made of a 56 m lot plus 4 m sidewalks.
- **Roads:** 14 m wide (4 lanes × 3.5 m).
- **Curbs:** blocks sit on a 15 cm raised slab, low enough for the walking controller to step up automatically.
- **Building styles:** three, matching the facade shader: glass tower, brick, concrete.

**Determinism.** `rng.ts` uses **mulberry32**, a tiny, good-quality 32-bit PRNG. `hashSeed(seed, x, z)` gives every block its own independent random stream. A block's content therefore doesn't depend on the order blocks are generated, which is what makes chunk streaming possible later.

### 4.2 Meshes and colliders (`city.ts`)

Turns the layout into geometry. **Every repeated thing is one `InstancedMesh`** (all buildings, all trees, all lamps…), so the whole city is about a dozen draw calls. Each building also gets a Rapier box collider. The ground is split into 100 m collider tiles. One huge collider caused the character to sink into it, because of floating-point precision far from the collider's centre.

### 4.3 Procedural facades (`facadeMaterial.ts`)

All buildings share one unit box, stretched per instance. A stretched texture would look smeared, so a custom **fragment shader** draws the windows mathematically, from the pixel's position *in metres* on the facade. It works out the column and floor and decides: window, shopfront, sign, wall or roof.

Per-instance data:
- the wall colour;
- the style;
- a seed that varies curtains, which windows are lit at night, and sign colours.

Glass is shiny and slightly metallic, so it reflects the sky. That reflection is most of what makes the buildings look real. It's injected into three.js's standard material with `onBeforeCompile`, so lighting and shadows still work.

### 4.4 Textures (`textures.ts`)

Asphalt, sidewalk, grass, the helipad and glow sprites are painted onto a `<canvas>` at startup and tiled seamlessly. There are no image downloads.

### 4.5 Sky, sun and lighting (`sky.ts`, `dayNight.ts`)

- **Sky:** three.js `Sky` (physically based Rayleigh/Mie scattering).
- **Sun:** one directional light that is the sun by day and the moon by night, with shadows (2048² map). The shadow box follows the player.
- **Ambient light:** a hemisphere fill light plus an **environment map**, which supplies reflections and soft sky light.
- **Tone mapping:** ACES filmic, exposure 1.2.
- **Day/night** (`dayNight.ts`):
  - A 12-minute day, starting at 10:00. Hold **T** to fast-forward ×40.
  - Time advances with the *physics* clock, so it's deterministic and testable.
  - Every frame it drives the sun/moon, sky, lit windows, street lamps and vehicle headlights.

**Decision: the environment map is a baked gradient, not the `Sky`.** Baking the physical sky into an environment map produced extremely bright values. On many phones these overflowed the half-float render target, which made surfaces render black (the bug you reported from your phone). A hand-made gradient environment, at intensity 3.0, looks almost the same and is safe everywhere.

### 4.6 Road graph and traffic lights (`roadGraph.ts`)

Intersections are nodes. Each road segment has one inner driving lane per direction (traffic keeps right; the outer lanes are parking). A car's route is a chain of pieces:
- **lane:** straight along the road;
- **turn:** a quadratic Bézier curve through the intersection (left, right or straight).

`lightState(i, j, dir, time)` gives each intersection a 24 s cycle in which north–south and east–west alternate.

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

## 6. Life in the city (`src/npc/`)

### 6.1 Traffic (`traffic.ts`)

- **Pool:** 24 cars kept around the player. They spawn 60–220 m away and are recycled beyond 260 m.
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

### 6.3 Minimap (`ui/minimap.ts`)

- The city is drawn once to an off-screen canvas at 1 px per metre.
- Each frame that picture is rotated so your view direction points up.
- Markers: cars, the helicopter, traffic, the shop, mission givers, objectives.
- It zooms out as you gain altitude. **M** toggles it.

---

## 7. Gameplay systems (`src/game/`, `src/ui/`)

### 7.1 Health, money, weapons (`game/stats.ts`)

- **Health:** 100. Regen starts 6 s after the last damage, at 5 health per second.
- **Death:**
  1. Fade to "You were knocked out" (`main.ts`).
  2. Respawn at the spawn point after 2.5 s, minus 20% of your cash. You keep your weapons.
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

Glowing, spinning bundles placed with the city's seeded RNG. Walk over one to collect it; it comes back after 2 minutes. Knocked-out pedestrians drop one-off cash. All bundles render as one `InstancedMesh`.

### 7.4 Gun store (`game/shop.ts`)

A shopfront with a lit sign on the building nearest the spawn. **E** at the door opens the buy menu (weapons, ammo, add-ons). Input is blocked while the menu is open.

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

- **InstancedMesh everywhere** for repeated things (buildings, trees, lamps, traffic parts, cash). The city costs about a dozen draw calls.
- **One draw call per person** (merged meshes + vertex colours + one shared material).
- **Typical busy street:** ~150 draw calls and ~830k triangles.
- **Character distance limits:** pedestrian animation freezes beyond 70 m, and pedestrians are hidden beyond 90 m.
- **Rendering settings:** pixel ratio capped at 2; shadows only from the sun, with a box that follows the player.
- **Lights:** a fixed set of lights (the shared vehicle light), because changing the number of lights recompiles shaders.
- **No downloaded textures:** canvas textures and shader-drawn facades.
- **Dispose** geometries/materials/textures when removing objects (rule in `CLAUDE.md`).
- **City layout generated per block** from `(seed, x, z)`, ready for chunk streaming if the city grows.

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
| Change the city size or road widths | `world/layout.ts` (`BLOCKS`, `ROAD_WIDTH`…) |
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
- The city is generated all at once; it's structured for chunk streaming but doesn't stream yet.
- Audio doesn't exist yet.
