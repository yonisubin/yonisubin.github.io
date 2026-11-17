// The running game (simulation side): world, player, portals, fixed 60 Hz step with an accumulator,
// rendering that interpolates the eye, and window.twinfold for tests. The app shell (main.ts: menus,
// overlay, saves) starts it with startGame() and talks to it through the returned handle.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG, STEP_DT, type PortalId } from '../core/config';
import { Input } from '../input/input';
import { Physics } from '../physics/world';
import { TEST_ROOM } from '../levels/testRoom';
import { PortalSystem, type PlaceResult } from '../portals/portals';
import { teleportMatrix, teleportRotation } from '../portals/transform';
import { Player, type TeleportEvent } from '../player/controller';
import { addLights, buildLevelMeshes } from '../render/levelMeshes';
import { Fizzles, PortalVisual } from '../render/portalEffects';
import { PortalRenderer } from '../render/portalRenderer';
import { Hud } from '../ui/hud';
import { Sound } from '../audio/sound';

export interface GameHandle {
  input: Input;
  sound: Sound;
  canvas: HTMLCanvasElement;
}

export async function startGame(canvas: HTMLCanvasElement, hudRoot: HTMLElement): Promise<GameHandle> {
  await RAPIER.init();
  const level = TEST_ROOM;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x15181b);

  const camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, window.innerWidth / window.innerHeight, CONFIG.camera.near, CONFIG.camera.far);
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  const physics = new Physics();
  physics.loadLevel(level);
  const portals = new PortalSystem(physics);
  const input = new Input(canvas);
  const player = new Player(physics, portals);
  const spawnFeet = new THREE.Vector3(...level.spawn.position);
  player.spawn(spawnFeet, level.spawn.yaw);

  // No scene.background: a Color background makes three clear colour, depth AND stencil on every
  // render() call, which would wipe the portal passes. The renderer's clear colour is used instead.
  const scene = new THREE.Scene();
  addLights(scene);
  scene.add(buildLevelMeshes(level).group);
  const visuals: Record<PortalId, PortalVisual> = { a: new PortalVisual('a'), b: new PortalVisual('b') };
  scene.add(visuals.a.group, visuals.b.group);
  const fizzles = new Fizzles();
  scene.add(fizzles.group);
  const portalRenderer = new PortalRenderer(renderer, scene, portals);
  const hud = new Hud(hudRoot);
  const sound = new Sound();

  // --- Game actions ---------------------------------------------------------------------------
  const lastFire: Record<PortalId, PlaceResult | null> = { a: null, b: null };
  function fire(id: PortalId, origin?: THREE.Vector3, dir?: THREE.Vector3): PlaceResult {
    const o = origin ?? player.eye();
    const d = (dir ?? player.rig.forward()).clone().normalize();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(player.rig.orientation());
    const r = portals.fire(id, o, d, up, player.collider);
    lastFire[id] = r;
    if (r.ok) sound.portalOpen(id);
    else {
      sound.fizzle();
      if (r.point && r.normal) fizzles.spawn(r.point, r.normal, CONFIG.portal.colors[id]);
    }
    return r;
  }

  function restart(): void {
    lastTeleport = null;
    portals.clear();
    player.spawn(spawnFeet, level.spawn.yaw);
  }

  let lastTeleport: TeleportEvent | null = null;
  let stepCount = 0;
  let stepDistance = 0;
  let wasGrounded = true;
  let fallSpeed = 0;
  function fixedStep(): void {
    if (input.consume('fireA')) fire('a');
    if (input.consume('fireB')) fire('b');
    if (input.consume('restart')) restart();
    physics.world.step();
    const before = player.position.clone();
    fallSpeed = -player.velocity.y;
    const ev = player.step(STEP_DT, input);
    if (ev) {
      lastTeleport = ev;
      sound.pass(ev.speed);
    }
    // Footsteps (counted for the later "least steps" challenge) and landing thumps.
    if (player.grounded) {
      stepDistance += Math.hypot(player.position.x - before.x, player.position.z - before.z);
      if (stepDistance > 1.6) {
        stepDistance = 0;
        stepCount++;
        sound.footstep();
      }
      if (!wasGrounded && fallSpeed > 3) sound.land(fallSpeed);
    }
    wasGrounded = player.grounded;
    if (player.feetY() < CONFIG.player.killY) player.spawn(spawnFeet, level.spawn.yaw);
  }

  // --- Loop -----------------------------------------------------------------------------------
  let acc = 0;
  let last = performance.now();
  let time = 0;
  let fps = 0;
  const eye = new THREE.Vector3();
  function frame(now: number): void {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    fps = fps * 0.9 + (dt > 0 ? 1 / dt : 0) * 0.1;
    time += dt;
    const { dx, dy } = input.takeMouseDelta();
    player.rig.look(dx, dy);
    if (input.consume('debug')) hud.debugOn = !hud.debugOn;

    acc += dt;
    let steps = 0;
    while (acc >= STEP_DT && steps < CONFIG.physics.maxStepsPerFrame) {
      fixedStep();
      acc -= STEP_DT;
      steps++;
    }
    if (steps === CONFIG.physics.maxStepsPerFrame) acc = 0;

    // Interpolate the eye between the last two physics states.
    const alpha = acc / STEP_DT;
    eye.copy(player.prevEye).lerp(player.eye(), alpha);
    camera.position.copy(eye);
    camera.quaternion.copy(player.rig.orientation());

    for (const id of ['a', 'b'] as const) visuals[id].update(portals.get(id), portals.linked(), time);
    fizzles.update(dt);
    portalRenderer.render(camera);

    const v = player.velocity;
    hud.update(
      !!portals.a,
      !!portals.b,
      [
        `fps ${fps.toFixed(0)}  views ${portalRenderer.stats.views}  depth ${portalRenderer.stats.maxLevel}`,
        `pos ${player.position.x.toFixed(2)} ${player.feetY().toFixed(2)} ${player.position.z.toFixed(2)}`,
        `vel ${v.length().toFixed(2)} m/s  (h ${Math.hypot(v.x, v.z).toFixed(2)}, y ${v.y.toFixed(2)})`,
        `grounded ${player.grounded}  crouched ${player.crouched}  masked ${player.maskedPortals().map((p) => p.id).join(',') || '-'}`,
        `roll ${((player.rig.residualAngle() * 180) / Math.PI).toFixed(1)}°  passes ${player.teleports}  steps ${stepCount}`,
        `last: ${lastTeleport ? `${lastTeleport.from}→${lastTeleport.to} at ${lastTeleport.speed.toFixed(1)} m/s` : '-'}`,
        `portals ${portals.a ? 'A' : '·'}${portals.b ? 'B' : '·'}  placed ${portals.placedCount}`,
      ].join('\n'),
    );
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // --- Test / debug hook ----------------------------------------------------------------------
  const api = {
    THREE,
    config: CONFIG,
    level,
    player,
    portals,
    physics,
    input,
    renderer: portalRenderer,
    camera,
    scene,
    /** Run fixed physics steps right now, independent of frame rate. */
    simulate(seconds: number): void {
      const n = Math.round(seconds / STEP_DT);
      for (let i = 0; i < n; i++) fixedStep();
    },
    /** Fire a portal from the eye (or a given ray). Returns a plain summary. */
    fire(id: PortalId, origin?: [number, number, number], dir?: [number, number, number]) {
      const r = fire(id, origin && new THREE.Vector3(...origin), dir && new THREE.Vector3(...dir));
      return r.ok
        ? { ok: true, position: r.portal.position.toArray(), normal: r.portal.normal.toArray() }
        : { ok: false, reason: r.reason };
    },
    /** Point the view (radians). */
    aim(yaw: number, pitch: number): void {
      player.rig.reset(yaw);
      player.rig.pitch = pitch;
    },
    /** Teleport the player's feet somewhere, at rest (or with a velocity). */
    place(feet: [number, number, number], yaw = 0, velocity: [number, number, number] = [0, 0, 0]): void {
      player.spawn(new THREE.Vector3(...feet), yaw);
      player.velocity.set(...velocity);
    },
    hold(action: Parameters<Input['setHeld']>[0], on: boolean): void {
      input.setHeld(action, on);
    },
    restart,
    stepCount: () => stepCount,
    lastTeleport: () => lastTeleport,
    lastFire: (id: PortalId) => lastFire[id],
    teleportMatrix,
    teleportRotation,
    /** Render one frame now (tests). */
    renderNow(): void {
      camera.position.copy(player.eye());
      camera.quaternion.copy(player.rig.orientation());
      for (const id of ['a', 'b'] as const) visuals[id].update(portals.get(id), portals.linked(), time);
      portalRenderer.render(camera);
    },
    /** Read one pixel of the frame just rendered (call right after renderNow). 0..1 coords, y down. */
    pixel(x: number, y: number): [number, number, number] {
      const gl = renderer.getContext();
      const px = new Uint8Array(4);
      gl.readPixels(Math.floor(x * gl.drawingBufferWidth), Math.floor((1 - y) * gl.drawingBufferHeight), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return [px[0], px[1], px[2]];
    },
    ready: true,
  };
  (window as unknown as { twinfold: typeof api }).twinfold = api;
  return { input, sound, canvas };
}
