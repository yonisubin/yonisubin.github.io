import * as THREE from 'three';
import type { SimEntity } from '../sim/entity';
import type { CharacterModel } from '../player/character';
import { Rng } from '../world/rng';
import { BLOCK_SIZE, CURB_HEIGHT, type Block, type CityLayout } from '../world/layout';

// Pedestrians: recoloured copies of the player's animated model, strolling around the
// sidewalk of a city block (a square loop), pausing now and then, and waiting if the player
// is standing in their way. No physics: they follow their loop exactly.
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

/** Outfit tints (multiply the model's textures). */
const OUTFITS = [0xffffff, 0x8fa8d8, 0xd89a8f, 0xa8c49a, 0xc9b98f, 0x9a9aa8, 0xd8c8e8, 0x7f8a99, 0xe0d0b0];

interface Pedestrian {
  model: CharacterModel;
  block: Block;
  half: number; // half-size of this pedestrian's loop square
  u: number; // distance along the loop perimeter, m
  direction: 1 | -1;
  speed: number;
  pause: number; // seconds left standing still
  moving: number; // current speed (0 while paused/waiting)
  prevPos: THREE.Vector3;
  currPos: THREE.Vector3;
  facing: number;
  active: boolean;
}

export class Pedestrians implements SimEntity {
  private readonly peds: Pedestrian[] = [];
  private readonly rng = new Rng(777);
  private readonly tmp = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private readonly layout: CityLayout,
    template: CharacterModel,
    count: number,
    private readonly playerPosition: () => THREE.Vector3,
  ) {
    for (let k = 0; k < count; k++) {
      const model = template.clone(new THREE.Color(OUTFITS[k % OUTFITS.length]));
      scene.add(model.root);
      const ped: Pedestrian = {
        model,
        block: layout.blocks[0],
        half: 0,
        u: 0,
        direction: 1,
        speed: 1.5,
        pause: 0,
        moving: 0,
        prevPos: new THREE.Vector3(),
        currPos: new THREE.Vector3(),
        facing: 0,
        active: false,
      };
      this.peds.push(ped);
      this.respawn(ped, 15);
    }
  }

  private respawn(ped: Pedestrian, minDist = SPAWN_MIN): void {
    const player = this.playerPosition();
    for (let attempt = 0; attempt < 30; attempt++) {
      const block = this.rng.pick(this.layout.blocks);
      ped.block = block;
      ped.half = BLOCK_SIZE / 2 - this.rng.range(LOOP_INSET_MIN, LOOP_INSET_MAX);
      ped.u = this.rng.range(0, 8 * ped.half);
      this.loopPoint(ped, ped.u, this.tmp);
      const dist = Math.hypot(this.tmp.x - player.x, this.tmp.z - player.z);
      if (dist < minDist || dist > SPAWN_MAX) continue;
      ped.direction = this.rng.chance(0.5) ? 1 : -1;
      ped.speed = this.rng.range(1.45, 1.8);
      ped.pause = 0;
      ped.currPos.copy(this.tmp);
      ped.prevPos.copy(this.tmp);
      ped.active = true;
      ped.model.root.visible = true;
      return;
    }
    ped.active = false;
    ped.model.root.visible = false;
  }

  /**
   * Point at distance u along the square loop around the block, starting at the (−X, −Z)
   * corner and going along +X, then +Z, then −X, then −Z.
   */
  private loopPoint(ped: Pedestrian, u: number, out: THREE.Vector3): THREE.Vector3 {
    const h = ped.half;
    const side = 2 * h;
    const perimeter = 4 * side;
    const t = ((u % perimeter) + perimeter) % perimeter;
    const k = Math.floor(t / side);
    const f = t - k * side;
    const { cx, cz } = ped.block;
    if (k === 0) return out.set(cx - h + f, CURB_HEIGHT, cz - h);
    if (k === 1) return out.set(cx + h, CURB_HEIGHT, cz - h + f);
    if (k === 2) return out.set(cx + h - f, CURB_HEIGHT, cz + h);
    return out.set(cx - h, CURB_HEIGHT, cz + h - f);
  }

  fixedUpdate(dt: number): void {
    const player = this.playerPosition();
    for (const ped of this.peds) {
      if (!ped.active || Math.hypot(ped.currPos.x - player.x, ped.currPos.z - player.z) > DESPAWN) {
        this.respawn(ped);
        continue;
      }
      ped.prevPos.copy(ped.currPos);

      // Occasional pauses (window shopping, phone…).
      if (ped.pause > 0) {
        ped.pause -= dt;
        ped.moving = 0;
        continue;
      }
      if (this.rng.chance(0.03 * dt)) ped.pause = this.rng.range(2, 5);

      // Look a step ahead; wait if the player is standing right there.
      const ahead = this.loopPoint(ped, ped.u + ped.direction * 1.2, this.tmp);
      const blocked = Math.hypot(ahead.x - player.x, ahead.z - player.z) < 1.0 && Math.abs(player.y - ahead.y) < 2.5;
      ped.moving = blocked ? 0 : ped.speed;
      ped.u += ped.direction * ped.moving * dt;
      this.loopPoint(ped, ped.u, ped.currPos);

      // Face the walking direction.
      const dx = ped.currPos.x - ped.prevPos.x;
      const dz = ped.currPos.z - ped.prevPos.z;
      if (dx * dx + dz * dz > 1e-6) ped.facing = Math.atan2(-dx, -dz); // model faces −Z
    }
  }

  afterStep(): void {}

  render(alpha: number, frameDt: number): void {
    const player = this.playerPosition();
    for (const ped of this.peds) {
      if (!ped.active) continue;
      const root = ped.model.root;
      root.position.lerpVectors(ped.prevPos, ped.currPos, alpha);
      // Turn smoothly at corners rather than snapping 90°.
      let diff = ped.facing - root.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      root.rotation.y += diff * Math.min(1, frameDt * 8);
      const dist = root.position.distanceTo(player);
      root.visible = dist < VISIBLE_WITHIN;
      if (dist < ANIMATE_WITHIN) ped.model.update(ped.moving, true, frameDt);
    }
  }

  /** For tests. */
  get debugPeds(): { pos: THREE.Vector3; block: Block; moving: number; active: boolean }[] {
    return this.peds.map((p) => ({ pos: p.currPos, block: p.block, moving: p.moving, active: p.active }));
  }
}
