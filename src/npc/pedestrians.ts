import * as THREE from 'three';
import type { SimEntity } from '../sim/entity';
import type { CharacterModel } from '../player/character';
import type { CharacterLibrary } from '../player/characterLibrary';
import { Rng } from '../world/rng';
import { BLOCK_SIZE, type Block, type CityLayout } from '../world/layout';
import { ROAD_SPECS } from '../world/streets';

// Pedestrians: random people from the character library (each with their own skin tone,
// hair, outfit colours and height), strolling along a loop of sidewalk — round a downtown
// block, or in the suburbs out along one side of a street and back along the other — pausing
// now and then, and waiting if the player is standing in their way. No physics: they follow
// their loop exactly.
//
// They react to the player:
//   talk  — stop and face the player during a chat;
//   flee  — run along their loop away from danger (gunfire, a fight, a rude remark);
//   angry — leave the loop, chase the player and punch;
//   down  — knocked out at zero health: fall over, lie still, then sink away and respawn.
//
// A fixed pool is kept around the player; anyone too far away reappears on a block nearer by.

const SPAWN_MIN = 35; // m from the player
const SPAWN_MAX = 120;
const DESPAWN = 150;
const ANIMATE_WITHIN = 70; // m; farther away the pose is left frozen (saves CPU on phones)
const VISIBLE_WITHIN = 90; // m; farther away they're hidden entirely
// Sidewalk loop: blocks are BLOCK_SIZE square, sidewalks the outer 4 m. Walk ~1.5–3 m in
// from the curb, clear of the street trees (1.4 m from the curb) and the lamp posts.
const LOOP_INSET_MIN = 2.4;
const LOOP_INSET_MAX = 3.2;
const MAX_HEALTH = 100;
const RUN_SPEED = 4.3; // m/s when fleeing or chasing
const FLEE_TIME = 9; // s
const PUNCH_RANGE = 1.3; // m
const PUNCH_DAMAGE = 7;
const PUNCH_INTERVAL = 1.1; // s
const GIVE_UP_DISTANCE = 30; // m: angry pedestrians stop chasing beyond this
const DOWN_TIME = 12; // s lying on the ground before sinking away
const HIT_RADIUS = 0.4; // m, body radius for bullets
const BODY_HEIGHT = 1.75; // m


export type PedState = 'walk' | 'talk' | 'flee' | 'angry' | 'down';

export interface Pedestrian {
  /** Null until this person's model has downloaded (they stay out of the world until then). */
  model: CharacterModel | null;
  /** The downtown block they walk round (null on a suburban street). */
  block: Block | null;
  /** Their loop: a closed polyline (x, z pairs) and the distance along it at each point. */
  path: Float32Array;
  pathCum: Float32Array;
  pathLength: number;
  u: number; // distance along the loop, m
  direction: 1 | -1;
  speed: number;
  pause: number; // seconds left standing still
  moving: number; // current speed (0 while paused/waiting)
  prevPos: THREE.Vector3;
  currPos: THREE.Vector3;
  facing: number;
  active: boolean;
  state: PedState;
  stateTime: number; // seconds in the current state
  health: number;
  stagger: number; // seconds of hit reaction left (stands still)
  punchCooldown: number;
}

/** What pedestrians need from the rest of the game. */
export interface PedestrianHooks {
  /** Player position, and whether they're on foot (pedestrians only fight people on foot). */
  player(): { position: THREE.Vector3; onFoot: boolean };
  /** A pedestrian punched the player. */
  hitPlayer(damage: number): void;
  /** A pedestrian was knocked out here (drops cash). */
  knockedOut(position: THREE.Vector3): void;
  /** Height you'd stand at, at (x, z): sidewalks follow the hills (Terrain.surfaceAt). */
  surface(x: number, z: number): number;
}

export class Pedestrians implements SimEntity {
  private readonly peds: Pedestrian[] = [];
  private readonly rng = new Rng(777);
  private readonly tmp = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private readonly layout: CityLayout,
    library: CharacterLibrary,
    count: number,
    private readonly hooks: PedestrianHooks,
  ) {
    for (let k = 0; k < count; k++) {
      const ped: Pedestrian = {
        model: null,
        block: null,
        path: new Float32Array(4),
        pathCum: new Float32Array(2),
        pathLength: 1,
        u: 0,
        direction: 1,
        speed: 1.5,
        pause: 0,
        moving: 0,
        prevPos: new THREE.Vector3(),
        currPos: new THREE.Vector3(),
        facing: 0,
        active: false,
        state: 'walk',
        stateTime: 0,
        health: MAX_HEALTH,
        stagger: 0,
        punchCooldown: 0,
      };
      this.peds.push(ped);
      // A random person; they join the street once their model has loaded.
      void library.create(library.randomLook(() => this.rng.float())).then((model) => {
        ped.model = model;
        model.root.visible = false;
        scene.add(model.root);
        this.respawn(ped, 15);
      });
    }
  }

  private respawn(ped: Pedestrian, minDist = SPAWN_MIN): void {
    const player = this.hooks.player().position;
    if (!ped.model) return;
    ped.model.reset();
    // Downtown blocks and suburban streets with sidewalks within reach.
    const near = this.layout.blocks.filter((b) => Math.hypot(b.cx - player.x, b.cz - player.z) < SPAWN_MAX + BLOCK_SIZE);
    const net = this.layout.streets.net;
    const streets = new Set<number>();
    net.index.forEachNear(player.x, player.z, SPAWN_MAX, (e) => {
      const edge = net.edges[e];
      if (ROAD_SPECS[edge.cls].sidewalk > 0 && edge.length > 40) streets.add(e);
    });
    const streetList = [...streets];
    for (let attempt = 0; attempt < 30 && (near.length || streetList.length); attempt++) {
      if (near.length && (!streetList.length || this.rng.chance(near.length / (near.length + streetList.length * 0.5)))) {
        const block = this.rng.pick(near);
        ped.block = block;
        this.setPath(ped, blockLoop(block.cx, block.cz, BLOCK_SIZE / 2 - this.rng.range(LOOP_INSET_MIN, LOOP_INSET_MAX)));
      } else {
        ped.block = null;
        this.setPath(ped, this.streetLoop(this.rng.pick(streetList)));
      }
      ped.u = this.rng.range(0, ped.pathLength);
      this.loopPoint(ped, ped.u, this.tmp);
      const dist = Math.hypot(this.tmp.x - player.x, this.tmp.z - player.z);
      if (dist < minDist || dist > SPAWN_MAX) continue;
      ped.direction = this.rng.chance(0.5) ? 1 : -1;
      ped.speed = this.rng.range(1.45, 1.8);
      ped.pause = 0;
      ped.currPos.copy(this.tmp);
      ped.prevPos.copy(this.tmp);
      ped.active = true;
      ped.health = MAX_HEALTH;
      ped.stagger = 0;
      this.setState(ped, 'walk');
      ped.model.root.visible = true;
      return;
    }
    ped.active = false;
    ped.model.root.visible = false;
  }

  private setState(ped: Pedestrian, state: PedState): void {
    ped.state = state;
    ped.stateTime = 0;
  }

  private setPath(ped: Pedestrian, pts: number[]): void {
    // Close the loop.
    const closed = [...pts, pts[0], pts[1]];
    const n = closed.length / 2;
    const cum = new Float32Array(n);
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(closed[i * 2] - closed[i * 2 - 2], closed[i * 2 + 1] - closed[i * 2 - 1]);
    ped.path = new Float32Array(closed);
    ped.pathCum = cum;
    ped.pathLength = Math.max(1, cum[n - 1]);
  }

  /**
   * A suburban loop: out along the sidewalk on one side of a street (at most ~160 m of it),
   * across, and back along the other side. Kept clear of the junctions at its ends.
   */
  private streetLoop(edgeId: number): number[] {
    const net = this.layout.streets.net;
    const e = net.edges[edgeId];
    const spec = ROAD_SPECS[e.cls];
    const off = spec.width / 2 + spec.sidewalk * 0.55;
    const span = Math.min(160, e.length - 20);
    const s0 = 10 + this.rng.range(0, e.length - 20 - span);
    const pt = { x: 0, z: 0, tx: 0, tz: 0 };
    const side = (sign: number, from: number, to: number): number[] => {
      const out: number[] = [];
      const steps = Math.max(2, Math.ceil(Math.abs(to - from) / 4));
      for (let k = 0; k <= steps; k++) {
        net.pointAt(e, from + ((to - from) * k) / steps, pt);
        // Right of travel along the edge is (−tz, tx).
        out.push(pt.x - pt.tz * off * sign, pt.z + pt.tx * off * sign);
      }
      return out;
    };
    return [...side(1, s0, s0 + span), ...side(-1, s0 + span, s0)];
  }

  /** Point at distance u along the pedestrian's loop. */
  private loopPoint(ped: Pedestrian, u: number, out: THREE.Vector3): THREE.Vector3 {
    const len = ped.pathLength;
    const t = ((u % len) + len) % len;
    const cum = ped.pathCum;
    let lo = 0;
    let hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= t) lo = mid;
      else hi = mid;
    }
    const f = (t - cum[lo]) / (cum[hi] - cum[lo] || 1);
    const p = ped.path;
    out.set(p[lo * 2] + (p[hi * 2] - p[lo * 2]) * f, 0, p[lo * 2 + 1] + (p[hi * 2 + 1] - p[lo * 2 + 1]) * f);
    out.y = this.hooks.surface(out.x, out.z);
    return out;
  }

  /** Inverse of loopPoint: the u of the loop point nearest to `p`. */
  private projectToLoop(ped: Pedestrian, q: THREE.Vector3): number {
    const p = ped.path;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i + 1 < ped.pathCum.length; i++) {
      const ax = p[i * 2];
      const az = p[i * 2 + 1];
      const dx = p[i * 2 + 2] - ax;
      const dz = p[i * 2 + 3] - az;
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((q.x - ax) * dx + (q.z - az) * dz) / l2));
      const d = Math.hypot(q.x - ax - dx * t, q.z - az - dz * t);
      if (d < bestD) {
        bestD = d;
        best = ped.pathCum[i] + Math.sqrt(l2) * t;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- interaction API

  /** The nearest pedestrian who can be talked to (walking, not hostile or down). */
  nearestTalkable(position: THREE.Vector3, radius: number): Pedestrian | null {
    let best: Pedestrian | null = null;
    let bestDist = radius;
    for (const p of this.peds) {
      if (!p.active || p.state !== 'walk') continue;
      const d = Math.hypot(p.currPos.x - position.x, p.currPos.z - position.z);
      if (d < bestDist && Math.abs(p.currPos.y + 0.9 - position.y) < 2) {
        best = p;
        bestDist = d;
      }
    }
    return best;
  }

  startTalking(ped: Pedestrian): void {
    this.setState(ped, 'talk');
  }

  /** End a chat: back to walking, or run off / pick a fight. */
  endTalking(ped: Pedestrian, outcome: 'calm' | 'flee' | 'angry'): void {
    if (ped.state !== 'talk') return;
    this.setState(ped, outcome === 'calm' ? 'walk' : outcome);
  }

  /** Melee: the nearest pedestrian within `range` in front of `origin` (cone half-angle ~50°). */
  meleeTarget(origin: THREE.Vector3, forward: THREE.Vector3, range: number): Pedestrian | null {
    let best: Pedestrian | null = null;
    let bestDist = range;
    for (const p of this.peds) {
      if (!p.active || p.state === 'down') continue;
      const dx = p.currPos.x - origin.x;
      const dz = p.currPos.z - origin.z;
      const dist = Math.hypot(dx, dz);
      if (dist > bestDist || Math.abs(p.currPos.y + 0.9 - origin.y) > 1.5) continue;
      const cos = dist > 0.01 ? (dx * forward.x + dz * forward.z) / dist : 1;
      if (cos < 0.64) continue;
      best = p;
      bestDist = dist;
    }
    return best;
  }

  /**
   * Bullets: nearest pedestrian hit by the ray origin + t·dir (dir normalised) before
   * `maxDist`. Bodies are vertical cylinders: find where the ray passes closest to the
   * body's vertical axis (seen from above), then check radius and height there.
   */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): { ped: Pedestrian; dist: number } | null {
    let best: { ped: Pedestrian; dist: number } | null = null;
    for (const p of this.peds) {
      if (!p.active || p.state === 'down') continue;
      const ox = origin.x - p.currPos.x;
      const oz = origin.z - p.currPos.z;
      const a = dir.x * dir.x + dir.z * dir.z;
      if (a < 1e-6) continue;
      const t = -(ox * dir.x + oz * dir.z) / a;
      if (t < 0 || t > maxDist) continue;
      const cx = ox + dir.x * t;
      const cz = oz + dir.z * t;
      if (cx * cx + cz * cz > HIT_RADIUS * HIT_RADIUS) continue;
      const y = origin.y + dir.y * t - p.currPos.y;
      if (y < 0 || y > BODY_HEIGHT) continue;
      if (!best || t < best.dist) best = { ped: p, dist: t };
    }
    return best;
  }

  /** Nearest pedestrian within a narrow cone of the ray (aim assist on touch screens). */
  aimAssist(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, cosLimit: number): Pedestrian | null {
    let best: Pedestrian | null = null;
    let bestCos = cosLimit;
    for (const p of this.peds) {
      if (!p.active || p.state === 'down') continue;
      const to = this.tmp.set(p.currPos.x - origin.x, p.currPos.y + 1.1 - origin.y, p.currPos.z - origin.z);
      const dist = to.length();
      if (dist > maxDist || dist < 0.5) continue;
      const cos = to.dot(dir) / dist;
      if (cos > bestCos) {
        best = p;
        bestCos = cos;
      }
    }
    return best;
  }

  /** Hurt a pedestrian. Melee hits may make them fight back; gunshots make them run. */
  damage(ped: Pedestrian, amount: number, kind: 'melee' | 'gun'): void {
    if (!ped.active || ped.state === 'down') return;
    ped.health -= amount;
    if (ped.health <= 0) {
      ped.health = 0;
      this.setState(ped, 'down');
      ped.moving = 0;
      ped.model?.knockDown();
      this.hooks.knockedOut(ped.currPos);
      return;
    }
    ped.stagger = 0.35;
    ped.model?.play('hit');
    if (ped.state !== 'angry') {
      const fightBack = kind === 'melee' && ped.health > 45 && this.rng.chance(0.5);
      this.setState(ped, fightBack ? 'angry' : 'flee');
    }
  }

  /** Something alarming happened at `position`: everyone nearby runs away. */
  alarm(position: THREE.Vector3, radius: number): void {
    for (const p of this.peds) {
      if (!p.active || p.state === 'down' || p.state === 'angry' || p.state === 'flee') continue;
      if (p.currPos.distanceTo(position) < radius) this.setState(p, 'flee');
    }
  }

  // ---------------------------------------------------------------- simulation

  fixedUpdate(dt: number): void {
    const { position: player, onFoot } = this.hooks.player();
    for (const ped of this.peds) {
      if (!ped.model) continue; // still loading
      const far = Math.hypot(ped.currPos.x - player.x, ped.currPos.z - player.z) > DESPAWN;
      if (!ped.active || (far && ped.state !== 'down')) {
        this.respawn(ped);
        continue;
      }
      ped.prevPos.copy(ped.currPos);
      ped.stateTime += dt;
      ped.punchCooldown = Math.max(0, ped.punchCooldown - dt);
      if (ped.stagger > 0 && ped.state !== 'down') {
        ped.stagger -= dt;
        ped.moving = 0;
        continue;
      }

      switch (ped.state) {
        case 'down':
          ped.moving = 0;
          if (ped.stateTime > DOWN_TIME + 1.5) this.respawn(ped); // after sinking away
          break;
        case 'talk':
          ped.moving = 0;
          ped.facing = Math.atan2(-(player.x - ped.currPos.x), -(player.z - ped.currPos.z));
          // Walked off mid-conversation: carry on.
          if (Math.hypot(player.x - ped.currPos.x, player.z - ped.currPos.z) > 5 || ped.stateTime > 30) {
            this.setState(ped, 'walk');
          }
          break;
        case 'flee': {
          // Run along the loop, whichever way leads away from the player.
          const ahead = this.loopPoint(ped, ped.u + ped.direction * 2, this.tmp);
          const now = Math.hypot(ped.currPos.x - player.x, ped.currPos.z - player.z);
          const next = Math.hypot(ahead.x - player.x, ahead.z - player.z);
          if (next < now - 0.5) ped.direction = ped.direction === 1 ? -1 : 1;
          this.walkLoop(ped, RUN_SPEED, dt);
          if (ped.stateTime > FLEE_TIME) this.setState(ped, 'walk');
          break;
        }
        case 'angry': {
          // Leave the loop and go for the player; punch when close.
          const dx = player.x - ped.currPos.x;
          const dz = player.z - ped.currPos.z;
          const dist = Math.hypot(dx, dz);
          if (!onFoot || dist > GIVE_UP_DISTANCE || ped.stateTime > 25) {
            ped.u = this.projectToLoop(ped, ped.currPos); // calm down, rejoin the sidewalk
            this.loopPoint(ped, ped.u, ped.currPos);
            ped.prevPos.copy(ped.currPos);
            this.setState(ped, 'walk');
            break;
          }
          ped.facing = Math.atan2(-dx, -dz);
          const stopAt = PUNCH_RANGE * 0.8;
          if (dist > stopAt) {
            const step = Math.min(dist - stopAt, RUN_SPEED * dt);
            ped.currPos.x += (dx / dist) * step;
            ped.currPos.z += (dz / dist) * step;
            ped.currPos.y = this.groundHeight(ped.currPos.x, ped.currPos.z);
            ped.moving = RUN_SPEED;
          } else {
            ped.moving = 0;
          }
          if (dist < PUNCH_RANGE && ped.punchCooldown === 0 && Math.abs(player.y - 0.9 - ped.currPos.y) < 1.5) {
            ped.punchCooldown = PUNCH_INTERVAL;
            this.hooks.hitPlayer(PUNCH_DAMAGE);
            ped.model?.play('punch');
          }
          break;
        }
        case 'walk': {
          // Occasional pauses (window shopping, phone…).
          if (ped.pause > 0) {
            ped.pause -= dt;
            ped.moving = 0;
            break;
          }
          if (this.rng.chance(0.03 * dt)) ped.pause = this.rng.range(2, 5);
          // Look a step ahead; wait if the player is standing right there.
          const ahead = this.loopPoint(ped, ped.u + ped.direction * 1.2, this.tmp);
          const blocked = Math.hypot(ahead.x - player.x, ahead.z - player.z) < 1.0 && Math.abs(player.y - ahead.y) < 2.5;
          this.walkLoop(ped, blocked ? 0 : ped.speed, dt);
          break;
        }
      }
    }
  }

  private walkLoop(ped: Pedestrian, speed: number, dt: number): void {
    ped.moving = speed;
    ped.u += ped.direction * speed * dt;
    this.loopPoint(ped, ped.u, ped.currPos);
    const dx = ped.currPos.x - ped.prevPos.x;
    const dz = ped.currPos.z - ped.prevPos.z;
    if (dx * dx + dz * dz > 1e-6) ped.facing = Math.atan2(-dx, -dz); // model faces −Z
  }

  /** Sidewalks follow the hills; off the sidewalk, the road or ground. */
  private groundHeight(x: number, z: number): number {
    return this.hooks.surface(x, z);
  }

  afterStep(): void {}

  render(alpha: number, frameDt: number): void {
    const player = this.hooks.player().position;
    for (const ped of this.peds) {
      if (!ped.active || !ped.model) continue;
      const model = ped.model;
      const root = model.root;
      root.position.lerpVectors(ped.prevPos, ped.currPos, alpha);
      if (ped.state === 'down') {
        // Fall (the knock-down animation), lie still, then sink out of sight.
        root.position.y -= Math.max(0, ped.stateTime - DOWN_TIME) * 0.8;
        model.update(0, true, frameDt);
        continue;
      }
      model.setTalking(ped.state === 'talk');
      // Turn smoothly at corners rather than snapping 90°.
      let diff = ped.facing - root.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      root.rotation.y += diff * Math.min(1, frameDt * 8);
      const dist = root.position.distanceTo(player);
      root.visible = dist < VISIBLE_WITHIN;
      if (dist < ANIMATE_WITHIN) model.update(ped.moving, true, frameDt);
    }
  }

  /** For tests. */
  get debugPeds(): { pos: THREE.Vector3; block: Block | null; moving: number; active: boolean; state: PedState; health: number }[] {
    return this.peds.map((p) => ({ pos: p.currPos, block: p.block, moving: p.moving, active: p.active, state: p.state, health: p.health }));
  }
}

/** A square loop of half-size h round (cx, cz), from the (−X, −Z) corner along +X, +Z, −X, −Z. */
function blockLoop(cx: number, cz: number, h: number): number[] {
  return [cx - h, cz - h, cx + h, cz - h, cx + h, cz + h, cx - h, cz + h];
}
