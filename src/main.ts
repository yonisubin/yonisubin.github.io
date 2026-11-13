import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Input } from './input/actions';
import { TouchControls, isTouchDevice } from './input/touch';
import { PlayerStateMachine } from './player/state';
import { OnFootMode } from './player/onFoot';
import { CharacterModel } from './player/character';
import { createCity } from './world/city';
import { createSky } from './world/sky';
import { createHud } from './ui/hud';
import { DebugOverlay } from './ui/debug';

// Physics runs at a fixed 60 Hz regardless of display refresh rate.
const PHYSICS_STEP = 1 / 60; // s
// If a frame takes longer than this (tab was hidden, debugger pause), simulate only this much.
// Otherwise we'd try to catch up with hundreds of steps at once ("spiral of death").
const MAX_FRAME_TIME = 0.25; // s
// Same seed → same city. Change it for a different city.
const CITY_SEED = 1337;

async function main(): Promise<void> {
  const loading = showLoading();

  // The compat build embeds the WASM as base64; init() decodes and instantiates it.
  // The character downloads in parallel. If it fails we fall back to a capsule.
  const [, model] = await Promise.all([
    RAPIER.init(),
    CharacterModel.load().catch((err: unknown) => {
      console.warn('Character model failed to load; using a capsule instead.', err);
      return null;
    }),
  ]);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // Filmic tone mapping compresses the bright sky and sunlit surfaces like a camera would.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.2, 1500);
  const sky = createSky(renderer, scene);

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = PHYSICS_STEP;

  const city = createCity(scene, world, CITY_SEED);

  const input = new Input(renderer.domElement);
  const touch = isTouchDevice();
  if (touch) new TouchControls(input);
  createHud(input, touch);
  const debug = new DebugOverlay(renderer, input);

  const player = new PlayerStateMachine();
  const onFoot = new OnFootMode(world, scene, camera, input, city.spawn, model);
  player.setMode(onFoot);

  // Exposed for debugging in the console and automated smoke tests.
  (window as unknown as { game: unknown }).game = { world, player, onFoot, city, renderer };

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  loading.remove();

  // Fixed-timestep loop with an accumulator:
  // real elapsed time is poured into `accumulator`, and we drain it in exact PHYSICS_STEP
  // chunks. The leftover fraction (alpha = accumulator / step) says how far the real "now"
  // is between the last two physics states; rendering interpolates by that amount.
  let accumulator = 0;
  let last = performance.now();
  renderer.setAnimationLoop((now: number) => {
    const frameTime = Math.min((now - last) / 1000, MAX_FRAME_TIME);
    last = now;
    accumulator += frameTime;

    while (accumulator >= PHYSICS_STEP) {
      player.update(PHYSICS_STEP);
      world.step();
      accumulator -= PHYSICS_STEP;
    }

    player.render(accumulator / PHYSICS_STEP, frameTime);
    sky.update(camera, onFoot.debug.position);
    renderer.render(scene, camera);
    debug.update(frameTime);
  });
}

function showLoading(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#ccc;font:16px system-ui,sans-serif';
  el.textContent = 'Loading city…';
  document.body.appendChild(el);
  return el;
}

main().catch((err) => {
  console.error(err);
  document.body.textContent = `Failed to start: ${String(err)}`;
});
