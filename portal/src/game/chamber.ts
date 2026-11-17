// One loaded chamber: builds everything from LevelData (brush colliders and meshes, elements,
// wiring, triggers, checkpoints), runs the per-step simulation that isn't the player controller
// itself (carrying, elements, rigid bodies, props through portals, hazards, health, counters,
// footsteps, idle / out-of-bounds / prompt events), and disposes all of it on unload.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../core/config';
import type { EventBus } from '../core/events';
import type { Counters } from '../core/session';
import { disposeObject, isRenderable, isUsable } from '../elements/base';
import type { Element } from '../elements/element';
import { PhysProp } from '../elements/prop';
import { createElement } from '../elements/registry';
import { Turret } from '../elements/turret';
import type { Checkpoint, Entity, LevelData, Trigger } from '../levels/level';
import { Triggers, type TriggerState } from '../logic/triggers';
import { Wiring } from '../logic/wiring';
import type { Physics } from '../physics/world';
import type { PortalSystem } from '../portals/portals';
import { Carry } from '../player/carry';
import type { Player, TeleportEvent } from '../player/controller';
import type { Effects } from '../render/effects';
import { buildLevelMeshes } from '../render/levelMeshes';
import type { ChamberContext, DeathCause, RuntimeSettings } from './context';

export interface ChamberDeps {
  physics: Physics;
  portals: PortalSystem;
  player: Player;
  events: EventBus;
  effects: Effects;
  settings: RuntimeSettings;
  scene: THREE.Scene;
  /** A checkpoint was reached (the session autosaves). */
  onCheckpoint(c: Checkpoint): void;
}

/** Chamber-wide state kept in a snapshot (under the reserved entity key "#chamber"). */
export interface ChamberState {
  t: number;
  health: number;
  sinceDamage: number;
  rng: number;
  steps: number;
  portals: number;
  exited: boolean;
  exitTime: number;
  stepDistance: number;
  idle: number;
  idleCount: number;
  oob: boolean;
  triggers: TriggerState;
  held: { id: string; holdM: number[]; yawOffset: number } | null;
}

export class Chamber implements ChamberContext {
  readonly elements = new Map<string, Element>();
  readonly group = new THREE.Group();
  readonly carry: Carry;
  readonly wiring: Wiring;
  readonly triggers: Triggers;
  readonly physics: Physics;
  readonly portals: PortalSystem;
  readonly player: Player;
  readonly events: EventBus;
  readonly effects: Effects;
  readonly settings: RuntimeSettings;

  health: number = CONFIG.health.max;
  private sinceDamage = Infinity;
  dead = false;
  deadTimer = 0;
  t = 0;
  exited = false;
  private exitTime = 0;
  private steps = 0;
  /** Portals placed by the device in this chamber. */
  portalCount = 0;
  private rng = 1;
  private stepDistance = 0;
  private wasGrounded = true;
  private idle = 0;
  private idleCount = 0;
  private oob = false;
  private promptText: string | null = null;
  private readonly bounds = new THREE.Box3();
  private readonly killY: number;
  private readonly levelMaterials: THREE.Material[];

  constructor(
    readonly level: LevelData,
    deps: ChamberDeps,
    startCheckpoint: string | null,
  ) {
    this.physics = deps.physics;
    this.portals = deps.portals;
    this.player = deps.player;
    this.events = deps.events;
    this.effects = deps.effects;
    this.settings = deps.settings;
    this.rng = hashString(this.chamberId()) || 1;

    // World: brushes (colliders + meshes).
    this.physics.loadLevel(level);
    const visuals = buildLevelMeshes(level);
    this.levelMaterials = visuals.materials;
    this.group.add(visuals.group);
    deps.scene.add(this.group);
    for (const b of level.brushes) this.bounds.expandByPoint(new THREE.Vector3(...b.min)).expandByPoint(new THREE.Vector3(...b.max));
    this.killY = (level.brushes.length ? Math.min(...level.brushes.map((b) => b.min[1])) : 0) - CONFIG.session.pitDepth;

    // Player at the spawn (or a checkpoint).
    const cp = startCheckpoint ? level.checkpoints?.find((c) => c.id === startCheckpoint) : undefined;
    const spawn = cp?.spawn ?? level.spawn;
    this.player.spawn(new THREE.Vector3(...spawn.position), spawn.yaw);

    this.carry = new Carry(this.player, (p, forced) => {
      this.events.emit('drop', { id: p.id });
      if (forced) this.events.emit('sfx', { name: 'drop' });
    });

    // Elements, then the wiring between them.
    for (const e of level.entities ?? []) this.elements.set(e.id, createElement(this, e));
    // One settling step so every new collider is visible to scene queries.
    this.physics.world.step();
    this.wiring = new Wiring(this.elements, level.wiring ?? []);
    this.wiring.init();

    this.triggers = new Triggers(
      level.triggers ?? [],
      level.checkpoints ?? [],
      (t: Trigger) => {
        this.events.emit('trigger', { name: t.event });
        if (t.event === 'outOfBounds') this.events.emit('outOfBounds', {});
      },
      (c: Checkpoint) => deps.onCheckpoint(c),
    );
    if (cp) this.triggers.markReached(cp.id);
  }

  // --- ChamberContext -------------------------------------------------------------------------
  time(): number {
    return this.t;
  }

  chamberId(): string {
    return this.level.id ?? this.level.name;
  }

  outputChanged(el: Element): void {
    this.wiring?.changed(el);
  }

  hurt(amount: number, cause: DeathCause): void {
    if (this.dead || this.exited) return;
    this.health = Math.max(0, this.health - amount);
    this.sinceDamage = 0;
    this.events.emit('damage', { amount, health: this.health });
    if (this.health <= 0) this.kill(cause);
  }

  kill(cause: DeathCause): void {
    if (this.dead || this.exited) return;
    this.dead = true;
    this.health = 0;
    this.deadTimer = CONFIG.health.respawnDelay;
    this.carry.drop(true);
    this.setPrompt(null);
    this.events.emit('death', { cause });
  }

  playerDead(): boolean {
    return this.dead;
  }

  heldId(): string | null {
    return this.carry.held?.id ?? null;
  }

  forceDrop(): void {
    this.carry.drop(true);
  }

  sfx(name: string, caption?: string): void {
    this.events.emit('sfx', caption ? { name, caption } : { name });
  }

  reachExit(): void {
    if (this.exited) return;
    this.exited = true;
    this.exitTime = this.t;
    this.carry.drop();
    const c = this.counters();
    this.events.emit('exitReached', { chamberId: this.chamberId(), portals: c.portals, steps: c.steps, time: c.time });
  }

  random(): number {
    // mulberry32: small, fast, and its whole state is one saved integer.
    let x = (this.rng = (this.rng + 0x6d2b79f5) | 0);
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  }

  spawn(entity: Entity): Element {
    this.elements.get(entity.id)?.dispose();
    const el = createElement(this, entity);
    this.elements.set(entity.id, el);
    return el;
  }

  counters(): Counters {
    return { portals: this.portalCount, steps: this.steps, time: this.exited ? this.exitTime : this.t };
  }

  // --- Per step ---------------------------------------------------------------------------------
  props(): PhysProp[] {
    return [...this.elements.values()].filter((e): e is PhysProp => e instanceof PhysProp);
  }

  /** Before the player moves: carrying, elements, the rigid-body step, props through portals. */
  stepWorld(dt: number): void {
    this.carry.update();
    const props = this.props();
    for (const p of props) p.preStep();
    for (const el of [...this.elements.values()]) el.update(dt);
    this.physics.step();
    for (const p of props) p.postStep();
  }

  /** After the player moved. */
  afterPlayer(dt: number, before: THREE.Vector3, fallSpeed: number, tp: TeleportEvent | null, active: boolean): void {
    const pl = this.player;
    if (tp) this.carry.onPlayerTeleport(tp.matrix);
    if (!this.exited) this.t += dt;

    // Health regenerates a while after the last hit.
    this.sinceDamage += dt;
    if (this.sinceDamage >= CONFIG.health.regenDelay) this.health = Math.min(CONFIG.health.max, this.health + CONFIG.health.regenRate * dt);

    // Footsteps (counted for the least-steps challenge) and landing thumps.
    if (pl.grounded) {
      if (!tp) this.stepDistance += Math.hypot(pl.position.x - before.x, pl.position.z - before.z);
      if (this.stepDistance > CONFIG.session.stepLength) {
        this.stepDistance = 0;
        if (!this.exited) this.steps++;
        this.events.emit('footstep', { surface: pl.groundSurface });
      }
      if (!this.wasGrounded && fallSpeed > 3) this.sfx('land');
    }
    this.wasGrounded = pl.grounded;

    // Bottomless pits.
    if (pl.feetY() < this.killY) this.kill('pit');

    // Trigger volumes / checkpoints.
    if (!this.dead) this.triggers.update(pl.position);

    // Out of bounds: outside the chamber's box, or inside a brush (behind the panels).
    const m = CONFIG.session.boundsMargin;
    const p = pl.position;
    const outside = p.x < this.bounds.min.x - m || p.x > this.bounds.max.x + m || p.z < this.bounds.min.z - m || p.z > this.bounds.max.z + m || p.y > this.bounds.max.y + m;
    const inside = !outside && this.level.brushes.some((b) => p.x > b.min[0] + m && p.x < b.max[0] - m && p.y > b.min[1] + m && p.y < b.max[1] - m && p.z > b.min[2] + m && p.z < b.max[2] - m);
    const oob = outside || inside;
    if (oob && !this.oob) this.events.emit('outOfBounds', {});
    this.oob = oob;

    // Idle nags.
    if (active) {
      this.idle = 0;
      this.idleCount = 0;
    } else {
      this.idle += dt;
      if (this.idle >= CONFIG.session.idleSeconds * (this.idleCount + 1)) {
        this.idleCount++;
        this.events.emit('idle', { seconds: Math.round(this.idle) });
      }
    }

    this.updatePrompt();
  }

  /** What the crosshair is on, within use range (a prop, a usable element), or null. */
  useTarget(): Element | null {
    const eye = this.player.eye();
    const dir = this.player.rig.forward();
    const physics = this.physics;
    const hit = physics.world.castRay(new RAPIER.Ray(eye, dir), CONFIG.carry.useRange, true, undefined, undefined, this.player.collider, undefined, (c) => {
      const i = physics.infoOf(c);
      if (!i || i.kind === 'tunnel' || i.kind === 'clone') return false;
      if (i.kind === 'prop') return !i.prop.held;
      if (i.kind === 'brush' || i.kind === 'solid') return !this.player.maskedPortals().some((p) => p.surface === c.handle);
      return false;
    });
    if (!hit) return null;
    const i = physics.infoOf(hit.collider);
    if (i?.kind === 'prop') return this.elements.get(i.prop.id) ?? null;
    if (i?.kind === 'solid') {
      const el = this.elements.get(i.owner);
      return el && isUsable(el) ? el : null;
    }
    return null;
  }

  private setPrompt(text: string | null): void {
    if (text === this.promptText) return;
    this.promptText = text;
    this.events.emit('prompt', { text });
  }

  private updatePrompt(): void {
    if (this.dead || this.exited) return this.setPrompt(null);
    if (this.carry.held) return this.setPrompt('E  drop');
    const t = this.useTarget();
    this.setPrompt(t && isUsable(t) ? t.useText() : null);
  }

  /** The Use key. */
  use(): void {
    if (this.dead || this.exited) return;
    if (this.carry.held) {
      this.carry.drop();
      return;
    }
    const t = this.useTarget();
    if (t instanceof PhysProp) {
      if (!t.alive) return;
      if (t instanceof Turret) t.onPickup(this.player.position);
      this.carry.pickup(t);
      this.events.emit('pickup', { id: t.id });
      this.sfx('pickup');
    } else if (t && isUsable(t)) t.use();
  }

  render(alpha: number, dt: number): void {
    for (const el of this.elements.values()) if (isRenderable(el)) el.render(alpha, dt);
  }

  // --- Saves --------------------------------------------------------------------------------------
  snapshotState(): ChamberState {
    const held = this.carry.held;
    return {
      t: this.t,
      health: this.health,
      sinceDamage: Number.isFinite(this.sinceDamage) ? this.sinceDamage : -1,
      rng: this.rng,
      steps: this.steps,
      portals: this.portalCount,
      exited: this.exited,
      exitTime: this.exitTime,
      stepDistance: this.stepDistance,
      idle: this.idle,
      idleCount: this.idleCount,
      oob: this.oob,
      triggers: this.triggers.snapshot(),
      held: held ? { id: held.id, holdM: [...this.carry.holdM.elements], yawOffset: this.carry.yawOffsetValue() } : null,
    };
  }

  restoreState(s: ChamberState): void {
    this.t = s.t;
    this.health = s.health;
    this.sinceDamage = s.sinceDamage < 0 ? Infinity : s.sinceDamage;
    this.rng = s.rng;
    this.steps = s.steps;
    this.portalCount = s.portals;
    this.exited = s.exited;
    this.exitTime = s.exitTime;
    this.stepDistance = s.stepDistance;
    this.idle = s.idle;
    this.idleCount = s.idleCount;
    this.oob = s.oob;
    this.triggers.restore(s.triggers);
    if (s.held) {
      const el = this.elements.get(s.held.id);
      if (el instanceof PhysProp && el.body) {
        this.carry.pickup(el);
        this.carry.holdM.fromArray(s.held.holdM);
        this.carry.setYawOffset(s.held.yawOffset);
      }
    }
  }

  /** Remove everything this chamber created (meshes, materials, colliders via the elements). */
  dispose(): void {
    this.carry.drop();
    for (const el of this.elements.values()) el.dispose();
    this.elements.clear();
    this.group.removeFromParent();
    disposeObject(this.group);
    for (const m of this.levelMaterials) m.dispose();
  }

}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h | 0;
}
