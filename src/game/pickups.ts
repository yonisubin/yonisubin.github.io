import * as THREE from 'three';
import type { SimEntity } from '../sim/entity';
import type { PlayerStats } from './stats';
import { Rng, hashSeed } from '../world/rng';
import { BLOCK_SIZE, LOT, type CityLayout } from '../world/layout';
import { ROAD_SPECS } from '../world/streets';

// Cash lying around: glowing, spinning bundles of notes. Walk over one to pick it up.
// Placed with the city's seeded RNG (same seed, same spots); each comes back a few minutes
// after it's taken. Knocked-out pedestrians also drop cash (one-off pickups).

const PICKUP_RADIUS = 1.3; // m
const RESPAWN_TIME = 120; // s
const MAX_PICKUPS = 160; // instanced capacity: how many are drawn at once
const DRAW_DISTANCE = 180; // m

interface Pickup {
  position: THREE.Vector3;
  amount: number;
  /** Seconds until it reappears (0 = present). Dropped cash is removed instead. */
  away: number;
  dropped: boolean;
}

export class Cash implements SimEntity {
  private readonly pickups: Pickup[] = [];
  private readonly mesh: THREE.InstancedMesh;
  private readonly listeners: ((amount: number) => void)[] = [];
  private time = 0;
  private readonly mat = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    layout: CityLayout,
    private readonly stats: PlayerStats,
    /** Player position when on foot, or null while in a vehicle (no collecting from cars). */
    private readonly collector: () => THREE.Vector3 | null,
    /** Where the player is, on foot or not: only cash near here is drawn. */
    private readonly focus: () => THREE.Vector3,
    /** Height you'd stand at, at (x, z): sidewalk tops follow the hills (Terrain.surfaceAt). */
    surface: (x: number, z: number) => number,
  ) {
    const rng = new Rng(hashSeed(layout.seed, 5150, 77));
    for (const block of layout.blocks) {
      // Mostly on the sidewalk ring, sometimes in a park or plaza.
      const count = block.park ? rng.int(1, 3) : rng.chance(0.8) ? 1 : 0;
      for (let k = 0; k < count; k++) {
        let x: number;
        let z: number;
        if (block.park) {
          x = rng.range(-LOT / 2 + 4, LOT / 2 - 4);
          z = rng.range(-LOT / 2 + 4, LOT / 2 - 4);
        } else {
          // A random point on the sidewalk, 2–3 m in from the curb.
          const edge = BLOCK_SIZE / 2 - rng.range(2, 3);
          const along = rng.range(-edge + 6, edge - 6);
          const side = rng.int(0, 3);
          x = side < 2 ? (side === 0 ? edge : -edge) : along;
          z = side < 2 ? along : side === 2 ? edge : -edge;
        }
        this.pickups.push({
          position: new THREE.Vector3(block.cx + x, surface(block.cx + x, block.cz + z), block.cz + z),
          amount: 5 * rng.int(2, 16), // $10–80
          away: 0,
          dropped: false,
        });
      }
    }

    // The suburbs: now and then on a sidewalk (about one per 250 m of street), and in parks.
    const net = layout.streets.net;
    const pt = { x: 0, z: 0, tx: 0, tz: 0 };
    const add = (x: number, z: number) =>
      this.pickups.push({ position: new THREE.Vector3(x, surface(x, z), z), amount: 5 * rng.int(2, 16), away: 0, dropped: false });
    for (const e of net.edges) {
      const spec = ROAD_SPECS[e.cls];
      if (!spec.sidewalk || e.cls === 'downtown') continue;
      for (let s = rng.range(30, 250); s < e.length - 15; s += rng.range(180, 320)) {
        net.pointAt(e, s, pt);
        const off = (spec.width / 2 + spec.sidewalk / 2) * (rng.chance(0.5) ? 1 : -1);
        const x = pt.x - pt.tz * off;
        const z = pt.z + pt.tx * off;
        if (net.kerbDistance(x, z, 10) > 0.2) add(x, z);
      }
    }
    for (const p of layout.streets.parcels) {
      if (p.kind !== 'park') continue;
      for (let k = rng.int(1, 3); k > 0; k--) {
        const a = rng.range(-p.w / 2 + 6, p.w / 2 - 6);
        const b = rng.range(-p.d / 2 + 6, p.d / 2 - 6);
        add(p.x + Math.cos(p.yaw) * a + Math.sin(p.yaw) * b, p.z - Math.sin(p.yaw) * a + Math.cos(p.yaw) * b);
      }
    }

    // A small stack of green notes with a soft glow so it's visible from a distance.
    const geometry = new THREE.BoxGeometry(0.36, 0.14, 0.2);
    const material = new THREE.MeshStandardMaterial({
      color: 0x3f9b4a,
      emissive: 0x46d160,
      emissiveIntensity: 0.6,
      roughness: 0.6,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, MAX_PICKUPS);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** Called with the amount whenever the player picks up cash. */
  onCollect(listener: (amount: number) => void): void {
    this.listeners.push(listener);
  }

  /** Drop a one-off bundle of cash (e.g. from a knocked-out pedestrian). */
  drop(position: THREE.Vector3, amount: number): void {
    if (this.pickups.filter((p) => p.dropped).length >= 40) return;
    this.pickups.push({ position: position.clone(), amount, away: 0, dropped: true });
  }

  fixedUpdate(dt: number): void {
    this.time += dt;
    const p = this.collector();
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pickup = this.pickups[i];
      if (pickup.away > 0) {
        pickup.away = Math.max(0, pickup.away - dt);
        continue;
      }
      if (!p) continue;
      const dx = p.x - pickup.position.x;
      const dz = p.z - pickup.position.z;
      if (dx * dx + dz * dz < PICKUP_RADIUS * PICKUP_RADIUS && Math.abs(p.y - pickup.position.y) < 2.2) {
        this.stats.money += pickup.amount;
        for (const l of this.listeners) l(pickup.amount);
        if (pickup.dropped) this.pickups.splice(i, 1);
        else pickup.away = RESPAWN_TIME;
      }
    }
  }

  afterStep(): void {}

  render(): void {
    // Spin and bob; taken pickups are scaled to nothing.
    // The world has hundreds of spots: draw only those near the player.
    let n = 0;
    const f = this.focus();
    for (const pickup of this.pickups) {
      if (pickup.away > 0 || n >= MAX_PICKUPS) continue;
      const dx = pickup.position.x - f.x;
      const dz = pickup.position.z - f.z;
      if (dx * dx + dz * dz > DRAW_DISTANCE * DRAW_DISTANCE) continue;
      const phase = pickup.position.x * 0.37 + pickup.position.z * 0.61;
      this.quat.setFromAxisAngle(UP, this.time * 2 + phase);
      this.pos.copy(pickup.position);
      this.pos.y += 0.45 + Math.sin(this.time * 3 + phase) * 0.1;
      this.mesh.setMatrixAt(n++, this.mat.compose(this.pos, this.quat, this.scale.set(1, 1, 1)));
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** For tests and the minimap. */
  get available(): { position: THREE.Vector3; amount: number }[] {
    return this.pickups.filter((p) => p.away === 0);
  }
}

const UP = new THREE.Vector3(0, 1, 0);
