import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Input } from '../input/actions';
import type { SimEntity } from '../sim/entity';
import type { CharacterModel } from '../player/character';
import type { CharacterLibrary, Look } from '../player/characterLibrary';
import type { Interactable } from '../player/onFoot';
import type { Traffic, TrafficCar } from '../npc/traffic';
import type { PlayerStats } from './stats';
import { BLOCK_SIZE, CURB_HEIGHT, MID, WORLD_HALF, type Block, type CityLayout } from '../world/layout';

// Missions, handed out by three characters who stand at fixed spots with a "!" over their
// heads. They don't walk about and can't be hurt: they aren't pedestrians at all, just a
// model with a solid collider (bullets and fists simply stop on it).
//
//   Marco          — courier jobs: deliveries (drive to a spot in time) or package runs
//                    (collect several packages around the city in time)
//   Vera           — wreck a marked traffic car before it gets away
//   Captain Reyes  — fly the helicopter through a course of rings in the sky
//
// One mission at a time. Success pays a base reward plus a bonus for time left; failing
// costs nothing (talk to the giver again for a new job). Dying fails the mission.

type MissionKind = 'delivery' | 'packages' | 'wreck' | 'rings';

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
const GIVER_RADIUS = 2.6; // m, how close to stand to talk to a giver
/** Fixed looks for the three givers (character id, skin, hair, outfit variant, height). */
const GIVER_LOOKS: Look[] = [
  { id: 'm_hoodie', skin: 3, hair: 0, outfit: 4, height: 1.8 }, // Marco
  { id: 'w_suit', skin: 1, hair: 4, outfit: 0, height: 1.7 }, // Vera
  { id: 'm_outdoors', skin: 2, hair: 5, outfit: 0, height: 1.84 }, // Captain Reyes
];

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
  ) {
    // --- The three givers, on sidewalks around the spawn (fixed, not random).
    const mid = MID;
    const block = (bx: number, bz: number) => layout.blockAt(bx, bz)!;
    const specs: [string, MissionKind[], Block, string][] = [
      ['Marco', ['delivery', 'packages'], block(mid, mid + 1), 'Need a courier. Quick money, no questions.'],
      ['Vera', ['wreck'], block(mid - 1, mid + 2), "There's a car out there I want off the road."],
      ['Captain Reyes', ['rings'], block(mid + 1, mid + 2), 'Fancy yourself a pilot? Prove it.'],
    ];
    const badge = badgeTexture();
    specs.forEach(([name, kinds, b, greeting], k) => {
      // On the sidewalk 6 m from the block's south-west corner, between the pedestrians'
      // path and the curb, facing out to the street.
      const half = BLOCK_SIZE / 2;
      const position = new THREE.Vector3(b.cx - half + 1.2, CURB_HEIGHT, b.cz + half - 6);
      const facing = Math.PI / 2; // face −X (the road)
      world.createCollider(RAPIER.ColliderDesc.capsule(0.55, 0.35).setTranslation(position.x, position.y + 0.9, position.z));
      const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: badge, depthTest: true }));
      marker.scale.set(0.7, 0.7, 0.7);
      scene.add(marker);
      const giver: Giver = { name, kinds, position, facing, model: null, marker, greeting, waveTimer: 4 + k * 3 };
      this.givers.push(giver);
      void library?.create(GIVER_LOOKS[k]).then((model) => {
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
      const p = new THREE.Vector3(b.cx + x, CURB_HEIGHT, b.cz + z);
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
    for (const mesh of [...this.packageMeshes, ...this.rings]) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
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
    if (m.kind === 'delivery') {
      this.beacon.visible = true;
      this.beacon.position.copy(m.points[0]);
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
    const progress = m.kind === 'packages' || m.kind === 'rings' ? ` (${m.done}/${m.points.length})` : '';
    const text = `${m.title}${progress}${clock}`;
    if (this.hudLine.textContent !== text) this.hudLine.textContent = text;
    this.hudLine.style.display = '';
    this.hudLine.style.color = Number.isFinite(m.timeLeft) && m.timeLeft < 15 ? '#ff6b6b' : '#fff';
  }

  /** Where to point the minimap: the current objective(s). */
  objectives(): THREE.Vector3[] {
    const m = this.mission;
    if (!m) return [];
    if (m.kind === 'delivery') return [m.points[0]];
    if (m.kind === 'packages') return m.points.filter((_, i) => this.packageMeshes[i]?.visible);
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
};
