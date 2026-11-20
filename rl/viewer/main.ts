import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createCity } from '../../src/world/city';
import { createSky } from '../../src/world/sky';
import { Water } from '../../src/world/water';
import { buildCarBody, buildWheel, CAR_DIMENSIONS, PAINT_COLORS, TAXI_YELLOW } from '../../src/vehicles/carModel';
import { CONNECTION_HEIGHT, SUSPENSION_REST } from '../../src/sim/carDynamics';
import { SimWorld, CITY_SEED } from '../sim/world';
import { DrivingEnv, Info, INFO_SIZE, STAGES } from '../sim/env';
import { OBS_SIZE, RAYS, RAY_LENGTH, WAYPOINTS } from '../sim/observe';
import { baselineAction } from '../sim/baseline';
import { Policy, type PolicyWeights } from '../sim/policy';

// Watch the drivers in the real 3D city: the game's own world renderer and car models, the
// headless simulator (rl/sim) for physics, and the trained policy (or the baseline) at the
// wheel. Not part of the game.
//
// URL parameters:
//   policy=final            which exported policy in public/policies/ (or driver=baseline)
//   driver=rl|baseline
//   stage=1..6              curriculum stage (traffic, lights…)
//   cars=8                  learning cars;   seed=3   episode seed
//   cam=chase|top|orbit     camera;          sensors=1  draw rays / waypoints / route
//   hub=x,z                 film this neighbourhood;  area=train|test|any
//   label=…                 caption text;    hours=14  time of day
//   record=1                don't run in real time: the recorder calls viewer.frame()

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
const driver = q.get('driver') ?? 'rl';
const policyName = q.get('policy') ?? 'final';
const stage = num('stage', 3) - 1;
const cars = num('cars', 8);
const camMode = q.get('cam') ?? 'chase';
const sensors = q.get('sensors') === '1';
const recordMode = q.get('record') === '1';
const W = num('w', 0);
const H = num('h', 0);

const hud = document.getElementById('hud')!;
const bars = document.getElementById('bars')!;
const toast = document.getElementById('toast')!;

await RAPIER.init();

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: recordMode });
renderer.setPixelRatio(recordMode ? 1 : Math.min(devicePixelRatio, 2));
renderer.setSize(W || innerWidth, H || innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, (W || innerWidth) / (H || innerHeight), 0.2, 2500);
const sky = createSky(renderer, scene);
sky.setTime(num('hours', 15));

// The game's city (meshes; its colliders go into a throwaway world) and the simulator, which
// reuses the same generated layout.
const visualWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const city = createCity(scene, visualWorld, CITY_SEED);
city.setNight(0);
const water = new Water(scene, (x, z) => city.terrain.heightAt(x, z));
const sim = new SimWorld(CITY_SEED, { layout: city.layout, terrain: city.terrain });
const env = new DrivingEnv(sim, {
  cars,
  seed: num('seed', 3),
  stage,
  randomize: false,
  area: (q.get('area') as 'train' | 'test' | 'any') ?? 'any',
});
if (q.has('hub')) {
  const [hx, hz] = q.get('hub')!.split(',').map(Number);
  env.setHub(hx, hz, num('radius', 200));
  for (let i = 0; i < cars; i++) env.spawn(i);
}

let policy: Policy | null = null;
let policySteps = 0;
if (driver === 'rl') {
  const res = await fetch(`./policies/${policyName}.json`);
  const w = (await res.json()) as PolicyWeights;
  policy = new Policy(w);
  policySteps = w.steps;
}

// --- Car models. Learners are bright colours; rule-based traffic is grey / taxis.
interface Visual {
  root: THREE.Group;
  wheels: THREE.Group[];
}
function makeVisual(type: 'sedan' | 'taxi', color: number): Visual {
  const root = new THREE.Group();
  root.add(buildCarBody(type, color));
  const wheels: THREE.Group[] = [];
  for (let i = 0; i < 4; i++) {
    const w = buildWheel(CAR_DIMENSIONS.sedan.wheelRadius);
    wheels.push(w);
    root.add(w);
  }
  root.traverse((o) => {
    o.castShadow = true;
  });
  scene.add(root);
  return { root, wheels };
}
const LEARNER_COLORS = [0xd8262a, 0x1f6fd1, 0x2fa84f, 0xf08a1c, 0x8e44ad, 0x16a3a3, 0xe8e8e6, 0x1b1c1e];
const learnerVis = env.agents.map((_, i) => makeVisual('sedan', LEARNER_COLORS[i % LEARNER_COLORS.length]));
const botVis = new Map<RAPIER.RigidBody, Visual>();
let botColor = 0;

// --- Pose snapshots after each physics step, so video runs at 30 fps (2 physics steps a frame).
interface Pose {
  p: THREE.Vector3;
  q: THREE.Quaternion;
  wheels: { len: number; rot: number }[];
  steer: number;
}
interface Snapshot {
  learners: Pose[];
  bots: Map<RAPIER.RigidBody, Pose>;
}
const queue: Snapshot[] = [];
let physicsCount = 0;
const botSpin = new Map<RAPIER.RigidBody, number>();
env.onPhysicsStep = () => {
  physicsCount++;
  if (physicsCount % 2) return;
  const snap: Snapshot = { learners: [], bots: new Map() };
  for (const a of env.agents) {
    const t = a.car.body.translation();
    const r = a.car.body.rotation();
    const wheels = [0, 1, 2, 3].map((k) => ({
      len: a.car.controller.wheelSuspensionLength(k) ?? SUSPENSION_REST,
      rot: a.car.controller.wheelRotation(k) ?? 0,
    }));
    snap.learners.push({ p: new THREE.Vector3(t.x, t.y, t.z), q: new THREE.Quaternion(r.x, r.y, r.z, r.w), wheels, steer: a.car.steer });
  }
  for (const b of env.bots) {
    const t = b.body.translation();
    const r = b.body.rotation();
    const spin = (botSpin.get(b.body) ?? 0) + (b.v * 2) / 60 / CAR_DIMENSIONS.sedan.wheelRadius;
    botSpin.set(b.body, spin);
    snap.bots.set(b.body, {
      p: new THREE.Vector3(t.x, t.y, t.z),
      q: new THREE.Quaternion(r.x, r.y, r.z, r.w),
      wheels: [0, 1, 2, 3].map(() => ({ len: SUSPENSION_REST - 0.07, rot: spin })),
      steer: 0,
    });
  }
  queue.push(snap);
};

function applyPose(v: Visual, pose: Pose): void {
  v.root.position.copy(pose.p);
  v.root.quaternion.copy(pose.q);
  const d = CAR_DIMENSIONS.sedan;
  const conn = [
    [d.wheelBase / 2, -d.track / 2],
    [d.wheelBase / 2, d.track / 2],
    [-d.wheelBase / 2, -d.track / 2],
    [-d.wheelBase / 2, d.track / 2],
  ];
  for (let i = 0; i < 4; i++) {
    const w = v.wheels[i];
    w.position.set(conn[i][0], CONNECTION_HEIGHT - pose.wheels[i].len, conn[i][1]);
    w.rotation.set(0, i < 2 ? pose.steer : 0, -pose.wheels[i].rot, 'YXZ');
  }
}

// --- Sensor overlay for the focused car: rays, waypoints, the route line.
const rayGeo = new THREE.BufferGeometry();
rayGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RAYS * 6), 3));
rayGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(RAYS * 6), 3));
const rayLines = new THREE.LineSegments(rayGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthTest: false }));
rayLines.renderOrder = 10;
const routeGeo = new THREE.BufferGeometry();
const routeLine = new THREE.Line(routeGeo, new THREE.LineBasicMaterial({ color: 0x40e0ff, transparent: true, opacity: 0.85, depthTest: false }));
routeLine.renderOrder = 9;
const wpMeshes = WAYPOINTS.map(() => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffe14d, depthTest: false }));
  m.renderOrder = 11;
  scene.add(m);
  return m;
});
const stopBar = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 3.4), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
if (sensors) scene.add(rayLines, routeLine, stopBar);
for (const m of wpMeshes) m.visible = sensors;

const P = { x: 0, z: 0, tx: 0, tz: 0 };
function drawSensors(i: number): void {
  if (!sensors) return;
  const a = env.agents[i];
  const f = a.frame;
  const pos = rayGeo.getAttribute('position') as THREE.BufferAttribute;
  const col = rayGeo.getAttribute('color') as THREE.BufferAttribute;
  for (let r = 0; r < RAYS; r++) {
    const ang = -Math.PI / 2 + (Math.PI * r) / (RAYS - 1);
    const dx = Math.cos(ang) * f.fx + Math.sin(ang) * f.rx;
    const dz = Math.cos(ang) * f.fz + Math.sin(ang) * f.rz;
    const d = a.rays.dist[r];
    pos.setXYZ(r * 2, f.x, f.y + 0.75, f.z);
    pos.setXYZ(r * 2 + 1, f.x + dx * d, f.y + 0.75, f.z + dz * d);
    const c = d >= RAY_LENGTH ? [0.3, 1, 0.4] : a.rays.car[r] ? [1, 0.15, 0.15] : [1, 0.6, 0.1];
    col.setXYZ(r * 2, c[0], c[1], c[2]);
    col.setXYZ(r * 2 + 1, c[0], c[1], c[2]);
  }
  pos.needsUpdate = true;
  col.needsUpdate = true;
  WAYPOINTS.forEach((ahead, k) => {
    a.path.at(a.s + ahead, P);
    wpMeshes[k].position.set(P.x, sim.height(P.x, P.z) + 0.4, P.z);
  });
  const pts: number[] = [];
  for (let s = Math.max(0, a.s - 5); s < Math.min(a.path.length, a.s + 120); s += 1.5) {
    a.path.at(s, P);
    pts.push(P.x, sim.height(P.x, P.z) + 0.12, P.z);
  }
  routeGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  stopBar.visible = a.stopDist < 60;
  if (stopBar.visible) {
    a.path.at(a.s + a.stopDist, P);
    stopBar.position.set(P.x, sim.height(P.x, P.z) + 0.1, P.z);
    stopBar.rotation.set(0, Math.atan2(-P.tz, P.tx), 0);
    (stopBar.material as THREE.MeshBasicMaterial).color.set(a.light === 'red' ? 0xff2020 : a.light === 'yellow' ? 0xffc000 : 0x20e040);
  }
}

// --- Driving loop.
const actions = new Float32Array(cars * 2);
const tmpAct: [number, number] = [0, 0];
const obs = new Float32Array(cars * OBS_SIZE);
let decisions = 0;
let inferMs = 0;
const outcomes = { success: 0, crash: 0, offroad: 0, red: 0, timeout: 0 };
let toastUntil = 0;
const focus = num('focus', 0);

function decide(): void {
  const t0 = performance.now();
  if (policy) {
    obs.set(env.obs);
    policy.act(obs, cars, actions);
  } else {
    env.agents.forEach((a, i) => {
      baselineAction(a, tmpAct);
      actions[i * 2] = tmpAct[0];
      actions[i * 2 + 1] = tmpAct[1];
    });
  }
  inferMs += performance.now() - t0;
  env.step(actions);
  decisions++;
  for (let i = 0; i < cars; i++) {
    if (!env.done[i]) continue;
    const o = i * INFO_SIZE;
    const kind = env.info[o + Info.Success] ? 'success' : env.info[o + Info.Crash] ? 'crash' : env.info[o + Info.Offroad] ? 'offroad' : env.info[o + Info.RedLight] ? 'red' : 'timeout';
    outcomes[kind]++;
    if (i === focus) {
      toast.textContent = { success: 'ARRIVED ✓', crash: 'CRASH ✗', offroad: 'OFF THE ROAD ✗', red: 'RAN A RED ✗', timeout: 'OUT OF TIME' }[kind];
      toast.style.color = kind === 'success' ? '#7dff9a' : '#ff6b6b';
      toastUntil = decisions + 22;
    }
  }
  if (decisions >= toastUntil) toast.textContent = '';
}

const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
let camInit = false;
const orbit = { angle: 0 };
function placeCamera(pose: Pose): void {
  const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(pose.q);
  fwd.y = 0;
  fwd.normalize();
  let wantPos: THREE.Vector3;
  let wantLook: THREE.Vector3;
  if (camMode === 'top') {
    const hub = q.get('hub')?.split(',').map(Number);
    const c = hub ? new THREE.Vector3(hub[0], 0, hub[1]) : pose.p.clone();
    c.y = sim.height(c.x, c.z);
    wantPos = c.clone().add(new THREE.Vector3(0, num('height', 85), num('back', 60)));
    wantLook = c;
  } else if (camMode === 'orbit') {
    orbit.angle += 0.004;
    wantPos = pose.p.clone().add(new THREE.Vector3(Math.cos(orbit.angle) * 16, 7, Math.sin(orbit.angle) * 16));
    wantLook = pose.p.clone().add(new THREE.Vector3(0, 1, 0));
  } else {
    wantPos = pose.p.clone().addScaledVector(fwd, -9).add(new THREE.Vector3(0, 3.6, 0));
    wantLook = pose.p.clone().addScaledVector(fwd, 7).add(new THREE.Vector3(0, 1.2, 0));
  }
  // A jump (new episode) snaps; otherwise follow smoothly.
  if (!camInit || camPos.distanceTo(wantPos) > 40) {
    camPos.copy(wantPos);
    camLook.copy(wantLook);
    camInit = true;
  } else {
    camPos.lerp(wantPos, 0.12);
    camLook.lerp(wantLook, 0.2);
  }
  // Keep the camera above the ground.
  camPos.y = Math.max(camPos.y, sim.height(camPos.x, camPos.z) + 1.5);
  camera.position.copy(camPos);
  camera.lookAt(camLook);
}

function updateHud(): void {
  const a = env.agents[focus];
  const label = q.get('label') ?? (policy ? `RL policy · ${(policySteps / 1e6).toFixed(1)}M training steps` : 'Hand-written baseline (pure pursuit + PID)');
  const kmh = Math.round(Math.max(0, a.vFwd) * 3.6);
  const lim = Math.round(a.path.limit[a.path.index(a.s)] * 3.6);
  hud.innerHTML = `<div class="title">${label}</div>${STAGES[stage].name.replace(/^\d /, '')} · ${kmh} km/h (limit ${lim})<br>` +
    `arrived ${outcomes.success} · crashed ${outcomes.crash} · off road ${outcomes.offroad}${stage >= 5 ? ` · red lights ${outcomes.red}` : ''}`;
  const steer = a.action[0];
  const thr = a.action[1];
  const fill = (v: number, color: string) => `<div class="bar"><div class="mid"></div><i style="left:${50 + Math.min(0, v) * 50}%;width:${Math.abs(v) * 50}%;background:${color}"></i></div>`;
  bars.innerHTML = `steering ${steer >= 0 ? 'right' : 'left'} ${Math.abs(steer).toFixed(2)}${fill(steer, '#4fc3f7')}` +
    `${thr >= 0 ? 'throttle' : 'brake'} ${Math.abs(thr).toFixed(2)}${fill(thr, thr >= 0 ? '#66d17a' : '#ff6b6b')}`;
}

/** Advance one video frame (1/30 s) and render it. */
function frame(): void {
  if (!queue.length) decide();
  const snap = queue.shift()!;
  snap.learners.forEach((p, i) => applyPose(learnerVis[i], p));
  for (const [body, v] of botVis) {
    if (!snap.bots.has(body)) {
      scene.remove(v.root);
      botVis.delete(body);
    }
  }
  for (const [body, pose] of snap.bots) {
    let v = botVis.get(body);
    if (!v) {
      const taxi = botColor++ % 5 === 0;
      v = makeVisual(taxi ? 'taxi' : 'sedan', taxi ? TAXI_YELLOW : PAINT_COLORS[botColor % PAINT_COLORS.length]);
      botVis.set(body, v);
    }
    applyPose(v, pose);
  }
  const pose = snap.learners[focus];
  placeCamera(pose);
  drawSensors(focus);
  city.update(pose.p);
  sky.update(camera, pose.p);
  water.step(1 / 30);
  water.render(scene, camera, pose.p);
  updateHud();
  renderer.render(scene, camera);
}

city.streamer.loadAround(new THREE.Vector3(env.agents[focus].frame.x, 0, env.agents[focus].frame.z), 500);
const viewer = {
  frame,
  ready: true,
  /** Skip ahead n decisions without rendering (to start a clip mid-episode). */
  skip(n: number) {
    for (let k = 0; k < n; k++) decide();
    queue.length = 0;
    const a = env.agents[focus];
    city.streamer.loadAround(new THREE.Vector3(a.frame.x, 0, a.frame.z), 500);
  },
  stats: () => ({ decisions, inferMsPerDecision: inferMs / Math.max(1, decisions), perCar: inferMs / Math.max(1, decisions) / cars, outcomes }),
  env,
};
(window as unknown as { viewer: typeof viewer }).viewer = viewer;
if (!recordMode) {
  let last = performance.now();
  let acc = 0;
  renderer.setAnimationLoop((now: number) => {
    acc += Math.min(0.1, (now - last) / 1000);
    last = now;
    while (acc >= 1 / 30) {
      acc -= 1 / 30;
      frame();
    }
  });
}
