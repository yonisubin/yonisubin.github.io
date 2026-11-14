# CLAUDE.md

## Project

A small open-world city game that runs entirely in the browser. The player can walk, drive cars, and fly a helicopter through a procedurally generated city. Single-player, no backend. Deployed as static files to GitHub Pages.

## Stack

- **TypeScript** (strict mode) + **Vite**
- **three.js** for rendering (WebGL 2)
- **Rapier** via `@dimforge/rapier3d-compat` for physics (the compat build embeds the WASM, which avoids Vite/WASM loading issues)
- Assets: Kenney.nl CC0 low-poly kits (city, cars, characters) as `.glb` (kenney.nl is blocked from the cloud dev environment; download kits locally if needed)
  - Player character: `public/assets/characters/soldier.glb`, the three.js "Soldier" example model (Mixamo character with Idle/Walk/Run clips; free to use in games, not CC0)
  - Buildings, roads, sidewalks and ground are procedural (facade shader in `world/facadeMaterial.ts`, canvas textures in `world/textures.ts`), not models
  - Cars and the helicopter are procedural too (`vehicles/carModel.ts`, `vehicles/heliModel.ts`); pedestrians are tinted clones of the Soldier

Do not add new dependencies without asking first.

## Commands

```bash
npm install
npm run dev        # local dev server
npm run build      # type-check + production build to dist/
npm run preview    # serve the production build locally
npm run typecheck  # tsc --noEmit
```

Before considering any task done, `npm run typecheck` and `npm run build` must both pass.

For automated checks, `window.game` exposes the world, player, vehicles and NPCs, and `game.simulate(seconds)` runs fixed physics steps immediately (independent of frame rate — headless browsers render very slowly).

## Structure

```
src/
  main.ts          # renderer setup, game loop, fixed physics step
  world/           # city generation (layout, city meshes, sky), road graph + traffic lights
  player/
    state.ts       # player state machine: OnFoot | Driving | Flying
    onFoot.ts      # Rapier kinematic character controller
    character.ts   # animated character model (player + pedestrian clones)
    car.ts         # Rapier raycast vehicle controller + DrivingMode
    heli.ts        # custom helicopter forces + FlyingMode
  vehicles/        # procedural car / helicopter models
  npc/             # traffic and pedestrians (pooled around the player)
  sim/             # SimEntity interface, body interpolation, exit-spot helper
  camera/          # follow camera (on foot), chase camera (vehicles)
  input/           # keyboard/touch → abstract actions
  ui/              # HUD, debug overlay
public/
  assets/          # .glb models and textures
```

## Architecture rules

- **Fixed timestep.** Physics steps at 60 Hz using an accumulator, decoupled from render rate. Rendering interpolates between physics states. Never step physics with a variable `dt`.
- **Player state machine.** Exactly one mode is active. Each mode owns its controller and camera rig and implements `enter()`, `exit()`, `update(dt)`. Entering a vehicle transfers input and camera to that vehicle; nothing else should special-case the current mode.
- **Input is abstract.** Controllers read actions (`moveForward`, `throttle`, `interact`), never raw keys. Key bindings live only in `input/`.
- **Units.** SI throughout: meters, kilograms, seconds, radians. Y is up.
- **Physics owns transforms.** Physics bodies are the source of truth; meshes copy from them each frame. Don't move a mesh that has a physics body directly.
- **Performance.** Use `InstancedMesh` for repeated buildings and props. Merge static geometry where possible. Generate the city in chunks so it can be streamed in later. Dispose of geometries, materials, and textures when removing objects.
- **Determinism.** City generation uses a seeded PRNG so the same seed always produces the same city.

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

Status: milestones 1–4 are done; in 5, traffic (with traffic lights) and pedestrians are done, day/night and the minimap are not.

## Working style

- Keep changes small and focused on the current task. Explain any non-obvious physics or math in comments.
- If something is ambiguous (feel, controls, scale), ask rather than guess.
- Prefer clear, simple code over clever abstractions; this is a solo project that should stay easy to change.
