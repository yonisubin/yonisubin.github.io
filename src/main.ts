import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Input } from './input/actions';
import { TouchControls, isTouchDevice } from './input/touch';
import { PlayerStateMachine } from './player/state';
import { OnFootMode, STAND_HEIGHT } from './player/onFoot';
import { CharacterModel } from './player/character';
import { Car, DrivingMode } from './player/car';
import { FlyingMode, Helicopter } from './player/heli';
import { createCity } from './world/city';
import { CURB_HEIGHT, helipadPosition, parkingSpots } from './world/layout';
import { createSky } from './world/sky';
import { PAINT_COLORS } from './vehicles/carModel';
import type { SimEntity } from './sim/entity';
import { Traffic } from './npc/traffic';
import { Pedestrians } from './npc/pedestrians';
import { Hud } from './ui/hud';
import { Minimap, type Marker } from './ui/minimap';
import { DayNight } from './world/dayNight';
import { VehicleLight } from './sim/vehicleLight';
import { PlayerStats } from './game/stats';
import { Cash } from './game/pickups';
import { Shop } from './game/shop';
import { Combat } from './game/combat';
import { Dialogue } from './ui/dialogue';
import { Rng } from './world/rng';
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
  const touchControls = touch ? new TouchControls(input) : null;
  const minimap = new Minimap(city.layout, input, touch);
  const hud = new Hud(input, touch, minimap.size + 8);
  const debug = new DebugOverlay(renderer, input);

  const player = new PlayerStateMachine(input);
  const stats = new PlayerStats();
  const onFoot = new OnFootMode(world, scene, camera, input, city.spawn, model, stats);

  // Everything simulated each physics step besides the player.
  const entities: SimEntity[] = [stats];

  // Time of day drives the sun/moon, lit windows, street lamps and vehicle lights.
  const dayNight = new DayNight(sky, city, input);
  entities.push(dayNight);
  const vehicleLight = new VehicleLight(scene, () => dayNight.lighting.night);

  // Getting out of any vehicle: stand beside it, camera looking the way the vehicle faces.
  const getOut = (vehicle: Car | Helicopter) => {
    const spot = vehicle.findExitPoint(onFoot.shape, STAND_HEIGHT);
    const fwd = vehicle.forward(new THREE.Vector3());
    const heading = Math.atan2(-fwd.x, -fwd.z); // same convention as the camera yaw
    onFoot.placeAt(spot, heading, heading);
    player.setMode(onFoot);
  };

  // Cars the player can drive: the parked ones near the spawn (and later, jacked ones).
  const cars: Car[] = [];
  const addPlayerCar = (car: Car) => {
    const mode = new DrivingMode(car, input, camera, world, getOut, vehicleLight, stats);
    car.mode = mode;
    onFoot.interactables.push({
      label: () => 'drive',
      position: () => car.interp.currPos,
      radius: 3.2,
      activate: () => player.setMode(mode),
    });
    entities.push(car);
    cars.push(car);
  };
  for (const spot of parkingSpots(city.layout)) {
    addPlayerCar(
      new Car(world, scene, {
        type: spot.type,
        color: PAINT_COLORS[spot.colorIndex],
        position: new THREE.Vector3(spot.x, 0, spot.z),
        yaw: spot.yaw,
      }),
    );
  }

  // The helicopter, waiting on its helipad, nose toward −Z.
  const pad = helipadPosition(city.layout);
  const heli = new Helicopter(world, scene, new THREE.Vector3(pad.x, CURB_HEIGHT, pad.z), Math.PI / 2);
  const flying = new FlyingMode(heli, input, camera, world, getOut, vehicleLight, stats);
  heli.mode = flying;
  onFoot.interactables.push({
    label: () => 'fly',
    position: () => heli.interp.currPos,
    radius: 4.5,
    activate: () => player.setMode(flying),
  });
  entities.push(heli);

  // Cash lying around (collected on foot only), and the gun store near the spawn.
  const cash = new Cash(scene, city.layout, stats, () => (player.mode === onFoot ? onFoot.focus() : null));
  cash.onCollect((amount) => hud.toast(`+$${amount}`));
  entities.push(cash);
  const shop = new Shop(scene, city.layout, city.spawn, stats, input);
  onFoot.interactables.push(shop.interactable);

  // Damage feedback and death: fade out, wake up at the spawn point with full health,
  // minus some cash (weapons are kept).
  stats.onDamage((amount) => hud.hurt(amount));
  stats.onDeath(() => {
    input.setBlocked(true);
    hud.setFade(true, 'You were knocked out');
    window.setTimeout(() => {
      stats.respawn();
      onFoot.placeAt(city.spawn, 0, 0);
      player.setMode(onFoot); // leaves any vehicle where it is
      input.setBlocked(false);
      hud.setFade(false);
      hud.toast(`Lost some cash — $${stats.money} left`, 3);
    }, 2500);
  });

  // NPCs, kept in pools around wherever the player is.
  const playerPosition = () => player.mode?.focus() ?? city.spawn;
  const traffic = new Traffic(world, scene, city.layout, playerPosition, () => [
    playerPosition(),
    ...cars.map((c) => c.interp.currPos),
    heli.interp.currPos,
  ]);
  entities.push(traffic);
  // Pedestrians are copies of the player's model, so they need it to have loaded.
  const dropRng = new Rng(31337);
  const pedestrians = model
    ? new Pedestrians(scene, city.layout, model, touch ? 10 : 16, {
        player: () => ({ position: playerPosition(), onFoot: player.mode === onFoot }),
        hitPlayer: (damage) => stats.damage(damage),
        knockedOut: (position) => cash.drop(position, 5 * dropRng.int(1, 8)),
      })
    : null;
  if (pedestrians) entities.push(pedestrians);

  // Fighting on foot, and chatting with pedestrians.
  onFoot.combat = new Combat(scene, world, camera, input, stats, pedestrians, touch, (text) => hud.toast(text));
  const dialogue = pedestrians
    ? new Dialogue(camera, input, pedestrians, shop.door, () => dayNight.lighting.night > 0.5, touch)
    : null;
  if (pedestrians && dialogue) {
    const TALK_RADIUS = 2.4;
    const nobody = new THREE.Vector3(0, -1000, 0);
    onFoot.interactables.push({
      label: () => 'talk',
      position: () => pedestrians.nearestTalkable(onFoot.focus(), TALK_RADIUS)?.currPos ?? nobody,
      radius: TALK_RADIUS,
      available: () => !dialogue.active,
      activate: () => {
        const ped = pedestrians.nearestTalkable(onFoot.focus(), TALK_RADIUS);
        if (ped) dialogue.start(ped);
      },
    });
  }

  player.onChange((mode) => touchControls?.setButtons(mode.touchButtons));
  player.setMode(onFoot);

  // One fixed physics step for everything: player controls, entities, the world.
  const step = () => {
    player.update(PHYSICS_STEP); // reads input, sets vehicle controls
    for (const e of entities) e.fixedUpdate(PHYSICS_STEP);
    world.step();
    for (const e of entities) e.afterStep();
  };

  // Exposed for debugging in the console and automated tests. `simulate(s)` runs `s`
  // seconds of physics immediately, independent of the frame rate.
  const simulate = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / PHYSICS_STEP); i++) step();
  };
  (window as unknown as { game: unknown }).game = { world, camera, player, onFoot, cars, heli, traffic, pedestrians, dialogue, city, dayNight, stats, cash, shop, renderer, input, simulate };

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const viewDir = new THREE.Vector3();
  const mapMarkers = (): Marker[] => [
    ...traffic.positions().map((position) => ({ kind: 'traffic' as const, position })),
    ...cars.map((c) => ({ kind: 'car' as const, position: c.interp.currPos })),
    { kind: 'heli', position: heli.interp.currPos },
    { kind: 'shop', position: shop.door },
  ];

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
      step();
      accumulator -= PHYSICS_STEP;
    }

    const alpha = accumulator / PHYSICS_STEP;
    for (const e of entities) e.render(alpha, frameTime);
    player.render(alpha, frameTime); // after entities: vehicle cameras follow the placed meshes
    const mode = player.mode!;
    sky.update(camera, mode.focus());
    touchControls?.update();
    hud.update(mode, stats, frameTime);
    shop.render(frameTime);
    onFoot.combat?.render(frameTime);
    dialogue?.update(frameTime, mode.focus());
    minimap.update(mode.focus(), camera.getWorldDirection(viewDir), mapMarkers(), dayNight.clock);
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
