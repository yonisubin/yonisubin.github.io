// Inputs: the floor button (weighed down by a cube / sphere / the player) and the pedestal button
// (press with Use; optional countdown with ticking).
import * as THREE from 'three';
import { CONFIG } from '../core/config';
import type { ChamberContext } from '../game/context';
import type { Entity } from '../levels/level';
import { MAT } from '../render/models';
import { BaseElement, type Usable } from './base';
import { PhysProp } from './prop';

const E = CONFIG.elements;

/** props.accepts: 'any' (cubes, spheres, the player) | 'cube' | 'sphere'. Output: pressed. */
export class FloorButton extends BaseElement {
  private readonly plate: THREE.Mesh;
  private readonly lampMat: THREE.MeshBasicMaterial;
  private sink = 0;

  constructor(ctx: ChamberContext, entity: Entity) {
    super(ctx, entity);
    const o = this.origin();
    const r = E.buttonRadius;
    const accepts = this.accepts();
    const color = accepts === 'cube' ? 0x3fa7ff : accepts === 'sphere' ? 0xb57bff : 0xff5a3c;
    this.lampMat = new THREE.MeshBasicMaterial({ color: 0x3a1d18 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.15, r * 1.25, 0.06, 32), MAT.dark());
    base.position.set(o.x, o.y + 0.03, o.z);
    this.plate = new THREE.Mesh(new THREE.CylinderGeometry(r, r, E.buttonHeight, 32), new THREE.MeshLambertMaterial({ color }));
    this.plate.position.set(o.x, o.y + E.buttonHeight / 2, o.z);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.08, 0.025, 6, 40), this.lampMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(o.x, o.y + 0.065, o.z);
    this.add(base);
    this.add(this.plate);
    this.add(ring);
    // A low solid disc so things rest on the plate (a box is close enough for the physics).
    this.fixedBox(new THREE.Vector3(r * 0.85, E.buttonHeight / 2, r * 0.85), new THREE.Vector3(o.x, o.y + E.buttonHeight / 2, o.z));
    this.outputs.pressed = false;
  }

  private accepts(): 'any' | 'cube' | 'sphere' {
    return this.prop('accepts', 'any');
  }

  /** Is something heavy on the plate right now? */
  weighed(): boolean {
    const o = this.origin();
    const r = E.buttonRadius;
    const top = o.y + E.buttonHeight;
    const accepts = this.accepts();
    for (const el of this.ctx.elements.values()) {
      if (!(el instanceof PhysProp) || !el.alive || !el.body) continue;
      const t = el.type;
      const ok = accepts === 'any' ? t === 'cube' || t === 'companionCube' || t === 'sphere' : accepts === 'cube' ? t === 'cube' || t === 'companionCube' : t === 'sphere';
      if (!ok) continue;
      const p = el.position();
      if (Math.hypot(p.x - o.x, p.z - o.z) > r) continue;
      const bottom = p.y - (t === 'sphere' ? CONFIG.props.sphereRadius : CONFIG.props.cubeSize / 2);
      if (bottom > top - 0.1 && bottom < top + E.buttonSense) return true;
    }
    if (accepts === 'any' && !this.ctx.playerDead()) {
      const pl = this.ctx.player;
      const feet = pl.feetY();
      if (Math.hypot(pl.position.x - o.x, pl.position.z - o.z) < r + CONFIG.player.radius * 0.5 && feet > top - 0.1 && feet < top + E.buttonSense) return true;
    }
    return false;
  }

  update(dt: number): void {
    const on = this.weighed();
    if (on !== this.outputs.pressed) this.ctx.sfx(on ? 'buttonDown' : 'buttonUp', on ? 'Click' : undefined);
    this.setOutput('pressed', on);
    const target = on ? E.buttonTravel : 0;
    this.sink += Math.sign(target - this.sink) * Math.min(Math.abs(target - this.sink), dt * 0.5);
    this.plate.position.y = this.entity.position[1] + E.buttonHeight / 2 - this.sink;
    this.lampMat.color.setHex(on ? 0xff8a5c : 0x3a1d18);
  }
}

/** props.seconds: 0 = toggle, > 0 = on for that long (ticks). Output: pressed. */
export class PedestalButton extends BaseElement implements Usable {
  private remaining = 0;
  private nextTick = 0;
  private readonly cap: THREE.Mesh;

  constructor(ctx: ChamberContext, entity: Entity) {
    super(ctx, entity);
    const o = this.origin();
    const h = E.pedestalHeight;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.16, h, 16), MAT.white());
    col.position.set(o.x, o.y + h / 2, o.z);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.06, 20), MAT.dark());
    foot.position.set(o.x, o.y + 0.03, o.z);
    this.cap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.08, 20), new THREE.MeshBasicMaterial({ color: 0xc23a2a }));
    this.cap.position.set(o.x, o.y + h + 0.04, o.z);
    this.add(col);
    this.add(foot);
    this.add(this.cap);
    this.fixedBox(new THREE.Vector3(0.18, h / 2 + 0.05, 0.18), new THREE.Vector3(o.x, o.y + h / 2 + 0.05, o.z));
    this.outputs.pressed = false;
  }

  private seconds(): number {
    return this.prop('seconds', 0);
  }

  useText(): string | null {
    return this.seconds() > 0 && this.outputs.pressed ? null : 'E  press';
  }

  use(): void {
    const s = this.seconds();
    this.ctx.sfx('buttonPress', 'Click');
    if (s <= 0) {
      this.setOutput('pressed', !this.outputs.pressed);
      return;
    }
    if (this.outputs.pressed) return;
    this.remaining = s;
    this.nextTick = s;
    this.setOutput('pressed', true);
  }

  /** Seconds left on the countdown (0 when idle). */
  timeLeft(): number {
    return this.remaining;
  }

  update(dt: number): void {
    if (this.remaining > 0) {
      this.remaining -= dt;
      // One tick per second of countdown; captions for the shell.
      if (this.remaining <= this.nextTick - 1) {
        this.nextTick = Math.ceil(this.remaining);
        if (this.remaining > 0) this.ctx.sfx('tick', 'Tick');
      }
      if (this.remaining <= 0) {
        this.remaining = 0;
        this.ctx.sfx('timerDone', 'Timer runs out');
        this.setOutput('pressed', false);
      }
    }
    (this.cap.material as THREE.MeshBasicMaterial).color.setHex(this.outputs.pressed ? 0x4dff8a : 0xc23a2a);
    this.cap.position.y = this.entity.position[1] + E.pedestalHeight + (this.outputs.pressed ? 0.015 : 0.04);
  }

  snapshot(): unknown {
    return { ...(super.snapshot() as object), remaining: this.remaining, nextTick: this.nextTick };
  }

  restore(state: unknown): void {
    super.restore(state);
    const s = state as { remaining: number; nextTick: number };
    this.remaining = s.remaining;
    this.nextTick = s.nextTick;
  }
}
