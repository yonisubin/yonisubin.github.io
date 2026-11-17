# CLAUDE.md — Twinfold (`portal/`)

## Project

**Twinfold** is a first-person physics puzzle game in the browser built around a device that opens two linked openings ("portals" in the spec below), the third game in this repo. It's served at `https://yonisubin.github.io/portal/` (the URL path is just the folder name; the game's name on screen is Twinfold, never "Portal"). The open-world city game at the site root (root `CLAUDE.md`) and Hexborne (`civilization/`) are separate projects: never import between `src/`, `civilization/src/` and `portal/src/`.

The game follows the design spec below (the user's spec, kept verbatim). Its originality rules apply: original title, facility, characters, AI overseer, dialogue, signage, art (everything is drawn in code), music and sounds. The mechanics are reimplemented; no creative content from the games the spec references.

## Stack and commands

TypeScript (strict) + Vite, **three.js** (WebGL 2, stencil buffer) for rendering, **Rapier** (`@dimforge/rapier3d-compat`) for collision and the character controller, Web Audio for synthesised sound (instead of the spec's Howler.js), IndexedDB for saves (later). Dependencies live in the root `package.json` (shared `node_modules`); ask before adding more. Run from the repo root:

```bash
npm run dev:portal        # http://localhost:5175/portal/
npm run typecheck:portal
npm run build:portal      # → portal/dist (deployed to /portal/ by its own CI job)
npm run preview:portal    # serve the build on :4175
npm run test:portal       # headless checks in portal/tests (needs build:portal + Playwright)
```

Before considering a task done: `npm run typecheck:portal`, `npm run build:portal` and `npm run test:portal` pass (add a check to `portal/tests/` for new behaviour), and the other games' builds (`npm run build`, `npm run build:civ`) still pass.

## Structure

```
portal/src/
  core/config.ts      # EVERY tunable number (movement, portal size, nudge, recursion depth, colours...)
  input/input.ts      # keyboard/mouse → abstract actions (held + edge-triggered); the only place with key codes
  physics/world.ts    # Rapier world, level brush colliders, collider registry (brush / tunnel / player)
  levels/level.ts     # level data format: box brushes with a surface tag per face (portalable/metal/glass)
  levels/testRoom.ts  # the gray-box test room (pit, chasm, launch block, ledge, glass pane, crate)
  portals/transform.ts# teleport transform M = T_B · R180(up) · T_A⁻¹ (pure maths)
  portals/portals.ts  # the two portals: placement (hitscan, tags, fit + nudge search, overlap, fizzle reasons),
                      # tunnel colliders around each hole, which portals a capsule overlaps (wall masking)
  player/controller.ts# kinematic capsule (Rapier KCC): momentum rules, crouch, manual step-up, wall masking,
                      # eye-based crossing + teleport, floor-exit boost, push-out on wall exits
  player/cameraRig.ts # yaw/pitch + residual tilt after a teleport, eased upright over ~0.5 s
  render/levelMeshes.ts   # brushes → meshes with canvas-drawn panel / metal textures, lights
  render/portalEffects.ts # opening shape, animated rim, closed swirl, stencil box geometry, fizzle bursts
  render/portalRenderer.ts# recursive stencil rendering, oblique near plane, flat colour at the depth limit
  ui/hud.ts           # crosshair with two half-rings, debug overlay (` or F3)
  audio/sound.ts      # synthesised portal open / fizzle / pass / footstep / land
  main.ts             # wiring, fixed-step loop, exposes window.twinfold for tests
portal/tests/         # Playwright checks through window.twinfold (see tests/README.md)
```

## Architecture rules

- **Fixed timestep.** Physics steps at 60 Hz with an accumulator; rendering interpolates the eye between steps. Never step physics with a variable `dt`. On a teleport the previous eye is moved through the portal too, so interpolation never smears across it.
- **Numbers live in `core/config.ts`.** No magic numbers in systems.
- **Input is abstract.** Controllers read actions (`forward`, `jump`, `fireA`), never raw keys. Bindings live only in `input/`.
- **Units.** SI throughout: metres, seconds, radians. Y is up. Portal frames: local X = right, Y = up, Z = surface normal.
- **Portals mask walls, tunnels replace them.** While a body overlaps an open portal, the brush the portal sits on is ignored by its collision filter and the portal's four tunnel colliders (lining the hole, behind the surface) collide instead. The player teleports when its *eye* crosses the portal plane inside the opening.
- **Rendering.** Portals are drawn by `PortalRenderer` with the stencil buffer. Don't give the scene a `Color` background (three then force-clears colour, depth and stencil on every `render()` call), and reset write masks before any manual clear (`gl.clear` obeys them). Every scene material gets its stencil state set by the renderer each frame.
- **Storage.** localStorage keys start with `twinfold:`; saves will use IndexedDB database `twinfold` (the other games share the origin).
- **Assets** go in `portal/public/` and are referenced through `import.meta.env.BASE_URL`. Textures and sounds are generated in code for now.

## Status

Phases 1–4 of the plan at the end of the spec are built, in the gray-box test room (`levels/testRoom.ts`):

1. Player controller with the spec's numbers (eye 1.63 m, 4.5 m/s, crouch at 1/3 speed, jump 1.1 m, gravity 11.5, terminal 38 m/s, step-up 0.45 m, air control that steers but never brakes, no fall damage).
2. Portal placement: hitscan, surface tags (white panels take portals; metal and glass fizzle), fit inside one face with a nudge search (5 cm grid within `nudgeMax`) around edges, brushes standing on the face and the other portal; fizzle burst + sound; crosshair half-rings.
3. Teleporting the player with momentum (speed kept, direction rotated), camera roll easing back upright, infinite fall (holds 38 m/s), fling, minimum exit speed out of floor portals.
4. Recursive stencil rendering with oblique clipping, flat-colour fallback at the depth limit (9), and no flash while walking through.

Not built yet (next phases): physics props and carrying (5), buttons/doors/wiring/elevators (6), pellets, grills, hazards, platforms, turrets (7), the level editor and chambers (8+), dialogue and the AI overseer, menus, saves, challenges. Restart key: R.

---

# Design spec (from the user, verbatim)

# Portal-Style Puzzle Game: Design Spec for Claude Code

Nov 16, 2026 · @Yoni

## How to use this spec

This spec describes the mechanics of a first-person physics puzzle game built around a two-ended portal device, modeled on Portal (2007) with notes on Portal 2's additions, so Claude Code can build a playable game with the same feel. Numbers are approximate, recalled rather than measured; keep them in a config file and tune by playtesting.

**Originality ground rules (important).** The mechanics can be reimplemented; the game's creative content cannot be copied. Tell Claude Code to:

- Use an original title, logo, company/facility name and branding. Do not use "Portal", "Aperture Science" or Valve marks.
- Invent an original AI antagonist, protagonist and supporting characters. Do not recreate the original AI's name, personality catchphrases, appearance or voice lines, or the original sentient turret voices.
- Write all dialogue, signage, story and jokes from scratch. Do not reuse famous lines, running gags or the end-credits song.
- Design an original look for the portal device, test chambers, cubes and turrets. A companion-style object is fine as a mechanic, but give it its own design and story role.
- Make original music and sound effects.

**Suggested prompt to Claude Code:** "Build the game in this spec as a browser game in TypeScript with three.js. Follow the phased plan in the last section, one phase at a time. Keep tunable values in a config file. Ask me before deviating from the spec."

## Game overview and structure

The player is a silent test subject moving through a sequence of sealed test chambers run by an AI overseer. Each chamber is a self-contained puzzle: reach the exit elevator by placing two linked portals on walls, floors and ceilings, moving objects, and using momentum. There is no combat skill involved; failure is falling into hazards or getting shot, followed by a quick reload.

**Structure of the original (for scale):**

- About 19 numbered test chambers (00–19), getting harder, introducing one new element at a time.
- Early chambers: no portal device (pre-placed portals that flip), then a device that fires only one portal end, then the full two-ended device.
- An escape act after the final chamber: the player breaks out of the test track into maintenance areas behind the walls, with ad-hoc puzzles and environmental storytelling.
- A final confrontation with the AI, solved with portals and physics rather than shooting.
- Total play time about 2–4 hours. Plus 6 Advanced chambers and challenge modes (see Modes).

**Core loop per chamber:** enter through elevator → observe layout → place portals → move self/objects → trigger buttons to open the exit → reach the exit → elevator ride with dialogue and a save.

**Tone:** dry dark comedy delivered by the AI's announcements, slowly revealing that the facility is abandoned and the AI is unreliable. Write your own version of this arc.

## Player controller and movement

First-person kinematic character controller with a capsule collider. Values below are approximate conversions from the original engine (1 unit ≈ 1 inch).

| Property | Value |
| --- | --- |
| Standing height / eye height | 1.83 m / 1.63 m |
| Crouch height | about 0.9 m |
| Walk/run speed | about 4.5 m/s (one speed; no sprint) |
| Crouch speed | about 1/3 of walk |
| Jump height | about 1.1 m |
| Gravity | about 11.5 m/s² (slightly lighter than real to feel floaty) |
| Max fall speed | about 38 m/s (terminal velocity cap) |
| Step-up height | about 0.45 m |
| Air control | limited: small acceleration toward input while airborne, never cancelling momentum |
| Health | dies from turret fire, energy balls, crushers, acid/water; no fall damage ("long-fall boots" excuse—write your own reason) |

**Controls:** WASD move, mouse look, Space jump, Ctrl crouch, E use/pick up, left click fires portal A, right click fires portal B, F5/F9 quicksave/quickload (the original has no restart key; add an optional chamber restart), Esc pause. Gamepad support with aim assist off by default.

**Momentum rules (critical to the feel):**

- Ground friction stops the player fast; airborne velocity is preserved.
- Exiting a portal preserves speed magnitude and rotates velocity direction to the exit portal's normal frame.
- Player cannot exceed max fall speed; this caps "infinite fall" loops.
- Landing from any height is harmless.

**Camera:** the camera rolls smoothly back to upright after exiting a portal on a wall/ceiling (about 0.5 s), never snapping. View is clipped through portals (see rendering).

## Portal device and portal mechanics

**The device** fires a projectile-less instant ray. Two portal colors (use your own palette; keep them strongly contrasting and colorblind-safe). Placing a color again moves that portal. Only two portals exist per device.

**Placement rules:**

1. Hitscan from the camera; the hit surface must be flagged *portalable* (light-colored, matte panels in the original; dark metal and glass are not).
2. Portal size about 1.2 m wide × 2.1 m tall, oriented to the surface. On floors/ceilings, the portal's "up" aligns with the player's view direction.
3. If the portal doesn't fit, nudge it toward the surface center up to a small distance; if it still doesn't fit (edges, other portal overlap, non-portalable seams), fail with a fizzle effect and sound.
4. Placement fails through glass, grilles, and on moving surfaces unless designed for it.
5. A portal that loses its surface (panel moves) closes.

**Emancipation grills ("fizzler" fields):** walking through one erases both of the player's portals and destroys any carried object (with a dissolve effect). Portal shots pass through them.

**Teleport transform.** For an object entering portal A and exiting B: position and velocity are transformed by M = T\_B · R\_180(up) · T\_A⁻¹, where T is each portal's world transform (the 180° yaw turn makes "entering the front" become "exiting the front"). Apply the same transform to orientation and angular velocity.

**Crossing detection.** Trigger when the object's center crosses the portal plane while within the portal rectangle and moving into it. During crossing, the object exists in both places: disable collision with the wall behind each portal for objects overlapping the portal, and simulate a clone at the other side so partial objects collide correctly.

**Minimum exit speed:** objects leaving a floor portal get a small upward boost so they don't fall back in and jitter.

**Portal-through-portal rules:** you can see and shoot through portals (recursion depth limit about 9 for rendering). Objects carried by the player can pass through. Lasers, bridges and gels pass through (see Test elements).

**Fling:** falling into a floor portal at speed and exiting a wall portal launches the player horizontally at that speed. This is the core advanced mechanic.

## Physics, momentum, objects

Rigid-body physics drives everything the player manipulates. Use a stable engine (Rapier) with continuous collision detection on fast objects so flung cubes don't tunnel.

**Carrying.** Pressing Use on a small physics object holds it about 1 m in front of the camera via a spring/constraint (not parenting), so it collides with the world and drops if forced too far away (about 1.5 m). The held object has its rotation locked to the view yaw. Objects can be carried through portals; the hold point follows the camera's transformed position. Player cannot stand on the object they're holding (prevents self-lifting).

**Core objects:**

| Object | Behavior |
| --- | --- |
| Weighted storage cube | \~0.65 m cube, presses buttons, blocks shots, usable as a step |
| Companion-style cube | Same physics; story object the AI asks you to bond with and later destroy (give it your own design and story) |
| Reflection cube (P2-style) | Redirects a laser beam it's facing |
| Weighted sphere/ball | Fits ball receptacles; rolls |
| Redirection pellet (P1-style) | Energy ball that bounces off walls, passes through portals, kills on contact, must be guided into a receptacle to power doors/lifts; expires after a timer and respawns from its launcher |
| Turret | Physics object; knocked over turrets shut down |
| Debris props | Chairs, monitors, cups for flavor and fun |

**Momentum through portals:** speed is conserved (magnitude), direction rotated by the portal transform. Gravity is the only accelerator; flings come from falling height. A classic setup: tall shaft with a floor portal at the bottom and a wall portal by a gap.

**Infinite fall:** two portals stacked floor/ceiling make the player fall endlessly at max speed; this is allowed and used as a gag and as a speed builder.

## Test elements and hazards

Each element has inputs/outputs so chambers can wire them together (see Level design). Names are generic; rename to suit your world.

**Inputs (sources):**

- Floor button: large plate, active while weighed down by a cube or player (P2 variants: cube-only, ball-only).
- Pedestal button: press with Use; can have a countdown timer with ticking audio.
- Energy-ball receptacle (catcher): latches when hit by a pellet.
- Laser catcher/relay: active while a laser hits it.
- Trigger volumes: invisible zones for scripting.

**Outputs (receivers):** doors, elevator exit, moving platforms (on rails, between waypoints), lifting/rotating panels, vertical lifts, indicator light strips that show wiring paths from input to output (checkbox and timer icons), signage that turns on.

**Hazards:**

| Hazard | Effect |
| --- | --- |
| Toxic liquid pool | Instant death on touch |
| Energy pellet | Instant death on touch |
| Sentry turret | Detects in a cone (\~60°) with a red laser sight, fires bullets (each \~4–10% health); knocked over or carried turrets stop firing; destroyed by fizzler or falls |
| Crusher walls / pistons | Death if caught |
| Rocket turret (finale) | Fires slow homing-ish rockets; rockets can be redirected through portals |
| Bottomless pits | Death, respawn at last checkpoint |
| Emancipation grill | Removes portals and carried objects |
| Non-portalable surfaces | Constrain solutions |

**Portal 2-style elements (optional expansion pack):**

- Laser emitter (thermal beam): damages the player on contact; redirected by reflection cubes and portals; powers laser catchers and destroys turrets.
- Light bridge: solid beam surface from an emitter, can be redirected by portals to create bridges or shields.
- Tractor funnel: slow conveyor beam that carries player/objects along it; reversible polarity.
- Launch plate: floor panel that throws the player/object along a preset arc to a target.
- Gels: liquid painted onto surfaces from dispensers and carried through portals. Bounce gel (bouncy surface, preserves vertical speed), speed gel (low friction, high max run speed), portal-conversion gel (makes any surface portalable). Water removes gel.

**Respawn:** on death, reload last autosave (chamber start or mid-chamber checkpoint). Keep death-to-retry under 2 seconds.

## Enemies and the AI antagonist

There are few enemies; the facility itself is the opponent.

**Turrets.** Behavior states: Idle (scanning sweep), Searching (target lost, sweeps for a few seconds), Active (has line of sight in cone, fires bursts), Tipped (knocked over, fires wildly briefly then shuts down), Dissolved. Picking a turret up from behind disables firing. Design an original look and original short voice barks.

**The AI overseer (original character).** A disembodied voice over chamber speakers, later revealed as a physical presence in a central chamber. Systems to build:

- Dialogue triggers: on chamber entry, on milestones, on idle time, on deaths, on doing unexpected things (breaking out of bounds). Lines queue and never overlap; subtitles always on by default.
- Voice treatment: a processed synthetic voice. Use original recorded or TTS lines with filters (pitch quantization, formant shift).
- Arc: helpful-sounding tester → passive-aggressive → openly hostile once the player escapes. Write your own jokes and lore.

**Final confrontation pattern:** the AI cannot be shot. Hazards (e.g. rocket turret) are turned against it via portals; after each hit, a component detaches and the player must drop it into a disposal unit. Each stage adds pressure (timer, neurotoxin-style gas countdown—use your own hazard), and the arena's portal surfaces shift. Ending cutscene and credits with original music.

**Environmental storytelling.** Hidden dens behind panels left by a previous test subject: scribbled walls, warnings, drawings, supplies. Write original messages and art.

## Level design and chamber progression

Chambers teach one idea at a time: introduce it safely, test it, then combine it with earlier ideas, then twist it. Keep each chamber 2–10 minutes.

**Suggested progression (original pacing, generic content):**

| # | New idea | Example puzzle |
| --- | --- | --- |
| 1 | Movement, carrying a cube, floor button | Put cube on button to open door |
| 2 | Pre-placed portal pair, flipping exit | Walk through cycling portal to reach rooms |
| 3 | One-end device (one color fixed) | Place your portal to reach a ledge |
| 4 | Energy pellet + receptacle | Redirect pellet into catcher via portals |
| 5 | Full two-ended device | Basic placement puzzles |
| 6 | Moving platforms | Portal onto a moving surface (or ride it) |
| 7 | Infinite fall and momentum | Build speed in a pit |
| 8 | Fling | Floor-to-wall launch across a gap |
| 9 | Emancipation grill | Bring the cube around the grill |
| 10 | Toxic liquid pits | Precision placement over hazards |
| 11 | Turrets | Approach from behind, knock over, block with cube |
| 12 | Companion-style cube chamber | Long multi-room chamber built around one special object, ending in an emotional twist you design |
| 13–17 | Combinations | Timed buttons + pellets + flings + turrets |
| 18 | Long finale chamber | All mechanics, ends with the AI's betrayal (design your own trap) |
| 19 | Escape | Portal out of the trap into maintenance areas |
| Escape 1–2 | Behind-the-scenes industrial levels | Catwalks, office windows, turrets lines, hidden dens |
| Finale | Boss arena | See Enemies |

**Chamber anatomy:** entry elevator with closed door → antechamber with info sign (chamber number, progress bar, icons of elements present: cube, pellet, water hazard, turret, fling, etc.) → test area → exit door gated by inputs → exit elevator (loading and autosave during ride).

**Visual language:** portalable surfaces bright white panels, non-portalable dark metal; glass for observation rooms; indicator strips show input→output wiring; clean geometry so solutions are readable.

**Level data format:** author chambers as glTF/JSON from a simple editor (or Blender): brushes with surface tags (portalable, non-portalable, glass, grill, hazard), entity list with ids, transforms and properties, wiring list connecting outputs of inputs to receivers with logic (AND/OR/NOT/timer), dialogue triggers.

## Modes, menus, settings and options

**Single-player campaign:** linear chamber sequence, chapter select for unlocked chapters, autosave at chamber start and checkpoints, manual quicksave/quickload, multiple save slots.

**Advanced chambers:** harder remixes of about 6 chambers (more hazards, fewer helpers), unlocked after finishing the story.

**Challenge modes** (unlocked after the story) on selected chambers, each with bronze/silver/gold medal thresholds and a per-chamber leaderboard:

| Challenge | Goal |
| --- | --- |
| Least portals | Finish placing the fewest portals |
| Least steps | Finish with the fewest footsteps (step counter) |
| Least time | Finish fastest (timer from entry to exit) |

**Developer-commentary-style mode (optional):** floating nodes that play audio explaining design choices. Record your own.

**Portal 2-style extras (optional):** two-player co-op with two devices (four portals), ping/marker tool, countdown sync gestures, split-screen or online; a puzzle maker with a grid-based chamber editor, element palette, wiring tool, test-play and sharing.

**Main menu:** New Game, Continue, Load Game, Chapter Select, Challenges, Advanced Chambers, Extras (commentary, credits), Options, Quit. Animated 3D background.

**Options:**

- Video: resolution, window mode, render scale, FOV (75–110), portal recursion depth, shadow quality, texture quality, anti-aliasing, motion blur, V-sync, frame cap, brightness/gamma.
- Audio: master, music, effects, voice volumes; subtitles for dialogue; closed captions for sound effects.
- Controls: key rebinding, mouse sensitivity, invert Y, raw input, gamepad layout and sensitivity, toggle vs hold crouch.
- Gameplay: crosshair portal indicator (shows which portals are placed), hints/hold-to-use prompts, difficulty assist (slow-motion during flings, wider placement tolerance) as an accessibility option.
- Accessibility: colorblind palettes for portal colors, high-contrast hazards, reduce camera roll, reduce flashing.

## Rendering, audio, UI

**Portal rendering (the hard part).** Render each visible portal as a window into the scene from a virtual camera:

1. For each portal visible to the main camera, compute virtual camera = M · camera (the teleport transform from Portal mechanics).
2. Render the scene from the virtual camera into a stencil-masked region of the portal frame (stencil approach) or into a render target texture mapped with screen-space UVs.
3. Use an oblique near clip plane aligned to the exit portal so objects behind the exit wall don't appear.
4. Recurse for portals seen through portals up to the configured depth (fall back to a flat color at the limit).
5. Draw an animated rim/edge effect per portal color and a closed-state ripple when only one portal exists.
6. Avoid the near-plane "flash" when walking through: thicken the portal into a small box or clip the camera's near plane while crossing.

**Lighting and art:** clean sterile test chambers, baked lightmaps with a few dynamic lights, glossy floors, decals for wear. Behind-the-scenes areas darker, rustier, industrial. Physics objects with emissive details. Original designs throughout.

**Audio:** footsteps by surface, portal open/close/fail sounds per color, carry hum, button clicks, door servos, pellet whine, turret sounds, elevator music, ambient room tone, adaptive music stingers on milestones. All dialogue routed through a dialogue manager with priorities, ducking and subtitles.

**HUD:** minimal. Crosshair with two half-ring indicators showing which portal colors are placed; use prompts on hover; damage vignette in red; no health bar; no ammo. Chamber info signs in the world instead of HUD text.

**Pause menu:** Resume, Save, Load, Options, Restart chamber, Quit to menu.

## Implementation plan for Claude Code

Get the portal teleport and portal rendering rock-solid in a gray-box room before building any content; everything else depends on them feeling right.

**Suggested stack:** TypeScript, Vite, three.js (WebGL2, stencil buffer), Rapier 3D (WASM) for physics, Howler.js or Web Audio for sound, a JSON level format plus an in-browser level editor, IndexedDB for saves.

**Modules:**

- `core/config.ts` — every tunable number (speeds, gravity, portal size, recursion depth).
- `player/` — character controller, input mapping, carry system, camera roll recovery.
- `portals/` — placement raycast and fit/nudge logic, portal pair state, teleport transform, crossing detection, wall-collision masking, object clones while crossing.
- `render/` — portal stencil/render-target pipeline, oblique clipping, recursion, effects, post-processing.
- `physics/` — Rapier world, collision groups (player, props, portal-masked walls, triggers), CCD.
- `elements/` — buttons, doors, platforms, pellets, turrets, grills, hazards, lasers, bridges, funnels, launch plates, gels; each with inputs/outputs.
- `logic/` — wiring graph (AND/OR/NOT/timer), trigger volumes, scripted sequences.
- `dialogue/` — line queue, priorities, subtitles, voice playback.
- `levels/` — loader, chamber list, checkpoints, save/load.
- `editor/` — gray-box brush editor with surface tagging and entity/wiring placement.
- `ui/` — menus, options, HUD, challenge timers/counters, leaderboards (local).

**Phased build:**

1. Player controller in a gray-box room with correct movement numbers.
2. Portal placement with surface tags, fit/nudge, fizzle feedback.
3. Teleport of the player through portals with momentum and camera roll recovery; infinite fall and fling working.
4. Portal rendering with stencil, oblique clipping, recursion; seamless walk-through with no flash.
5. Physics props, carrying, props through portals with dual-sided collision.
6. Buttons, doors, wiring graph, exit elevator, chamber loading.
7. Pellets, grills, hazards, moving platforms, turrets.
8. Level editor and data format; build chambers 1–10.
9. Dialogue system and the original AI character; chambers 11–19.
10. Escape levels and boss fight.
11. Menus, options, saves, chapter select, accessibility.
12. Challenge modes and advanced chambers.
13. Optional: lasers, light bridges, funnels, launch plates, gels; co-op; puzzle maker.
14. Art, audio, music pass; performance and polish.

**Testing:** unit tests for the teleport transform (position, velocity, orientation round-trip), automated tests that drop props through portal pairs at many angles and speeds, a debug overlay (portal frames, velocities, collision masks), and a scripted solution replay per chamber so changes don't break solvability.

**Tip for working with Claude Code:** start with phases 1–4 only and playtest feel before anything else; give it this doc and one phase at a time.
