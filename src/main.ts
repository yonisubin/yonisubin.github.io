import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Input } from './input/actions';
import { TouchControls, isTouchDevice } from './input/touch';
import { PlayerStateMachine } from './player/state';
import { OnFootMode, STAND_HEIGHT } from './player/onFoot';
import { CharacterLibrary } from './player/characterLibrary';
import { CharacterPicker, hasSavedLook, loadLook } from './ui/characterPicker';
import { Car, DrivingMode } from './player/car';
import { FlyingMode, Helicopter } from './player/heli';
import { createCity } from './world/city';
import { createWorldMap } from './world/mapImage';
import { Water } from './world/water';
import { createPlaces } from './game/places';
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
import { Smoke } from './sim/smoke';
import { Missions } from './game/missions';
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
  // The character roster + shared animations download in parallel, then the player's own
  // character (the rest stream in later). If anything fails we fall back to a capsule.
  const [, library] = await Promise.all([
    RAPIER.init(),
    CharacterLibrary.load().catch((err: unknown) => {
      console.warn('Characters failed to load; using a capsule instead.', err);
      return null;
    }),
  ]);
  const look = library ? loadLook(library) : null;
  const model = library && look ? await library.create(look).catch(() => null) : null;
  library?.preloadAll();

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
  const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.2, 2500);
  const sky = createSky(renderer, scene);

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = PHYSICS_STEP;

  const city = createCity(scene, world, CITY_SEED);
  // Hospitals and extra gun stores take over a few town blocks: before any chunk is built.
  const places = createPlaces(city.layout, scene);
  // Build the chunks around the spawn now; the rest of the world streams in while you play.
  city.streamer.loadAround(city.spawn, 450);
  // The sea and the lake (waves advance with the physics clock).
  const water = new Water(scene, (x, z) => city.terrain.heightAt(x, z));

  const input = new Input(renderer.domElement);
  const touch = isTouchDevice();
  const touchControls = touch ? new TouchControls(input) : null;
  const minimap = new Minimap(createWorldMap(city.layout, city.terrain, city.coarse), input, touch);
  const hud = new Hud(input, touch, minimap.size + 8);
  const debug = new DebugOverlay(renderer, input);

  const player = new PlayerStateMachine(input);
  const stats = new PlayerStats();
  const onFoot = new OnFootMode(world, scene, camera, input, city.spawn, model, stats);
  onFoot.water = (x, z) => water.surfaceAt(x, z);

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

  // Vehicles in deep water sink. If you're in one, you're thrown out into the water beside it.
  const deepWater = (x: number, z: number) => (water.depthAt(x, z) > 1.0 ? water.surfaceAt(x, z) : null);
  const onSink = (vehicle: Car | Helicopter) => {
    const p = vehicle.interp.currPos;
    const surface = water.surfaceAt(p.x, p.z) ?? p.y;
    for (let k = 0; k < 6; k++) {
      smoke.emit(new THREE.Vector3(p.x + (Math.random() - 0.5) * 3, surface + 0.3, p.z + (Math.random() - 0.5) * 3), 0, 1.4);
    }
    if (player.mode !== vehicle.mode) return;
    const fwd = vehicle.forward(new THREE.Vector3());
    const heading = Math.atan2(-fwd.x, -fwd.z);
    // Beside the driver's door (the vehicle's left, −Z in its own frame), floating at the surface.
    const left = new THREE.Vector3(fwd.z, 0, -fwd.x).normalize();
    const spot = new THREE.Vector3(p.x, surface - 0.25, p.z).addScaledVector(left, vehicle instanceof Helicopter ? 3.5 : 2.4);
    onFoot.placeAt(spot, heading, heading);
    player.setMode(onFoot);
    hud.toast(vehicle instanceof Helicopter ? 'The helicopter is sinking!' : 'Your car is sinking!', 2.5);
  };

  // Cars the player can drive: the parked ones near the spawn (and later, jacked ones).
  const cars: Car[] = [];
  const addPlayerCar = (car: Car) => {
    const mode = new DrivingMode(car, input, camera, world, getOut, vehicleLight, stats);
    car.mode = mode;
    car.sinking.water = deepWater;
    car.onSink = onSink;
    onFoot.interactables.push({
      label: () => 'drive',
      position: () => car.interp.currPos,
      radius: 3.2,
      available: () => !car.sinking.active && !car.gone,
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
        respawn: true,
      }),
    );
  }

  // Two cars outside every hospital, so there's something to drive after waking up.
  for (const h of places.hospitals) {
    for (const spot of h.parking) {
      addPlayerCar(
        new Car(world, scene, {
          type: spot.type,
          color: PAINT_COLORS[spot.colorIndex],
          position: new THREE.Vector3(spot.x, 0, spot.z),
          yaw: spot.yaw,
          respawn: true,
        }),
      );
    }
  }

  // The helicopter, waiting on its helipad, nose toward −Z.
  const pad = helipadPosition(city.layout);
  const heli = new Helicopter(world, scene, new THREE.Vector3(pad.x, CURB_HEIGHT, pad.z), Math.PI / 2);
  const flying = new FlyingMode(heli, input, camera, world, getOut, vehicleLight, stats);
  heli.mode = flying;
  heli.sinking.water = deepWater;
  heli.onSink = onSink;
  onFoot.interactables.push({
    label: () => 'fly',
    position: () => heli.interp.currPos,
    radius: 4.5,
    available: () => !heli.sinking.active,
    activate: () => player.setMode(flying),
  });
  entities.push(heli);

  // Cash lying around (collected on foot only), and the gun store near the spawn.
  const cash = new Cash(
    scene,
    city.layout,
    stats,
    () => (player.mode === onFoot ? onFoot.focus() : null),
    () => player.mode?.focus() ?? city.spawn,
  );
  cash.onCollect((amount) => hud.toast(`+$${amount}`));
  entities.push(cash);
  const shop = new Shop(scene, city.layout, city.spawn, stats, input, places.stores);
  onFoot.interactables.push(...shop.interactables);

  // Damage feedback and death: fade out, wake up at the nearest hospital with full health,
  // minus some cash (weapons are kept).
  stats.onDamage((amount) => {
    hud.hurt(amount);
    if (player.mode === onFoot) onFoot.hurt();
  });
  stats.onDeath(() => {
    const where = (player.mode ?? onFoot).focus();
    const hospital = places.nearestHospital(where.x, where.z);
    onFoot.knockDown();
    input.setBlocked(true);
    hud.setFade(true, 'You were knocked out');
    window.setTimeout(() => {
      stats.respawn();
      onFoot.standUp();
      onFoot.breath = 12;
      // Load the ground around the hospital before putting the player there.
      city.streamer.loadAround(hospital.spawn, 450);
      onFoot.placeAt(hospital.spawn, hospital.heading, hospital.heading);
      player.setMode(onFoot); // leaves any vehicle where it is
      input.setBlocked(false);
      hud.setFade(false);
      hud.toast(`You woke up at ${hospital.name} — $${stats.money} left`, 3.5);
    }, 2500);
  });

  // NPCs, kept in pools around wherever the player is.
  const playerPosition = () => player.mode?.focus() ?? city.spawn;
  const traffic = new Traffic(world, scene, city.layout, city.terrain, playerPosition, () => [
    playerPosition(),
    ...cars.map((c) => c.interp.currPos),
    heli.interp.currPos,
  ]);
  entities.push(traffic);
  // Pedestrians: random people from the character library.
  const dropRng = new Rng(31337);
  const pedestrians = library
    ? new Pedestrians(scene, city.layout, library, touch ? 10 : 16, {
        player: () => ({ position: playerPosition(), onFoot: player.mode === onFoot }),
        hitPlayer: (damage) => stats.damage(damage),
        knockedOut: (position) => cash.drop(position, 5 * dropRng.int(1, 8)),
      })
    : null;
  if (pedestrians) entities.push(pedestrians);

  // Carjacking: with a weapon out, take a stopped or slow traffic car. The driver runs off.
  const JACK_RADIUS = 3.4;
  const noCar = new THREE.Vector3(0, -1000, 0);
  onFoot.interactables.push({
    label: () => (stats.armed ? 'carjack' : 'carjack (needs a weapon)'),
    position: () => traffic.jackable(onFoot.focus(), JACK_RADIUS)?.currPos ?? noCar,
    radius: JACK_RADIUS,
    activate: () => {
      const target = traffic.jackable(onFoot.focus(), JACK_RADIUS);
      if (!target) return;
      if (!stats.armed) {
        hud.toast('You need a weapon to carjack — try Guns & Ammo', 2.5);
        return;
      }
      const taken = traffic.take(target);
      const car = new Car(world, scene, { type: taken.type, color: taken.color, position: taken.position, yaw: taken.yaw });
      addPlayerCar(car);
      pedestrians?.alarm(taken.position, 25);
      hud.toast('The driver ran off!');
      player.setMode(car.mode!);
    },
  });

  // Fighting on foot, and chatting with pedestrians.
  onFoot.combat = new Combat(scene, world, camera, input, stats, pedestrians, traffic, touch, (text) => hud.toast(text));

  // Shot-up traffic smokes; a wrecked car's driver bails out, dropping cash beside it.
  const smoke = new Smoke(scene);
  traffic.smoke = smoke;
  traffic.onWreck = (position) => {
    const side = position.clone();
    side.x += 2.2;
    side.y = 0;
    cash.drop(side, 10 * dropRng.int(3, 8)); // $30–80
    pedestrians?.alarm(position, 30);
    hud.toast('Car wrecked — the driver dropped some cash!', 2.2);
  };

  // Mission givers (fixed spots near the spawn; invulnerable, they never move).
  const missions = new Missions(
    scene,
    world,
    city.layout,
    library,
    stats,
    traffic,
    input,
    playerPosition,
    () => player.mode?.name === 'Flying',
    new THREE.Vector3(pad.x, CURB_HEIGHT, pad.z),
    (text, seconds) => hud.toast(text, seconds),
    touch,
  );
  entities.push(missions);
  onFoot.interactables.push(...missions.interactables);
  stats.onDeath(() => missions.playerDied());
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

  // Choose your character (P / LOOK button); shown straight away on the first visit.
  const feet = new THREE.Vector3();
  const picker = library
    ? new CharacterPicker(
        library,
        input,
        camera,
        () => onFoot.feet(feet),
        () => onFoot.facingYaw,
        (m) => onFoot.setModel(m),
        () => player.mode === onFoot,
        (open) => hud.hideClickToPlay(open),
        touch,
      )
    : null;
  if (picker && !hasSavedLook()) picker.open();

  // One fixed physics step for everything: player controls, entities, the world.
  // Parked vehicles sleep while the ground under them isn't loaded (they'd fall through).
  const parkVehicles = () => {
    for (const v of [...cars, heli]) {
      if (player.mode === v.mode || (v instanceof Car && v.gone)) continue;
      const p = v.body.translation();
      const loaded = city.isLoaded(p.x, p.z);
      if (v.body.isEnabled() !== loaded) v.body.setEnabled(loaded);
    }
  };
  const step = () => {
    water.step(PHYSICS_STEP);
    parkVehicles();
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
  (window as unknown as { game: unknown }).game = { world, camera, sky, water, places, player, onFoot, picker, library, cars, heli, traffic, pedestrians, dialogue, missions, city, dayNight, stats, cash, shop, renderer, input, simulate };

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
    ...shop.doors.map((position) => ({ kind: 'shop' as const, position })),
    ...places.hospitals.map((h) => ({ kind: 'hospital' as const, position: h.door })),
    ...missions.givers.filter((g) => g.marker.visible).map((g) => ({ kind: 'giver' as const, position: g.position })),
    ...missions.objectives().map((position) => ({ kind: 'objective' as const, position })),
  ];

  loading.remove();

  // Fixed-timestep loop with an accumulator:
  // real elapsed time is poured into `accumulator`, and we drain it in exact PHYSICS_STEP
  // chunks. The leftover fraction (alpha = accumulator / step) says how far the real "now"
  // is between the last two physics states; rendering interpolates by that amount.
  let accumulator = 0;
  let last = performance.now();
  renderer.setAnimationLoop((now: number) => {
    // Clamped at 0 too: the first frame's timestamp can be slightly earlier than `last`.
    const frameTime = Math.min(Math.max(0, (now - last) / 1000), MAX_FRAME_TIME);
    last = now;
    accumulator += frameTime;

    while (accumulator >= PHYSICS_STEP) {
      step();
      accumulator -= PHYSICS_STEP;
    }

    city.update(player.mode!.focus()); // stream world chunks around the player
    const alpha = accumulator / PHYSICS_STEP;
    for (const e of entities) e.render(alpha, frameTime);
    player.render(alpha, frameTime); // after entities: vehicle cameras follow the placed meshes
    const mode = player.mode!;
    sky.update(camera, mode.focus());
    water.render(scene, camera, mode.focus());
    hud.setUnderwater(water.underwater);
    hud.setBreath(mode === onFoot ? onFoot.breathFraction : null);
    touchControls?.update();
    hud.update(mode, stats, frameTime);
    shop.render(frameTime);
    onFoot.combat?.render(frameTime);
    smoke.update(frameTime);
    dialogue?.update(frameTime, mode.focus());
    picker?.update(frameTime); // after the player's camera: it takes over the view while open
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
