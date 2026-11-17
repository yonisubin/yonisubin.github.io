// The GameSession implementation (contract: core/session.ts). Owns the loaded Chamber and the
// fixed-step game logic around the player: device shots (with the level's device limits), Use,
// restart, death → respawn at the last autosave, autosaves at chamber start and checkpoints,
// snapshot / restore, pause and settings.
import * as THREE from 'three';
import { CONFIG, STEP_DT, type PortalId } from '../core/config';
import { EventBus } from '../core/events';
import type { Counters, GameSession, SessionSettings, SessionSnapshot } from '../core/session';
import type { Input } from '../input/input';
import type { Checkpoint, LevelData } from '../levels/level';
import type { Physics } from '../physics/world';
import type { PlaceResult, PortalState, PortalSystem } from '../portals/portals';
import type { Player, TeleportEvent } from '../player/controller';
import type { Effects } from '../render/effects';
import { Chamber, type ChamberState } from './chamber';
import type { RuntimeSettings } from './context';

/** What the session needs from the renderer side (game.ts) to apply video settings. */
export interface SessionView {
  setFov(deg: number): void;
  setRenderScale(scale: number): void;
  setRecursionDepth(n: number): void;
  setPortalColors(c: { a: number; b: number }): void;
  /** A shot failed: show the fizzle burst. */
  fizzle(point: THREE.Vector3, normal: THREE.Vector3, id: PortalId): void;
  /** Synthesised sounds the simulation already plays itself. */
  sound: { portalOpen(id: PortalId): void; fizzle(): void; pass(speed: number): void; land(speed: number): void };
}

export interface SessionDeps {
  physics: Physics;
  portals: PortalSystem;
  player: Player;
  input: Input;
  scene: THREE.Scene;
  effects: Effects;
  view: SessionView;
}

const HELD = ['forward', 'back', 'left', 'right', 'jump', 'crouch'] as const;

export class Session implements GameSession {
  readonly events = new EventBus();
  readonly settings: RuntimeSettings = {
    portalColors: { ...CONFIG.portal.colors },
    assist: false,
    reduceFlashing: false,
    highContrastHazards: false,
  };
  chamber: Chamber | null = null;
  private level: LevelData | null = null;
  private paused = false;
  private checkpoint: string | null = null;
  /** Last autosave (respawn point): taken at chamber start and at checkpoints. */
  autosave: SessionSnapshot | null = null;
  /** Mouse moved since the last step (idle detection). */
  private activity = false;
  lastTeleport: TeleportEvent | null = null;
  readonly lastFire: Record<PortalId, PlaceResult | null> = { a: null, b: null };

  constructor(private readonly deps: SessionDeps) {}

  // --- GameSession ------------------------------------------------------------------------------
  loadChamber(level: LevelData, opts?: { checkpoint?: string | null }): void {
    this.build(level, opts?.checkpoint ?? null);
    this.events.emit('chamberStart', { chamberId: this.chamber!.chamberId() });
    this.save(this.checkpoint ? 'checkpoint' : 'chamberStart');
  }

  current(): LevelData | null {
    return this.level;
  }

  restartChamber(): void {
    if (this.level) this.loadChamber(this.level);
  }

  respawn(): void {
    if (!this.level) return;
    if (this.autosave) this.apply(this.autosave, this.level);
    else this.build(this.level, null);
    this.events.emit('respawn', {});
  }

  snapshot(): SessionSnapshot {
    const c = this.chamber;
    if (!c) throw new Error('no chamber loaded');
    const pl = this.deps.player;
    const entities: Record<string, unknown> = {};
    for (const [id, el] of c.elements) entities[id] = el.snapshot();
    entities['#chamber'] = c.snapshotState();
    const s: SessionSnapshot = {
      version: 1,
      chamberId: c.chamberId(),
      checkpoint: this.checkpoint,
      counters: c.counters(),
      player: {
        position: [pl.position.x, pl.position.y, pl.position.z],
        velocity: [pl.velocity.x, pl.velocity.y, pl.velocity.z],
        yaw: pl.rig.yaw,
        pitch: pl.rig.pitch,
        crouched: pl.crouched,
        health: c.health,
      },
      portals: { a: this.deps.portals.snapshot('a'), b: this.deps.portals.snapshot('b') },
      entities,
    };
    // Plain JSON, detached from live objects.
    return JSON.parse(JSON.stringify(s)) as SessionSnapshot;
  }

  restore(s: SessionSnapshot, level: LevelData): void {
    this.apply(s, level);
  }

  counters(): Counters {
    return this.chamber?.counters() ?? { portals: 0, steps: 0, time: 0 };
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.deps.input.clearPressed();
  }

  isPaused(): boolean {
    return this.paused;
  }

  applySettings(s: Partial<SessionSettings>): void {
    const { player, view, portals, effects } = this.deps;
    if (s.fov !== undefined) view.setFov(THREE.MathUtils.clamp(s.fov, 60, 120));
    // Either radians per pixel (small numbers) or a multiplier of the default (around 1).
    if (s.mouseSensitivity !== undefined) player.rig.sensitivity = s.mouseSensitivity < 0.05 ? s.mouseSensitivity : CONFIG.camera.mouseSensitivity * s.mouseSensitivity;
    if (s.invertY !== undefined) player.rig.invertY = s.invertY;
    if (s.renderScale !== undefined) view.setRenderScale(THREE.MathUtils.clamp(s.renderScale, 0.25, 2));
    if (s.recursionDepth !== undefined) view.setRecursionDepth(Math.max(0, Math.round(s.recursionDepth)));
    if (s.portalColors) {
      this.settings.portalColors = { ...s.portalColors };
      view.setPortalColors(this.settings.portalColors);
    }
    if (s.reduceRoll !== undefined) player.rig.reduceRoll = s.reduceRoll;
    if (s.reduceFlashing !== undefined) this.settings.reduceFlashing = effects.reduceFlashing = s.reduceFlashing;
    if (s.highContrastHazards !== undefined) this.settings.highContrastHazards = s.highContrastHazards;
    if (s.assist !== undefined) {
      this.settings.assist = s.assist;
      portals.nudgeMax = s.assist ? CONFIG.assist.nudgeMax : CONFIG.portal.nudgeMax;
    }
    if (s.toggleCrouch !== undefined) player.toggleCrouch = s.toggleCrouch;
  }

  // --- Internals ----------------------------------------------------------------------------------
  /** Throw the current chamber away and build `level` (no events). */
  private build(level: LevelData, checkpoint: string | null): void {
    const { physics, portals, player, scene, effects } = this.deps;
    this.chamber?.dispose();
    this.chamber = null;
    portals.reset();
    physics.reset();
    player.attach();
    effects.clear();
    this.level = level;
    this.checkpoint = checkpoint && level.checkpoints?.some((c) => c.id === checkpoint) ? checkpoint : null;
    this.lastTeleport = null;
    this.lastFire.a = this.lastFire.b = null;
    this.chamber = new Chamber(
      level,
      {
        physics,
        portals,
        player,
        events: this.events,
        effects,
        settings: this.settings,
        scene,
        onCheckpoint: (c: Checkpoint) => {
          this.checkpoint = c.id;
          this.events.emit('checkpoint', { id: c.id });
          this.save('checkpoint');
        },
      },
      this.checkpoint,
    );
  }

  private save(reason: 'chamberStart' | 'checkpoint'): void {
    this.autosave = this.snapshot();
    this.events.emit('autosave', { reason });
  }

  private apply(s: SessionSnapshot, level: LevelData): void {
    this.build(level, s.checkpoint);
    const c = this.chamber!;
    const { player, portals } = this.deps;
    for (const [id, state] of Object.entries(s.entities)) {
      if (id.startsWith('#')) continue;
      c.elements.get(id)?.restore(state);
    }
    for (const id of ['a', 'b'] as const) {
      const p = s.portals[id] as PortalState | null;
      if (p) portals.placeAt(id, new THREE.Vector3(...p.position), new THREE.Quaternion(...p.quaternion), p.fixed);
      else portals.remove(id);
    }
    player.forceCrouch(s.player.crouched);
    player.position.set(...s.player.position);
    player.velocity.set(...s.player.velocity);
    player.setView(s.player.yaw, s.player.pitch);
    player.forceCrouch(s.player.crouched);
    player.grounded = false;
    const cs = s.entities['#chamber'] as ChamberState | undefined;
    if (cs) c.restoreState(cs);
    c.health = s.player.health;
    this.checkpoint = s.checkpoint;
    c.wiring.sync();
  }

  /** The mouse moved (not idle). */
  noteActivity(): void {
    this.activity = true;
  }

  /** Fire the device (respecting level.device). */
  fire(id: PortalId, origin?: THREE.Vector3, dir?: THREE.Vector3): PlaceResult {
    const { player, portals, view } = this.deps;
    const device = this.level?.device ?? 'both';
    if (device === 'none' || (device === 'a' && id === 'b')) {
      const r: PlaceResult = { ok: false, reason: 'device' };
      this.lastFire[id] = r;
      return r;
    }
    const o = origin ?? player.eye();
    const d = (dir ?? player.rig.forward()).clone().normalize();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(player.rig.orientation());
    const r = portals.fire(id, o, d, up, player.collider);
    this.lastFire[id] = r;
    if (r.ok) {
      if (this.chamber) this.chamber.portalCount++;
      view.sound.portalOpen(id);
    } else {
      view.sound.fizzle();
      if (r.point && r.normal) view.fizzle(r.point, r.normal, id);
    }
    this.events.emit('portalPlaced', { id, ok: r.ok });
    return r;
  }

  /** Slow motion for the assist: airborne and fast after a portal pass. */
  timeScale(): number {
    const p = this.deps.player;
    if (!this.settings.assist || p.grounded || !this.lastTeleport) return 1;
    return p.velocity.length() > CONFIG.assist.flingSpeed ? CONFIG.assist.timeScale : 1;
  }

  /** One fixed 60 Hz step of the whole game. */
  fixedStep(): void {
    const c = this.chamber;
    const { input, player } = this.deps;
    if (this.paused || !c) return;
    const dt = STEP_DT;
    if (c.dead) {
      input.clearPressed();
      c.deadTimer -= dt;
      if (c.deadTimer <= 0) this.respawn();
      return;
    }
    let active = this.activity;
    this.activity = false;
    if (input.consume('fireA')) {
      active = true;
      this.fire('a');
    }
    if (input.consume('fireB')) {
      active = true;
      this.fire('b');
    }
    if (input.consume('use')) {
      active = true;
      c.use();
    }
    if (input.consume('restart')) {
      this.restartChamber();
      return;
    }
    if (HELD.some((a) => input.isHeld(a))) active = true;

    c.stepWorld(dt);
    if (this.chamber !== c) return;
    const before = player.position.clone();
    const fallSpeed = -player.velocity.y;
    const wasGrounded = player.grounded;
    const tp = player.step(dt, input);
    if (tp) {
      this.lastTeleport = tp;
      this.deps.view.sound.pass(tp.speed);
      this.events.emit('teleport', { from: tp.from, to: tp.to, speed: tp.speed });
    }
    if (player.grounded && !wasGrounded && fallSpeed > 3) this.deps.view.sound.land(fallSpeed);
    c.afterPlayer(dt, before, fallSpeed, tp, active);
  }
}
