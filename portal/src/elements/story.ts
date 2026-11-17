// Story elements for chambers 11–19, the escape and the finale (workstream B):
//
//   zone      an invisible box (props.size, centred on the entity) watching the player.
//             Outputs: inside (while the player is in it), entered (latched on first entry).
//   chute     the Records Chute / incinerator: props.size box; a prop whose id is props.accepts (or
//             whose type is props.acceptsType; default any companionCube) that enters it is
//             dissolved ("filed"). Output: filed (latched).
//   exitZone  an exit without a booth (the c18 graduation dais drops into it): when the player is
//             inside props.size and input `armed` (default on) is on, the chamber ends like an exit
//             elevator — `exitReached`, then `elevatorDone` after props.delay seconds.
//   erasure   the finale's countdown hazard: the Provost floods the arena with correction fluid
//             ("the Erasure"). While input `active` is on it counts down props.seconds[stage] (the
//             stage is read from the bossCore props.core); a board shows the time left, the white
//             fluid creeps up the moat (props.moat: [x, z, w, d] at floor level) and at zero the
//             player is erased (death, cause liquid). Every new boss stage restarts the count with
//             that stage's (shorter) time. Output: warning (last 15 s).
import * as THREE from 'three';
import type { ChamberContext } from '../game/context';
import type { Entity } from '../levels/level';
import { MAT } from '../render/models';
import { BaseElement } from './base';
import { BossCore } from './boss';
import { PhysProp } from './prop';

function insideBox(p: THREE.Vector3, o: THREE.Vector3, size: [number, number, number]): boolean {
  return Math.abs(p.x - o.x) <= size[0] / 2 && Math.abs(p.y - o.y) <= size[1] / 2 && Math.abs(p.z - o.z) <= size[2] / 2;
}

/** Player's capsule centre is inside the box. */
function playerIn(ctx: ChamberContext, o: THREE.Vector3, size: [number, number, number]): boolean {
  return !ctx.playerDead() && insideBox(ctx.player.position, o, size);
}

export class Zone extends BaseElement {
  constructor(ctx: ChamberContext, entity: Entity) {
    super(ctx, entity);
    this.outputs.inside = false;
    this.outputs.entered = false;
  }

  update(): void {
    const inside = playerIn(this.ctx, this.origin(), this.prop<[number, number, number]>('size', [2, 3, 2]));
    this.setOutput('inside', inside);
    if (inside) this.setOutput('entered', true);
  }
}

export class Chute extends BaseElement {
  private readonly glow: THREE.MeshBasicMaterial;

  constructor(ctx: ChamberContext, entity: Entity) {
    super(ctx, entity);
    const [x, y, z] = this.size();
    const o = this.origin();
    const rim = this.add(new THREE.Mesh(new THREE.BoxGeometry(x + 0.3, 0.12, z + 0.3), MAT.dark()));
    rim.position.set(o.x, o.y + y / 2, o.z);
    this.glow = new THREE.MeshBasicMaterial({ color: 0xffb347 });
    const mouth = this.add(new THREE.Mesh(new THREE.PlaneGeometry(x, z), this.glow));
    mouth.rotation.x = -Math.PI / 2;
    mouth.position.set(o.x, o.y - y / 2 + 0.03, o.z);
    this.outputs.filed = false;
  }

  private size(): [number, number, number] {
    return this.prop<[number, number, number]>('size', [1.4, 1.6, 1.4]);
  }

  private accepts(el: PhysProp): boolean {
    const id = this.prop<string | null>('accepts', null);
    if (id) return el.id === id;
    return el.type === this.prop('acceptsType', 'companionCube');
  }

  update(dt: number): void {
    this.glow.color.setHSL(0.08, 1, 0.5 + 0.1 * Math.sin(this.ctx.time() * 4 + dt));
    if (this.outputs.filed) return;
    const o = this.origin();
    for (const el of [...this.ctx.elements.values()]) {
      if (!(el instanceof PhysProp) || !el.alive || !el.body || !this.accepts(el)) continue;
      if (!insideBox(el.position(), o, this.size())) continue;
      el.dissolve();
      this.ctx.sfx('chuteFiled', 'The chute swallows it with a polite chime');
      this.setOutput('filed', true);
    }
  }
}

export class ExitZone extends BaseElement {
  private t = -1;
  private done = false;

  update(dt: number): void {
    if (this.t < 0) {
      if (this.input('armed', true) && playerIn(this.ctx, this.origin(), this.prop<[number, number, number]>('size', [3, 3, 3]))) {
        this.t = 0;
        this.ctx.reachExit();
      }
      return;
    }
    this.t += dt;
    if (!this.done && this.t >= this.prop('delay', 3)) {
      this.done = true;
      this.ctx.events.emit('elevatorDone', { chamberId: this.ctx.chamberId(), next: this.ctx.level.next });
    }
  }

  snapshot(): unknown {
    return { ...(super.snapshot() as object), t: this.t, done: this.done };
  }

  restore(state: unknown): void {
    super.restore(state);
    const s = state as { t: number; done: boolean };
    this.t = s.t;
    this.done = s.done;
  }
}

export class Erasure extends BaseElement {
  /** Seconds left in this stage's count. */
  left: number;
  stage = 0;
  private lastShown = -1;
  private warned = false;
  private readonly board: THREE.Mesh;
  private readonly boardCanvas: HTMLCanvasElement;
  private readonly boardTex: THREE.CanvasTexture;
  private readonly fluid: THREE.Mesh | null = null;
  /** Times the Erasure has run out (tests). */
  erased = 0;

  constructor(ctx: ChamberContext, entity: Entity) {
    super(ctx, entity);
    this.left = this.secondsFor(0);
    this.boardCanvas = document.createElement('canvas');
    this.boardCanvas.width = 512;
    this.boardCanvas.height = 192;
    this.boardTex = new THREE.CanvasTexture(this.boardCanvas);
    this.boardTex.colorSpace = THREE.SRGBColorSpace;
    const [w, h] = this.prop<[number, number]>('boardSize', [4, 1.5]);
    this.board = this.add(new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: this.boardTex })));
    this.board.position.copy(this.origin());
    this.board.rotation.y = this.yaw();
    const moat = this.prop<[number, number, number, number] | null>('moat', null);
    if (moat) {
      const [x, z, mw, md] = moat;
      this.fluid = this.add(new THREE.Mesh(new THREE.PlaneGeometry(mw, md), new THREE.MeshLambertMaterial({ color: 0xf4f1e6, transparent: true, opacity: 0.92 })));
      this.fluid.rotation.x = -Math.PI / 2;
      this.fluid.position.set(x, this.prop('moatFloor', -2), z);
    }
    this.outputs.warning = false;
    this.draw();
  }

  private secondsFor(stage: number): number {
    const s = this.prop<number[]>('seconds', [120, 100, 80]);
    return s[Math.min(stage, s.length - 1)];
  }

  private core(): BossCore | null {
    const id = this.prop<string | null>('core', null);
    for (const el of this.ctx.elements.values()) if (el instanceof BossCore && (!id || el.id === id)) return el;
    return null;
  }

  private draw(): void {
    const g = this.boardCanvas.getContext('2d');
    if (!g) return;
    const s = Math.max(0, Math.ceil(this.left));
    this.lastShown = s;
    const running = this.input('active', false);
    g.fillStyle = '#16181b';
    g.fillRect(0, 0, 512, 192);
    g.fillStyle = s <= 15 && running ? '#ff6a3d' : '#f2efe6';
    g.font = '600 26px system-ui, sans-serif';
    g.fillText(running ? 'THE ERASURE BEGINS IN' : 'ERASURE SYSTEM ON STANDBY', 24, 44);
    g.font = '300 104px system-ui, sans-serif';
    g.fillText(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, 24, 160);
    g.font = '18px system-ui, sans-serif';
    g.fillStyle = '#9aa0a6';
    g.fillText(`STAGE ${Math.min(this.stage + 1, 3)} OF 3 · CORRECTION FLUID`, 280, 176);
    this.boardTex.needsUpdate = true;
  }

  update(dt: number): void {
    const core = this.core();
    if (core && core.outputs.defeated) {
      this.setOutput('warning', false);
      if (this.lastShown !== 0) {
        this.left = 0;
        this.draw();
      }
      return;
    }
    // A new boss stage: a fresh (shorter) count.
    if (core && core.stage !== this.stage) {
      this.stage = core.stage;
      this.left = this.secondsFor(this.stage);
      this.warned = false;
      this.ctx.sfx('erasureReset', 'The Erasure count restarts, shorter');
    }
    const running = this.input('active', false);
    if (running && !this.ctx.playerDead()) {
      this.left -= dt;
      if (this.left <= 15 && !this.warned) {
        this.warned = true;
        this.ctx.sfx('erasureWarning', 'Correction fluid sloshes in the pipes');
      }
      if (this.left <= 0) {
        this.erased++;
        this.ctx.sfx('erasure', 'The arena floods white');
        this.ctx.kill('liquid');
        this.left = this.secondsFor(this.stage);
      }
    }
    this.setOutput('warning', running && this.left <= 15);
    if (this.fluid) {
      // The fluid creeps up the moat as the count runs out (purely a warning; the count kills).
      const total = this.secondsFor(this.stage);
      const f = running ? 1 - Math.max(0, this.left) / total : 0;
      this.fluid.position.y = this.prop('moatFloor', -2) + f * this.prop('moatDepth', 1.8);
    }
    if (Math.ceil(this.left) !== this.lastShown) this.draw();
  }

  snapshot(): unknown {
    return { ...(super.snapshot() as object), left: this.left, stage: this.stage, warned: this.warned, erased: this.erased };
  }

  restore(state: unknown): void {
    super.restore(state);
    const s = state as { left: number; stage: number; warned: boolean; erased: number };
    this.left = s.left;
    this.stage = s.stage;
    this.warned = s.warned;
    this.erased = s.erased;
    this.draw();
  }

  dispose(): void {
    super.dispose();
    this.boardTex.dispose();
  }
}
