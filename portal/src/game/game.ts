// The running game (simulation side): renderer, world, player, portals and the GameSession; the
// fixed 60 Hz step with an accumulator, rendering that interpolates between steps, and
// window.twinfold for tests. The app shell (main.ts: menus, overlay, saves) starts it with
// startGame() and talks to it through the returned handle (session + events).
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG, STEP_DT, type PortalId } from '../core/config';
import type { EventBus, GameEventName, GameEvents } from '../core/events';
import type { GameSession } from '../core/session';
import { Input } from '../input/input';
import { Physics } from '../physics/world';
import { TEST_ROOM } from '../levels/testRoom';
import { FIXED_ROOM, SANDBOX } from '../levels/sandbox';
import { PortalSystem } from '../portals/portals';
import { teleportMatrix, teleportRotation } from '../portals/transform';
import { Player } from '../player/controller';
import { Effects } from '../render/effects';
import { addLights } from '../render/levelMeshes';
import { Fizzles, PortalVisual } from '../render/portalEffects';
import { PortalRenderer } from '../render/portalRenderer';
import { Hud } from '../ui/hud';
import { Sound } from '../audio/sound';
import { Session } from './session';

export interface GameHandle {
  input: Input;
  sound: Sound;
  canvas: HTMLCanvasElement;
  /** Load chambers, restart, respawn, save/restore, pause, settings (contract: core/session.ts). */
  session: GameSession;
  /** Everything the simulation reports (contract: core/events.ts). Same bus as session.events. */
  events: EventBus;
}

/** Built-in gray-box levels (the shell's chamber list adds its own). */
export const BUILTIN_LEVELS = { testroom: TEST_ROOM, sandbox: SANDBOX, fixedroom: FIXED_ROOM };

const EVENT_NAMES: GameEventName[] = [
  'chamberStart', 'exitReached', 'elevatorDone', 'autosave', 'checkpoint', 'death', 'respawn', 'damage', 'portalPlaced', 'teleport',
  'output', 'pickup', 'drop', 'fizzled', 'trigger', 'idle', 'outOfBounds', 'footstep', 'boss', 'prompt', 'sfx',
];

export async function startGame(canvas: HTMLCanvasElement, hudRoot: HTMLElement): Promise<GameHandle> {
  await RAPIER.init();

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true });
  let renderScale = 1;
  const applyPixelRatio = () => renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * renderScale);
  applyPixelRatio();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x15181b);

  const camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, window.innerWidth / window.innerHeight, CONFIG.camera.near, CONFIG.camera.far);
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  const physics = new Physics();
  const portals = new PortalSystem(physics);
  const input = new Input(canvas);
  const player = new Player(physics, portals);

  // No scene.background: a Color background makes three clear colour, depth AND stencil on every
  // render() call, which would wipe the portal passes. The renderer's clear colour is used instead.
  const scene = new THREE.Scene();
  addLights(scene);
  const visuals: Record<PortalId, PortalVisual> = { a: new PortalVisual('a'), b: new PortalVisual('b') };
  scene.add(visuals.a.group, visuals.b.group);
  const fizzles = new Fizzles();
  scene.add(fizzles.group);
  const effects = new Effects();
  scene.add(effects.group);
  const portalRenderer = new PortalRenderer(renderer, scene, portals);
  const hud = new Hud(hudRoot);
  const sound = new Sound();

  const session = new Session({
    physics,
    portals,
    player,
    input,
    scene,
    effects,
    view: {
      setFov(deg) {
        camera.fov = deg;
        camera.updateProjectionMatrix();
      },
      setRenderScale(s) {
        renderScale = s;
        applyPixelRatio();
        renderer.setSize(window.innerWidth, window.innerHeight);
      },
      setRecursionDepth(n) {
        portalRenderer.recursionDepth = n;
      },
      setPortalColors(c) {
        visuals.a.setColor(c.a);
        visuals.b.setColor(c.b);
        portalRenderer.colors = { ...c };
      },
      fizzle(point, normal, id) {
        fizzles.spawn(point, normal, session.settings.portalColors[id]);
      },
      sound,
    },
  });
  const events = session.events;
  events.on('footstep', () => sound.footstep());

  // Event log for tests (bounded).
  const log: [GameEventName, unknown][] = [];
  for (const name of EVENT_NAMES) {
    events.on(name, (p: GameEvents[typeof name]) => {
      log.push([name, p]);
      if (log.length > 5000) log.splice(0, 1000);
    });
  }

  const params = new URLSearchParams(location.search);
  const startId = params.get('chamber') as keyof typeof BUILTIN_LEVELS | null;
  session.loadChamber(startId && BUILTIN_LEVELS[startId] ? BUILTIN_LEVELS[startId] : TEST_ROOM);

  // --- Loop -----------------------------------------------------------------------------------
  let acc = 0;
  let last = performance.now();
  let time = 0;
  let fps = 0;
  const eye = new THREE.Vector3();
  function draw(alpha: number, dt: number): void {
    eye.copy(player.prevEye).lerp(player.eye(), alpha);
    camera.position.copy(eye);
    camera.quaternion.copy(player.rig.orientation());
    for (const id of ['a', 'b'] as const) visuals[id].update(portals.get(id), portals.linked(), time);
    session.chamber?.render(alpha, dt);
    effects.update(dt);
    fizzles.update(dt);
    portalRenderer.render(camera);
  }

  function frame(now: number): void {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    fps = fps * 0.9 + (dt > 0 ? 1 / dt : 0) * 0.1;
    time += dt;
    const { dx, dy } = input.takeMouseDelta();
    if (!session.isPaused()) {
      player.rig.look(dx, dy);
      if (dx || dy) session.noteActivity();
    }
    if (input.consume('debug')) hud.debugOn = !hud.debugOn;

    if (!session.isPaused()) acc += dt * session.timeScale();
    let steps = 0;
    while (acc >= STEP_DT && steps < CONFIG.physics.maxStepsPerFrame) {
      session.fixedStep();
      acc -= STEP_DT;
      steps++;
    }
    if (steps === CONFIG.physics.maxStepsPerFrame) acc = 0;
    draw(acc / STEP_DT, dt);

    const v = player.velocity;
    const c = session.chamber;
    const lt = session.lastTeleport;
    hud.update(
      !!portals.a,
      !!portals.b,
      [
        `fps ${fps.toFixed(0)}  views ${portalRenderer.stats.views}  depth ${portalRenderer.stats.maxLevel}`,
        `pos ${player.position.x.toFixed(2)} ${player.feetY().toFixed(2)} ${player.position.z.toFixed(2)}`,
        `vel ${v.length().toFixed(2)} m/s  (h ${Math.hypot(v.x, v.z).toFixed(2)}, y ${v.y.toFixed(2)})`,
        `grounded ${player.grounded}  crouched ${player.crouched}  masked ${player.maskedPortals().map((p) => p.id).join(',') || '-'}`,
        `roll ${((player.rig.residualAngle() * 180) / Math.PI).toFixed(1)}°  passes ${player.teleports}  health ${c ? c.health.toFixed(0) : '-'}`,
        `last: ${lt ? `${lt.from}→${lt.to} at ${lt.speed.toFixed(1)} m/s` : '-'}`,
        `portals ${portals.a ? 'A' : '·'}${portals.b ? 'B' : '·'}  counters ${JSON.stringify(session.counters(), (_k, x) => (typeof x === 'number' ? Math.round(x * 10) / 10 : x))}`,
        `chamber ${c?.chamberId() ?? '-'}  held ${c?.heldId() ?? '-'}`,
      ].join('\n'),
    );
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // --- Test / debug hook ----------------------------------------------------------------------
  const api = {
    THREE,
    config: CONFIG,
    get level() {
      return session.current();
    },
    levels: BUILTIN_LEVELS,
    session,
    events,
    /** Every event emitted so far: [name, payload]. */
    log,
    get chamber() {
      return session.chamber;
    },
    element(id: string) {
      return session.chamber?.elements.get(id) ?? null;
    },
    player,
    portals,
    physics,
    effects,
    input,
    renderer: portalRenderer,
    camera,
    scene,
    /** Run fixed physics steps right now, independent of frame rate. */
    simulate(seconds: number): void {
      const n = Math.round(seconds / STEP_DT);
      for (let i = 0; i < n; i++) session.fixedStep();
    },
    /** Fire a portal from the eye (or a given ray). Returns a plain summary. */
    fire(id: PortalId, origin?: [number, number, number], dir?: [number, number, number]) {
      const r = session.fire(id, origin && new THREE.Vector3(...origin), dir && new THREE.Vector3(...dir));
      return r.ok
        ? { ok: true, position: r.portal.position.toArray(), normal: r.portal.normal.toArray() }
        : { ok: false, reason: r.reason };
    },
    /** Press Use now (pick up / drop / press). */
    use(): void {
      session.chamber?.use();
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
    restart: () => session.restartChamber(),
    stepCount: () => session.counters().steps,
    lastTeleport: () => session.lastTeleport,
    lastFire: (id: PortalId) => session.lastFire[id],
    teleportMatrix,
    teleportRotation,
    /** Render one frame now (tests). */
    renderNow(): void {
      draw(1, 0);
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
  return { input, sound, canvas, session, events };
}
