import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Input } from '../input/actions';
import type { SimEntity } from '../sim/entity';
import type { CharacterModel } from '../player/character';
import type { CharacterLibrary, Look } from '../player/characterLibrary';
import type { Interactable } from '../player/onFoot';
import type { Traffic, TrafficCar } from '../npc/traffic';
import type { PlayerStats } from './stats';
import { BLOCK_SIZE, MID, PITCH, VILLAGES, WORLD_HALF, cellOf, lineCoord, type Block, type CityLayout, type Zone } from '../world/layout';
import { RoadGraph, type Dir } from '../world/roadGraph';
import { WATER_Y } from '../world/terrain';

// Missions, handed out by three characters who stand at fixed spots with a "!" over their
// heads. They don't walk about and can't be hurt: they aren't pedestrians at all, just a
// model with a solid collider (bullets and fists simply stop on it).
//
//   Marco          — courier jobs: deliveries (drive to a spot in time) or package runs
//                    (collect several packages around the city in time)
//   Vera           — wreck a marked traffic car before it gets away
//   Captain Reyes  — fly the helicopter through a course of rings in the sky
// …and five more around the map:
//   Lena (Seaside)        — swim out to a line of buoys off the beach, in order
//   Farmer Joe (Eastfield)— drive a race through gates along the country roads
//   Ranger Kim (Pinecrest)— hike to flags on the highest hilltops nearby, on foot
//   Dusty (Westbrook)     — long-haul delivery to a far-off town, or wreck a car
//   Sam (Northside)       — package runs and wrecking jobs in the suburbs
//
// One mission at a time. Success pays a base reward plus a bonus for time left; failing
// costs nothing (talk to the giver again for a new job). Dying fails the mission.

type MissionKind = 'delivery' | 'packages' | 'wreck' | 'rings' | 'swim' | 'race' | 'summit' | 'longhaul';

interface Giver {
  name: string;
  kinds: MissionKind[];
  position: THREE.Vector3; // feet
  facing: number;
  model: CharacterModel | null;
  marker: THREE.Sprite;
  greeting: string;
  /** Seconds until they next wave at passers-by. */
  waveTimer: number;
}

interface Mission {
  kind: MissionKind;
  giver: Giver;
  title: string;
  /** Seconds left; Infinity while waiting to start (rings: until the first ring). */
  timeLeft: number;
  baseReward: number;
  bonusPerSecond: number;
  /** Delivery destination / packages / rings, in order. */
  points: THREE.Vector3[];
  done: number; // how many points reached
  target: TrafficCar | null; // wreck missions
}

const DELIVERY_RADIUS = 6; // m
const PACKAGE_RADIUS = 3; // m
const RING_RADIUS = 7; // m, inner radius of a sky ring (fly through the middle)
const BUOY_RADIUS = 4; // m: swim this close to a buoy to tag it
const GATE_RADIUS = 9; // m: drive through a race gate within this distance of its centre
const FLAG_RADIUS = 4; // m: walk up to a summit flag
const GIVER_RADIUS = 2.6; // m, how close to stand to talk to a giver
/** The givers further out: where (a point the nearest town block is chosen from), who, and what. */
const OUTER_GIVERS: { name: string; x: number; z: number; zones: Zone[]; kinds: MissionKind[]; greeting: string; look: Look }[] = [
  { name: 'Lena', x: -120, z: 1521, zones: ['beachtown'], kinds: ['swim'], greeting: 'Lifeguard trials today. Think you can keep up?', look: { id: 'w_casual', skin: 1, hair: 3, outfit: 3, height: 1.7 } },
  { name: 'Farmer Joe', x: lineCoord(VILLAGES[0].i) - 60, z: lineCoord(VILLAGES[0].k) - 70, zones: ['village'], kinds: ['race'], greeting: "Fancy a spin round the farm roads? I'll time you.", look: { id: 'm_farmer', skin: 2, hair: 5, outfit: 1, height: 1.82 } },
  { name: 'Ranger Kim', x: lineCoord(VILLAGES[2].i) - 60, z: lineCoord(VILLAGES[2].k) + 60, zones: ['village'], kinds: ['summit'], greeting: 'The view from up top is worth it. No cars on the trails.', look: { id: 'w_outdoors', skin: 4, hair: 0, outfit: 2, height: 1.68 } },
  { name: 'Dusty', x: lineCoord(VILLAGES[1].i) + 70, z: lineCoord(VILLAGES[1].k) - 60, zones: ['village'], kinds: ['longhaul', 'wreck'], greeting: "Got a load that needs to go a long way. You drive?", look: { id: 'm_worker', skin: 3, hair: 1, outfit: 5, height: 1.86 } },
  { name: 'Sam', x: 320, z: -640, zones: ['suburb'], kinds: ['packages', 'wreck'], greeting: 'Busy day in the neighbourhood. Want some work?', look: { id: 'm_casual', skin: 5, hair: 0, outfit: 2, height: 1.76 } },
];

/** Fixed looks for the three downtown givers (character id, skin, hair, outfit variant, height). */
const GIVER_LOOKS: Look[] = [
  { id: 'm_hoodie', skin: 3, hair: 0, outfit: 4, height: 1.8 }, // Marco
  { id: 'w_suit', skin: 1, hair: 4, outfit: 0, height: 1.7 }, // Vera
  { id: 'm_outdoors', skin: 2, hair: 5, outfit: 0, height: 1.84 }, // Captain Reyes
];

/** What the player is doing, for missions that need a particular way of getting about. */
export interface MissionHooks {
  isDriving(): boolean;
  isSwimming(): boolean;
  isOnFoot(): boolean;
  /** Ground height (no sidewalks) at (x, z). */
  ground(x: number, z: number): number;
  /** Blocks taken by other places (hospitals, stores…); givers stand elsewhere. */
  usedBlocks: Set<Block>;
}

/** "!" badge for the markers. */
function badgeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffd60a';
  ctx.beginPath();
  ctx.arc(64, 64, 56, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#1c1c1e';
  ctx.stroke();
  ctx.fillStyle = '#1c1c1e';
  ctx.font = 'bold 92px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Missions implements SimEntity {
  readonly givers: Giver[] = [];
  readonly interactables: Interactable[] = [];
  private mission: Mission | null = null;
  private offer: { giver: Giver; kind: MissionKind } | null = null;
  private readonly panel: HTMLDivElement;
  private readonly hudLine: HTMLDivElement;
  private time = 0;

  // World markers for the active mission.
  private readonly beacon: THREE.Mesh; // tall light pillar over a destination
  private readonly packageMeshes: THREE.Mesh[] = [];
  private readonly rings: THREE.Mesh[] = [];
  private readonly targetArrow: THREE.Mesh;
  private readonly graph: RoadGraph;

  constructor(
    private readonly scene: THREE.Scene,
    world: RAPIER.World,
    private readonly layout: CityLayout,
    library: CharacterLibrary | null,
    private readonly stats: PlayerStats,
    private readonly traffic: Traffic,
    private readonly input: Input,
    /** Player position in any mode. */
    private readonly playerPosition: () => THREE.Vector3,
    /** True while the player is flying the helicopter. */
    private readonly isFlying: () => boolean,
    /** Where the helicopter starts (ring courses begin near it). */
    private readonly helipad: THREE.Vector3,
    private readonly notify: (text: string, seconds?: number) => void,
    private readonly touch: boolean,
    /** Height you'd stand at, at (x, z): sidewalk tops follow the hills (Terrain.surfaceAt). */
    private readonly surface: (x: number, z: number) => number,
    private readonly hooks: MissionHooks,
  ) {
    // --- The three givers, on sidewalks around the spawn (fixed, not random).
    const mid = MID;
    const block = (bx: number, bz: number) => layout.blockAt(bx, bz)!;
    const specs: [string, MissionKind[], Block, string][] = [
      ['Marco', ['delivery', 'packages'], block(mid, mid + 1), 'Need a courier. Quick money, no questions.'],
      ['Vera', ['wreck'], block(mid - 1, mid + 2), "There's a car out there I want off the road."],
      ['Captain Reyes', ['rings'], block(mid + 1, mid + 2), 'Fancy yourself a pilot? Prove it.'],
    ];
    // …and the ones further out, each on the town block nearest their spot.
    const looks = [...GIVER_LOOKS];
    const taken = new Set<Block>([...hooks.usedBlocks, ...specs.map((s) => s[2])]);
    for (const o of OUTER_GIVERS) {
      let best: Block | null = null;
      for (const b of layout.blocks) {
        if (!o.zones.includes(b.zone) || taken.has(b) || b.helipad) continue;
        if (!best || Math.hypot(b.cx - o.x, b.cz - o.z) < Math.hypot(best.cx - o.x, best.cz - o.z)) best = b;
      }
      if (!best) continue;
      taken.add(best);
      specs.push([o.name, o.kinds, best, o.greeting]);
      looks.push(o.look);
    }
    this.graph = new RoadGraph(layout);
    const badge = badgeTexture();
    specs.forEach(([name, kinds, b, greeting], k) => {
      // On the sidewalk 6 m from the block's south-west corner, between the pedestrians'
      // path and the curb, facing out to the street.
      const half = BLOCK_SIZE / 2;
      const gp = { x: b.cx - half + 1.2, z: b.cz + half - 6 };
      const w = layout.warp.forward(gp.x, gp.z);
      const position = new THREE.Vector3(w.x, 0, w.z);
      position.y = surface(position.x, position.z);
      const facing = Math.PI / 2 + layout.warp.angle(gp.x, gp.z); // face the road (−X on the grid)
      world.createCollider(RAPIER.ColliderDesc.capsule(0.55, 0.35).setTranslation(position.x, position.y + 0.9, position.z));
      const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: badge, depthTest: true }));
      marker.scale.set(0.7, 0.7, 0.7);
      scene.add(marker);
      const giver: Giver = { name, kinds, position, facing, model: null, marker, greeting, waveTimer: 4 + k * 3 };
      this.givers.push(giver);
      void library?.create(looks[k]).then((model) => {
        model.root.position.copy(position);
        model.root.rotation.y = facing;
        scene.add(model.root);
        giver.model = model;
      });
      this.interactables.push({
        label: () => 'mission',
        position: () => giver.position,
        radius: GIVER_RADIUS,
        available: () => this.mission === null && this.offer === null,
        activate: () => this.makeOffer(giver),
      });
    });

    // --- Mission markers.
    this.beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(DELIVERY_RADIUS * 0.6, DELIVERY_RADIUS * 0.6, 60, 24, 1, true).translate(0, 30, 0),
      new THREE.MeshBasicMaterial({ color: 0xff3b5c, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.beacon.visible = false;
    scene.add(this.beacon);
    this.targetArrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.6, 1.2, 4).rotateX(Math.PI),
      new THREE.MeshBasicMaterial({ color: 0xff3b5c }),
    );
    this.targetArrow.visible = false;
    scene.add(this.targetArrow);

    // --- UI: offer panel and the active mission line.
    this.panel = document.createElement('div');
    this.panel.style.cssText = [
      'position:fixed',
      'left:50%',
      'bottom:max(16%, 110px)',
      'transform:translateX(-50%)',
      'z-index:26',
      'width:min(380px, calc(100vw - 32px))',
      'padding:14px 16px',
      'border-radius:14px',
      'background:rgba(20,22,26,0.93)',
      'color:#fff',
      'font:15px/1.4 system-ui,sans-serif',
      'display:none',
    ].join(';');
    for (const type of ['pointerdown', 'mousedown']) this.panel.addEventListener(type, (e) => e.stopPropagation());
    document.body.appendChild(this.panel);
    this.hudLine = document.createElement('div');
    this.hudLine.style.cssText = [
      'position:fixed',
      'left:50%',
      'top:max(10px, env(safe-area-inset-top))',
      'transform:translateX(-50%)',
      'z-index:20',
      'padding:6px 14px',
      'border-radius:10px',
      'background:rgba(0,0,0,0.55)',
      'color:#fff',
      'font:600 15px/1.35 system-ui,sans-serif',
      'text-align:center',
      'pointer-events:none',
      'display:none',
      'max-width:min(460px, 70vw)',
    ].join(';');
    document.body.appendChild(this.hudLine);
  }

  /** True while a mission is running. */
  get active(): boolean {
    return this.mission !== null;
  }

  // ---------------------------------------------------------------- offers

  private makeOffer(giver: Giver): void {
    const kind = giver.kinds[Math.floor(Math.random() * giver.kinds.length)];
    this.offer = { giver, kind };
    const job: Record<MissionKind, [string, string]> = {
      delivery: ['Delivery', 'Take a package across town before the clock runs out. Grab a car — it\'s a fair way.'],
      packages: ['Package run', 'Four packages are lying around the neighbourhood. Collect them all in time.'],
      wreck: ['Wreck a car', 'A marked car is driving around. Wreck it before it gets away.'],
      rings: ['Ring course', 'Take the helicopter and fly through every ring. The clock starts at the first ring.'],
      swim: ['Buoy swim', 'Swim out to the five buoys off the beach, in order, before the time runs out.'],
      race: ['Country race', 'Grab a car and drive through every gate along the country roads. The clock starts at the first gate.'],
      summit: ['Summit hike', 'Three flags on the highest hilltops around here. Walk up to all of them — on foot only.'],
      longhaul: ['Long haul', 'A delivery to a town far across the map. Find a car and go — the further it is, the more it pays.'],
    };
    const [title, text] = job[kind];
    const reward = REWARDS[kind];
    for (const c of ['choice1', 'choice2'] as const) this.input.consumePressed(c);
    this.panel.innerHTML = '';
    const head = document.createElement('div');
    head.innerHTML = `<div style="color:#ffd60a;font-weight:700">${giver.name}</div><div style="opacity:0.85;margin:2px 0 8px">“${giver.greeting}”</div><div style="font-weight:600">${title} — $${reward.base}+</div><div style="opacity:0.8;font-size:14px">${text}</div>`;
    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;gap:8px;margin-top:12px';
    const button = (label: string, color: string, onClick: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = `flex:1;padding:9px;border:0;border-radius:9px;background:${color};color:#fff;font:600 15px system-ui,sans-serif;cursor:pointer`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
      });
      buttons.appendChild(b);
    };
    button(this.touch ? 'Accept' : '1. Accept', '#2f7d45', () => this.acceptOffer());
    button(this.touch ? 'Not now' : '2. Not now', '#555', () => this.closeOffer());
    this.panel.append(head, buttons);
    this.panel.style.display = '';
  }

  private closeOffer(): void {
    this.offer = null;
    this.panel.style.display = 'none';
  }

  private acceptOffer(): void {
    const offer = this.offer;
    if (!offer) return;
    this.closeOffer();
    const started = this.start(offer.giver, offer.kind);
    if (!started) this.notify('No job right now — try again in a moment.');
  }

  // ---------------------------------------------------------------- mission setup

  /** A random spot on some block's sidewalk between `min` and `max` metres from `from`. */
  private sidewalkSpot(from: THREE.Vector3, min: number, max: number): THREE.Vector3 | null {
    // Only town blocks in range (the world has ~1000 of them).
    const candidates = this.layout.blocks.filter((bl) => {
      const d = Math.hypot(bl.cx - from.x, bl.cz - from.z);
      return d > min - BLOCK_SIZE && d < max + BLOCK_SIZE;
    });
    if (!candidates.length) return null;
    for (let attempt = 0; attempt < 60; attempt++) {
      const b = candidates[Math.floor(Math.random() * candidates.length)];
      const edge = BLOCK_SIZE / 2 - 2;
      const along = (Math.random() * 2 - 1) * (edge - 6);
      const side = Math.floor(Math.random() * 4);
      const x = side < 2 ? (side === 0 ? edge : -edge) : along;
      const z = side < 2 ? along : side === 2 ? edge : -edge;
      const w = this.layout.warp.forward(b.cx + x, b.cz + z);
      const p = new THREE.Vector3(w.x, this.surface(w.x, w.z), w.z);
      const d = Math.hypot(p.x - from.x, p.z - from.z);
      if (d >= min && d <= max) return p;
    }
    return null;
  }

  private start(giver: Giver, kind: MissionKind): boolean {
    const from = this.playerPosition();
    const reward = REWARDS[kind];
    const m: Mission = {
      kind,
      giver,
      title: '',
      timeLeft: Infinity,
      baseReward: reward.base,
      bonusPerSecond: reward.bonus,
      points: [],
      done: 0,
      target: null,
    };
    if (kind === 'delivery') {
      const dest = this.sidewalkSpot(from, 400, 1100);
      if (!dest) return false;
      m.points = [dest];
      // Time: the distance at a decent city driving speed, plus time to find a car.
      m.timeLeft = Math.round(from.distanceTo(dest) / 9 + 25);
      m.title = 'Delivery — get to the marked spot';
    } else if (kind === 'packages') {
      for (let i = 0; i < 4; i++) {
        const p = this.sidewalkSpot(from, 60, 450);
        if (p) m.points.push(p);
      }
      if (m.points.length < 4) return false;
      m.timeLeft = 200;
      m.title = 'Package run — collect the packages';
      for (const p of m.points) {
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(0.6, 0.45, 0.5),
          new THREE.MeshStandardMaterial({ color: 0xb98a52, emissive: 0xffb347, emissiveIntensity: 0.35 }),
        );
        box.position.copy(p).add(new THREE.Vector3(0, 0.45, 0));
        box.castShadow = true;
        this.scene.add(box);
        this.packageMeshes.push(box);
      }
    } else if (kind === 'wreck') {
      const car = this.traffic.pickTarget(from, 90, 230);
      if (!car) return false;
      car.pinned = true;
      m.target = car;
      m.timeLeft = 120;
      m.title = 'Wreck the marked car';
    } else if (kind === 'longhaul') {
      const dest = this.sidewalkSpot(from, 1200, 2200);
      if (!dest) return false;
      m.points = [dest];
      const dist = from.distanceTo(dest);
      m.baseReward = Math.round((150 + dist * 0.15) / 10) * 10;
      m.timeLeft = Math.round(dist / 11 + 40);
      m.title = 'Long haul — get to the marked town';
    } else if (kind === 'swim') {
      m.points = this.buoyLine(from);
      if (m.points.length < 5) return false;
      m.timeLeft = 150;
      m.title = 'Buoy swim — swim to the buoys';
      for (const p of m.points) this.addMarker(buoyMesh(), p);
    } else if (kind === 'race') {
      m.points = this.raceRoute(from);
      if (m.points.length < 6) return false;
      m.title = 'Country race — drive through the first gate';
      for (let i = 0; i < m.points.length; i++) {
        const next = m.points[i + 1] ?? m.points[i - 1];
        const gate = new THREE.Mesh(
          new THREE.TorusGeometry(GATE_RADIUS * 0.8, 0.35, 8, 36),
          new THREE.MeshBasicMaterial({ color: 0x4cd964, transparent: true, opacity: 0.85 }),
        );
        gate.position.copy(m.points[i]).add(new THREE.Vector3(0, GATE_RADIUS * 0.8 - 0.5, 0));
        gate.lookAt(next.x, gate.position.y, next.z);
        this.scene.add(gate);
        this.rings.push(gate);
      }
    } else if (kind === 'summit') {
      m.points = this.summits(from);
      if (m.points.length < 3) return false;
      m.timeLeft = 300;
      m.title = 'Summit hike — reach the flags on foot';
      for (const p of m.points) this.addMarker(flagMesh(), p);
    } else {
      m.points = this.ringCourse();
      m.title = 'Ring course — fly through the first ring';
      for (let i = 0; i < m.points.length; i++) {
        const next = m.points[i + 1] ?? m.points[i - 1];
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(RING_RADIUS, 0.45, 10, 40),
          new THREE.MeshBasicMaterial({ color: 0xffd60a, transparent: true, opacity: 0.85 }),
        );
        ring.position.copy(m.points[i]);
        // Face along the course (the torus's hole is along its local Z).
        ring.lookAt(next.x, m.points[i].y, next.z);
        this.scene.add(ring);
        this.rings.push(ring);
      }
    }
    this.mission = m;
    giver.marker.visible = false;
    this.notify(`Mission: ${m.title.split(' — ')[0]}`, 2);
    return true;
  }

  /** A marker object at a point (buoys, flags), removed when the mission ends. */
  private addMarker(object: THREE.Mesh, p: THREE.Vector3): void {
    object.position.copy(p);
    this.scene.add(object);
    this.packageMeshes.push(object);
  }

  /** Five buoys in a zig-zag line out to sea from the nearest beach, in deep-enough water. */
  private buoyLine(from: THREE.Vector3): THREE.Vector3[] {
    // Walk south from the giver to the first water at least 1.5 m deep.
    let z = from.z;
    while (z < WORLD_HALF - 100 && this.hooks.ground(from.x, z) > WATER_Y - 1.5) z += 5;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < 5; i++) {
      const x = from.x + (i % 2 === 0 ? -1 : 1) * (25 + Math.random() * 20);
      const pz = z + 15 + i * 28;
      if (this.hooks.ground(x, pz) > WATER_Y - 1.2) continue;
      points.push(new THREE.Vector3(x, WATER_Y, pz));
    }
    return points;
  }

  /**
   * A race along the road network: from the intersection nearest `from`, wander along the
   * roads (mostly straight on, never back) and put a gate every few intersections.
   */
  private raceRoute(from: THREE.Vector3): THREE.Vector3[] {
    const g = this.layout.warp.inverse(from.x, from.z);
    let i = cellOf(g.x + PITCH / 2);
    let j = cellOf(g.z + PITCH / 2);
    // Snap to a node that has a road.
    const dirs: Dir[] = [0, 1, 2, 3];
    const hasAny = (a: number, b: number) => dirs.some((d) => this.graph.hasRoad(a, b, d));
    for (let r = 0; r < 4 && !hasAny(i, j); r++) {
      i += r % 2 ? 1 : -1;
    }
    if (!hasAny(i, j)) return [];
    // Head off toward the middle of the map (away from the dead ends at the world's edge).
    const DX = [1, 0, -1, 0];
    const DZ = [0, 1, 0, -1];
    const toCentre = (d: Dir) => -(DX[d] * lineCoord(i) + DZ[d] * lineCoord(j));
    let dir: Dir = dirs.filter((d) => this.graph.hasRoad(i, j, d)).sort((a, b) => toCentre(b) - toCentre(a))[0];
    const points: THREE.Vector3[] = [];
    // Intersections already on the route: avoided where possible, so the race doesn't loop
    // back over itself (and never gets two gates in one place).
    const visited = new Set<string>([`${i},${j}`]);
    for (let step = 0; step < 48 && points.length < 8; step++) {
      const next = this.graph.neighbor(i, j, dir);
      if (!next) break;
      [i, j] = next;
      const key = `${i},${j}`;
      if (step % 4 === 3 && !visited.has(key)) {
        const w = this.layout.warp.forward(lineCoord(i), lineCoord(j));
        points.push(new THREE.Vector3(w.x, this.hooks.ground(w.x, w.z), w.z));
      }
      visited.add(key);
      // Choose the next direction: straight on mostly, turn sometimes, never back, and
      // preferably toward intersections not visited yet.
      const exits = this.graph.exits(i, j, dir).filter((d) => d !== (dir + 2) % 4);
      if (!exits.length) {
        dir = ((dir + 2) % 4) as Dir; // dead end: turn round
        continue;
      }
      const fresh = exits.filter((d) => {
        const n = this.graph.neighbor(i, j, d);
        return n !== null && !visited.has(`${n[0]},${n[1]}`);
      });
      const options = fresh.length ? fresh : exits;
      const straight = options.includes(dir) && Math.random() < 0.6;
      dir = straight ? dir : options[Math.floor(Math.random() * options.length)];
    }
    return points;
  }

  /** Three flags on the highest hilltops 150–650 m away, at least 150 m apart, above the water. */
  private summits(from: THREE.Vector3): THREE.Vector3[] {
    const spots: THREE.Vector3[] = [];
    for (let dz = -650; dz <= 650; dz += 25) {
      for (let dx = -650; dx <= 650; dx += 25) {
        const d = Math.hypot(dx, dz);
        if (d < 150 || d > 650) continue;
        const x = from.x + dx;
        const z = from.z + dz;
        if (Math.abs(x) > WORLD_HALF - 120 || Math.abs(z) > WORLD_HALF - 120) continue;
        spots.push(new THREE.Vector3(x, this.hooks.ground(x, z), z));
      }
    }
    spots.sort((a, b) => b.y - a.y);
    const chosen: THREE.Vector3[] = [];
    for (const s of spots) {
      if (s.y < WATER_Y + 3) break;
      if (chosen.every((c) => Math.hypot(c.x - s.x, c.z - s.z) > 150)) chosen.push(s);
      if (chosen.length === 3) break;
    }
    return chosen;
  }

  /** Six rings at rising altitude, meandering away from the helipad, inside the city. */
  private ringCourse(): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];
    let heading = Math.atan2(-this.helipad.z, -this.helipad.x); // toward the city centre
    let p = this.helipad.clone();
    for (let i = 0; i < 6; i++) {
      const step = i === 0 ? 70 : 110;
      heading += (Math.random() - 0.5) * 1.2;
      p = p.clone().add(new THREE.Vector3(Math.cos(heading) * step, 0, Math.sin(heading) * step));
      // Keep well inside the world.
      const limit = WORLD_HALF - 200;
      p.x = THREE.MathUtils.clamp(p.x, -limit, limit);
      p.z = THREE.MathUtils.clamp(p.z, -limit, limit);
      p.y = 45 + i * 10 + Math.random() * 10;
      points.push(p);
    }
    return points;
  }

  private finish(success: boolean, reason = ''): void {
    const m = this.mission;
    if (!m) return;
    if (success) {
      const bonus = Number.isFinite(m.timeLeft) ? Math.round(m.timeLeft * m.bonusPerSecond) : 0;
      const total = m.baseReward + bonus;
      this.stats.money += total;
      this.notify(`Mission complete! +$${total}${bonus ? ` (incl. $${bonus} time bonus)` : ''}`, 3.5);
    } else {
      this.notify(`Mission failed — ${reason}`, 3);
    }
    if (m.target) m.target.pinned = false;
    for (const object of [...this.packageMeshes, ...this.rings]) {
      this.scene.remove(object);
      object.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    }
    this.packageMeshes.length = 0;
    this.rings.length = 0;
    this.beacon.visible = false;
    this.targetArrow.visible = false;
    m.giver.marker.visible = true;
    this.mission = null;
  }

  /** The player died: any running mission fails. */
  playerDied(): void {
    this.finish(false, 'you were knocked out');
    this.closeOffer();
  }

  // ---------------------------------------------------------------- simulation

  fixedUpdate(dt: number): void {
    const m = this.mission;
    if (!m) return;
    const p = this.playerPosition();
    if (Number.isFinite(m.timeLeft)) {
      m.timeLeft -= dt;
      if (m.timeLeft <= 0) {
        this.finish(false, m.kind === 'wreck' ? 'the car got away' : 'out of time');
        return;
      }
    }
    if (m.kind === 'delivery') {
      if (Math.hypot(p.x - m.points[0].x, p.z - m.points[0].z) < DELIVERY_RADIUS && Math.abs(p.y - m.points[0].y) < 4) {
        this.finish(true);
      }
    } else if (m.kind === 'packages') {
      m.points.forEach((pt, i) => {
        const mesh = this.packageMeshes[i];
        if (!mesh.visible) return;
        if (Math.hypot(p.x - pt.x, p.z - pt.z) < PACKAGE_RADIUS && Math.abs(p.y - pt.y) < 3) {
          mesh.visible = false;
          m.done++;
          this.notify(`Package ${m.done}/${m.points.length}`, 1.2);
        }
      });
      if (m.done === m.points.length) this.finish(true);
    } else if (m.kind === 'wreck') {
      const car = m.target!;
      if (car.wrecked >= 0) this.finish(true);
      else if (!car.active) this.finish(false, 'the car got away');
    } else if (m.kind === 'longhaul') {
      if (Math.hypot(p.x - m.points[0].x, p.z - m.points[0].z) < DELIVERY_RADIUS && Math.abs(p.y - m.points[0].y) < 4) {
        this.finish(true);
      }
    } else if (m.kind === 'swim') {
      // Buoys in order, swimming.
      const buoy = m.points[m.done];
      if (this.hooks.isSwimming() && buoy && Math.hypot(p.x - buoy.x, p.z - buoy.z) < BUOY_RADIUS) {
        this.packageMeshes[m.done].visible = false;
        m.done++;
        if (m.done === m.points.length) this.finish(true);
        else this.notify(`Buoy ${m.done}/${m.points.length}`, 1);
      }
    } else if (m.kind === 'race') {
      // Gates in order, driving. The clock starts at the first gate.
      const gate = m.points[m.done];
      if (this.hooks.isDriving() && gate && Math.hypot(p.x - gate.x, p.z - gate.z) < GATE_RADIUS) {
        this.rings[m.done].visible = false;
        m.done++;
        if (m.done === 1) {
          // Time for the rest of the route at a brisk country-road pace.
          let length = 0;
          for (let k = 1; k < m.points.length; k++) length += m.points[k].distanceTo(m.points[k - 1]);
          m.timeLeft = Math.round(length / 15 + 15);
          m.title = 'Country race — drive through the gates';
        }
        if (m.done === m.points.length) this.finish(true);
        else this.notify(`Gate ${m.done}/${m.points.length}`, 1);
      }
    } else if (m.kind === 'summit') {
      // Flags in any order, on foot.
      m.points.forEach((pt, k) => {
        const flag = this.packageMeshes[k];
        if (!flag.visible || !this.hooks.isOnFoot()) return;
        if (Math.hypot(p.x - pt.x, p.z - pt.z) < FLAG_RADIUS && Math.abs(p.y - pt.y) < 4) {
          flag.visible = false;
          m.done++;
          this.notify(`Summit ${m.done}/${m.points.length}`, 1.2);
        }
      });
      if (m.done === m.points.length) this.finish(true);
    } else {
      // Rings: only count while flying the helicopter. The clock starts at the first ring.
      const ring = m.points[m.done];
      if (this.isFlying() && ring && p.distanceTo(ring) < RING_RADIUS) {
        this.rings[m.done].visible = false;
        m.done++;
        if (m.done === 1) {
          m.timeLeft = 75;
          m.title = 'Ring course — fly through the rings';
        }
        if (m.done === m.points.length) this.finish(true);
        else this.notify(`Ring ${m.done}/${m.points.length}`, 1);
      }
    }
  }

  afterStep(): void {}

  render(_alpha: number, frameDt: number): void {
    this.time += frameDt;
    const player = this.playerPosition();
    // Givers idle in place; "!" badges bob over their heads.
    for (const g of this.givers) {
      if (g.model && g.model.root.position.distanceTo(player) < 70) {
        // Gesture while offering a job; otherwise idle with a wave every so often.
        g.model.setTalking(this.offer?.giver === g);
        g.waveTimer -= frameDt;
        if (g.waveTimer <= 0) {
          g.waveTimer = 8 + Math.random() * 8;
          if (this.offer?.giver !== g) g.model.play('wave');
        }
        g.model.update(0, true, frameDt);
      }
      g.marker.position.set(g.position.x, g.position.y + 2.35 + Math.sin(this.time * 2.5) * 0.08, g.position.z);
    }
    // Close the offer if the player walks off; keys 1/2 answer it.
    if (this.offer) {
      if (player.distanceTo(this.offer.giver.position) > 5) this.closeOffer();
      else if (this.input.consumePressed('choice1')) this.acceptOffer();
      else if (this.input.consumePressed('choice2')) this.closeOffer();
    }

    const m = this.mission;
    if (!m) {
      this.hudLine.style.display = 'none';
      return;
    }
    // Markers.
    if (m.kind === 'delivery' || m.kind === 'longhaul') {
      this.beacon.visible = true;
      this.beacon.position.copy(m.points[0]);
    } else if (m.kind === 'swim') {
      // Buoys bob on the swell; the next one glows.
      this.packageMeshes.forEach((b, i) => {
        b.position.y = WATER_Y - 0.1 + Math.sin(this.time * 1.6 + i) * 0.15;
        b.scale.setScalar(i === m.done ? 1.25 : 1);
      });
    } else if (m.kind === 'race') {
      this.rings.forEach((r, i) => {
        (r.material as THREE.MeshBasicMaterial).color.set(i === m.done ? 0x4cd964 : 0x3a6b44);
      });
    } else if (m.kind === 'packages') {
      for (const box of this.packageMeshes) box.rotation.y += frameDt * 1.5;
    } else if (m.kind === 'wreck' && m.target) {
      this.targetArrow.visible = true;
      this.targetArrow.position.set(m.target.currPos.x, 3.2 + Math.sin(this.time * 4) * 0.2, m.target.currPos.z);
      this.targetArrow.rotation.y += frameDt * 2;
    } else if (m.kind === 'rings') {
      this.rings.forEach((r, i) => {
        (r.material as THREE.MeshBasicMaterial).color.set(i === m.done ? 0xffd60a : 0x8a7a3a);
      });
    }
    // HUD line: title, progress and clock.
    const clock = Number.isFinite(m.timeLeft)
      ? ` · ${Math.floor(m.timeLeft / 60)}:${String(Math.floor(m.timeLeft % 60)).padStart(2, '0')}`
      : '';
    const progress = ['packages', 'rings', 'swim', 'race', 'summit'].includes(m.kind) ? ` (${m.done}/${m.points.length})` : '';
    const text = `${m.title}${progress}${clock}`;
    if (this.hudLine.textContent !== text) this.hudLine.textContent = text;
    this.hudLine.style.display = '';
    this.hudLine.style.color = Number.isFinite(m.timeLeft) && m.timeLeft < 15 ? '#ff6b6b' : '#fff';
  }

  /** Where to point the minimap: the current objective(s). */
  objectives(): THREE.Vector3[] {
    const m = this.mission;
    if (!m) return [];
    if (m.kind === 'delivery' || m.kind === 'longhaul') return [m.points[0]];
    if (m.kind === 'packages' || m.kind === 'summit') return m.points.filter((_, i) => this.packageMeshes[i]?.visible);
    if (m.kind === 'wreck') return m.target ? [m.target.currPos] : [];
    const ring = m.points[m.done];
    return ring ? [ring] : [];
  }
}

/** Base pay and $ per second left on the clock, per mission type. */
const REWARDS: Record<MissionKind, { base: number; bonus: number }> = {
  delivery: { base: 150, bonus: 2 },
  packages: { base: 200, bonus: 1.5 },
  wreck: { base: 250, bonus: 2 },
  rings: { base: 300, bonus: 3 },
  swim: { base: 220, bonus: 2 },
  race: { base: 350, bonus: 4 },
  summit: { base: 300, bonus: 1 },
  longhaul: { base: 300, bonus: 1.5 }, // base is recomputed from the distance
};

/** A red-and-white marker buoy (origin at the waterline). */
function buoyMesh(): THREE.Mesh {
  const buoy = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.7, 1.2, 14).translate(0, 0.3, 0),
    new THREE.MeshStandardMaterial({ color: 0xe03a2f, roughness: 0.5, emissive: 0x401010 }),
  );
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(0.58, 0.58, 0.3, 14).translate(0, 0.55, 0),
    new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 }),
  );
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8).translate(0, 1.05, 0), new THREE.MeshBasicMaterial({ color: 0xffd60a }));
  buoy.add(band, light);
  return buoy;
}

/** A flag on a pole (origin at the foot of the pole). */
function flagMesh(): THREE.Mesh {
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.06, 3.2, 8).translate(0, 1.6, 0),
    new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.5, roughness: 0.4 }),
  );
  const cloth = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 0.75).translate(0.6, 2.75, 0),
    new THREE.MeshStandardMaterial({ color: 0xff3b5c, emissive: 0x501020, side: THREE.DoubleSide }),
  );
  pole.add(cloth);
  return pole;
}
