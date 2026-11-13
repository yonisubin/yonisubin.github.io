import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Input } from './input/actions';
import { PlayerStateMachine } from './player/state';
import { OnFootMode } from './player/onFoot';
import { createTestLevel } from './world/ground';
import { createHud } from './ui/hud';

// Physics runs at a fixed 60 Hz regardless of display refresh rate.
const PHYSICS_STEP = 1 / 60; // s
// If a frame takes longer than this (tab was hidden, debugger pause), simulate only this much.
// Otherwise we'd try to catch up with hundreds of steps at once ("spiral of death").
const MAX_FRAME_TIME = 0.25; // s

async function main(): Promise<void> {
  // The compat build embeds the WASM as base64; init() decodes and instantiates it.
  await RAPIER.init();

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fc9ef);
  scene.fog = new THREE.Fog(0x9fc9ef, 60, 220);

  const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 500);

  scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a5a3a, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(30, 50, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = -50;
  s.right = 50;
  s.top = 50;
  s.bottom = -50;
  s.far = 150;
  scene.add(sun);

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = PHYSICS_STEP;

  createTestLevel(scene, world);

  const input = new Input(renderer.domElement);
  createHud(input);

  const player = new PlayerStateMachine();
  const onFoot = new OnFootMode(world, scene, camera, input);
  player.setMode(onFoot);

  // Exposed for debugging in the console and automated smoke tests.
  (window as unknown as { game: unknown }).game = { world, player, onFoot };

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

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
    renderer.render(scene, camera);
  });
}

main().catch((err) => {
  console.error(err);
  document.body.textContent = `Failed to start: ${String(err)}`;
});
