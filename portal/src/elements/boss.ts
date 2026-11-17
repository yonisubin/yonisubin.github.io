// Boss stubs for wave 2 (the finale is built on these hooks):
//   bossCore  the overseer's body. It can't be shot; a rocket that hits it counts as a hit: `boss`
//             { event: 'hit' }, then a component detaches (a sphere prop flagged bossPart) and
//             falls: `componentDetached`. Further hits are ignored until that part is disposed.
//             props.stages (default 3). Outputs: exposed (a part is waiting), defeated.
//   disposal  a box (props.size) that destroys boss parts dropped into it: `componentDisposed`; after
//             the last stage the core emits `defeated`. props.core: the bossCore id (default: first).
// The core also outputs stage1 / stage2 / stage3 (on once that many parts are disposed), which the
// finale wires to its shifting panels and doors; when defeated its shell goes dark and it sags.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../core/config';
import type { ChamberContext } from '../game/context';
import type { Entity } from '../levels/level';
import { MAT } from '../render/models';
import { BaseElement } from './base';
import { PhysProp } from './prop';

export class BossCore extends BaseElement {
  stage = 0;
  pending: string | null = null;
  hits = 0;
  private readonly shell: THREE.Mesh;

  constructor(ctx: ChamberContext, entity: Entity) {
    super(ctx, entity);
    const r = this.radius();
    this.shell = this.add(new THREE.Mesh(new THREE.IcosahedronGeometry(r, 2), new THREE.MeshLambertMaterial({ color: 0xdfe2e5, flatShading: true })));
    this.shell.position.copy(this.origin());
    const eye = this.add(new THREE.Mesh(new THREE.CircleGeometry(r * 0.25, 24), MAT.red()));
    eye.position.copy(this.origin()).add(new THREE.Vector3(0, 0, r * 1.01).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw()));
    eye.rotation.y = this.yaw();
    const c = ctx.physics.world.createCollider(RAPIER.ColliderDesc.ball(r).setTranslation(...this.entity.position));
    ctx.physics.register(c, { kind: 'solid', owner: this.id, tag: 'metal' });
    this.colliders.push(c);
    this.outputs.exposed = false;
    this.outputs.defeated = false;
    for (let i = 1; i <= 3; i++) this.outputs[`stage${i}`] = false;
  }

  private stageOutputs(): void {
    for (let i = 1; i <= 3; i++) this.setOutput(`stage${i}`, this.stage >= i);
  }

  private sag = 0;

  update(dt: number): void {
    // Defeated: the shell darkens and the core sags a little on its mount.
    if (!this.outputs.defeated || this.sag >= 1) return;
    this.sag = Math.min(1, this.sag + dt / 2);
    const m = this.shell.material as THREE.MeshLambertMaterial;
    m.color.setHex(0xdfe2e5).lerp(new THREE.Color(0x3a3d42), this.sag);
    this.shell.position.copy(this.origin()).add(new THREE.Vector3(0, -0.6 * this.sag, 0));
    this.shell.rotation.z = 0.35 * this.sag;
  }

  private radius(): number {
    return this.prop('radius', 1.5);
  }

  private stages(): number {
    return this.prop('stages', CONFIG.boss.stages);
  }

  /** A rocket hit the core. */
  rocketHit(): void {
    if (this.pending || this.outputs.defeated) return;
    this.hits++;
    this.ctx.events.emit('boss', { stage: this.stage, event: 'hit' });
    this.ctx.sfx('bossHit', 'The core shudders');
    this.detach();
  }

  private detach(): void {
    const id = `${this.id}-part${this.stage + 1}`;
    const r = this.radius();
    const at = this.origin().add(new THREE.Vector3(0, -r - 0.6, 0).add(new THREE.Vector3(0, 0, r * 0.6).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw())));
    this.ctx.spawn({ id, type: 'sphere', position: [at.x, at.y, at.z], props: { bossPart: true, core: this.id } });
    this.pending = id;
    this.setOutput('exposed', true);
    this.ctx.events.emit('boss', { stage: this.stage, event: 'componentDetached' });
  }

  /** A part of this core went into a disposal unit. */
  partDisposed(id: string): void {
    if (id !== this.pending) return;
    this.pending = null;
    this.setOutput('exposed', false);
    this.ctx.events.emit('boss', { stage: this.stage, event: 'componentDisposed' });
    this.stage++;
    this.stageOutputs();
    if (this.stage >= this.stages()) {
      this.setOutput('defeated', true);
      this.ctx.events.emit('boss', { stage: this.stage, event: 'defeated' });
    }
  }

  snapshot(): unknown {
    return { ...(super.snapshot() as object), stage: this.stage, pending: this.pending, hits: this.hits };
  }

  restore(state: unknown): void {
    super.restore(state);
    const s = state as { stage: number; pending: string | null; hits: number };
    this.stage = s.stage;
    this.hits = s.hits;
    this.pending = s.pending;
    this.stageOutputs();
    // A detached part is its own (runtime) entity: recreate it; its saved state is applied next.
    if (s.pending && !this.ctx.elements.has(s.pending)) {
      const o = this.origin();
      this.ctx.spawn({ id: s.pending, type: 'sphere', position: [o.x, o.y, o.z], props: { bossPart: true, core: this.id } });
    }
  }
}

export class Disposal extends BaseElement {
  constructor(ctx: ChamberContext, entity: Entity) {
    super(ctx, entity);
    const [x, y, z] = this.size();
    const o = this.origin();
    const rim = this.add(new THREE.Mesh(new THREE.BoxGeometry(x + 0.3, 0.15, z + 0.3), MAT.dark()));
    rim.position.set(o.x, o.y + y / 2, o.z);
    const glow = this.add(new THREE.Mesh(new THREE.PlaneGeometry(x, z), new THREE.MeshBasicMaterial({ color: 0xff6a2a })));
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(o.x, o.y - y / 2 + 0.02, o.z);
  }

  private size(): [number, number, number] {
    return this.prop<[number, number, number]>('size', [1.5, 1.5, 1.5]);
  }

  update(): void {
    const [x, y, z] = this.size();
    const o = this.origin();
    for (const el of [...this.ctx.elements.values()]) {
      if (!(el instanceof PhysProp) || !el.alive || !el.body || !el.entity.props?.bossPart) continue;
      const p = el.position();
      if (Math.abs(p.x - o.x) > x / 2 || Math.abs(p.y - o.y) > y / 2 || Math.abs(p.z - o.z) > z / 2) continue;
      el.dissolve();
      const coreId = (el.entity.props.core as string | undefined) ?? this.prop<string | null>('core', null);
      const core = [...this.ctx.elements.values()].find((e) => e instanceof BossCore && (!coreId || e.id === coreId)) as BossCore | undefined;
      core?.partDisposed(el.id);
    }
  }
}
