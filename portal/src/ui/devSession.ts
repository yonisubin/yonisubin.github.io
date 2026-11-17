// DEV ADAPTER (temporary): a GameSession built on what the simulation exposes today
// (window.twinfold + the GameHandle), so the shell can be developed and tested before the real
// session exists. At integration the simulation returns `handle.session` and this file is unused:
// main.ts does `sessionOf(handle)` = handle.session ?? createDevSession(handle).
//
// Limits (on purpose, it stays thin): loadChamber() can't rebuild the world, so every level plays
// in the current test room geometry (spawn, counters and events follow the given level);
// events are synthesised by polling (portal placed, footstep, teleport, idle); entities have no state.
import type { GameHandle } from '../game/game';
import { EventBus } from '../core/events';
import type { Counters, GameSession, SessionSettings, SessionSnapshot } from '../core/session';
import type { LevelData } from '../levels/level';
import { faceTag } from '../levels/level';
import { CONFIG } from '../core/config';

/* eslint-disable @typescript-eslint/no-explicit-any */
type V3 = { x: number; y: number; z: number; set(x: number, y: number, z: number): unknown; toArray(): number[] };
interface DevPortal {
  position: V3;
  normal: V3;
  up: V3;
}
interface TwinfoldApi {
  THREE: any;
  level: LevelData;
  player: { position: V3; velocity: V3; crouched: boolean; feetY(): number; height: number; rig: { yaw: number; pitch: number }; collider: unknown };
  portals: { a: DevPortal | null; b: DevPortal | null; placedCount: number; clear(): void; fire(id: 'a' | 'b', o: unknown, d: unknown, up: unknown, ex?: unknown): { ok: boolean } };
  camera: { fov: number; updateProjectionMatrix(): void };
  renderer: { recursionDepth: number };
  simulate(seconds: number): void;
  place(feet: [number, number, number], yaw?: number, velocity?: [number, number, number]): void;
  stepCount(): number;
  lastTeleport(): { from: 'a' | 'b'; to: 'a' | 'b'; speed: number } | null;
  lastFire(id: 'a' | 'b'): { ok: boolean } | null;
}

/** The real session when the simulation provides one, else the dev adapter. */
export function sessionOf(handle: GameHandle): GameSession {
  const real = (handle as GameHandle & { session?: GameSession }).session;
  return real ?? createDevSession(handle);
}

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const v3 = (v: V3): [number, number, number] => [r4(v.x), r4(v.y), r4(v.z)];

export interface DevSession extends GameSession {
  readonly dev: true;
  /** Last settings pushed (for tests: what the options menu applied). */
  readonly settings: Partial<SessionSettings>;
  readonly paused: boolean;
}

export function createDevSession(handle: GameHandle): DevSession {
  const tf = (window as unknown as { twinfold: TwinfoldApi }).twinfold;
  const events = new EventBus();
  const input = handle.input;
  let level: LevelData = tf.level;
  let checkpoint: string | null = null;
  let paused = false;
  const settings: Partial<SessionSettings> = {};
  let portalBase = tf.portals.placedCount;
  let stepBase = tf.stepCount();
  let time = 0;
  let seenSteps = tf.stepCount();
  let seenTeleport = tf.lastTeleport();
  const seenFire: Record<'a' | 'b', unknown> = { a: tf.lastFire('a'), b: tf.lastFire('b') };
  let lastMove = 0;
  let lastPos = [0, 0, 0];
  let idleSent = 0;
  let oobSent = false;

  const surfaceUnder = (): 'panel' | 'metal' | 'glass' | 'other' => {
    const p = tf.player.position;
    const fy = tf.player.feetY();
    for (const b of tf.level.brushes) {
      if (p.x < b.min[0] || p.x > b.max[0] || p.z < b.min[2] || p.z > b.max[2] || Math.abs(b.max[1] - fy) > 0.08) continue;
      const t = faceTag(b, '+y');
      return t === 'portalable' ? 'panel' : t;
    }
    return 'other';
  };

  /** Turn simulation state changes into bus events. */
  function pump(): void {
    for (const id of ['a', 'b'] as const) {
      const f = tf.lastFire(id);
      if (f && f !== seenFire[id]) {
        seenFire[id] = f;
        events.emit('portalPlaced', { id, ok: f.ok });
      }
    }
    const steps = tf.stepCount();
    if (steps > seenSteps) events.emit('footstep', { surface: surfaceUnder() });
    seenSteps = steps;
    const tp = tf.lastTeleport();
    if (tp && tp !== seenTeleport) events.emit('teleport', { from: tp.from, to: tp.to, speed: tp.speed });
    seenTeleport = tp;
    const p = tf.player.position;
    if (Math.hypot(p.x - lastPos[0], p.y - lastPos[1], p.z - lastPos[2]) > 0.05) {
      lastPos = [p.x, p.y, p.z];
      lastMove = time;
      idleSent = 0;
    } else if (time - lastMove > 30 * (idleSent + 1)) {
      idleSent++;
      events.emit('idle', { seconds: Math.round(time - lastMove) });
    }
    if (!oobSent && tf.player.feetY() < -30) {
      oobSent = true;
      events.emit('outOfBounds', {});
    }
  }

  // Count simulated time both from scripted steps (tests) and from the running loop.
  const origSimulate = tf.simulate.bind(tf);
  tf.simulate = (seconds: number) => {
    origSimulate(seconds);
    time += seconds;
    pump();
  };
  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    if (!paused) time += dt;
    pump();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // There is no elevator yet: the ride "ends" a moment after the exit is reached.
  events.on('exitReached', ({ chamberId }) => {
    setTimeout(() => events.emit('elevatorDone', { chamberId, next: level.next }), 1500);
  });

  function spawnAt(pos: [number, number, number], yaw: number): void {
    tf.portals.clear();
    tf.place(pos, yaw);
  }

  function resetCounters(): void {
    portalBase = tf.portals.placedCount;
    stepBase = tf.stepCount();
    time = 0;
    lastMove = 0;
    oobSent = false;
  }

  const session: DevSession = {
    dev: true,
    events,
    settings,
    get paused() {
      return paused;
    },
    loadChamber(l, opts) {
      level = l;
      checkpoint = opts?.checkpoint ?? null;
      const cp = checkpoint ? l.checkpoints?.find((c) => c.id === checkpoint) : null;
      const sp = cp ? cp.spawn : l.spawn;
      spawnAt(sp.position, sp.yaw);
      resetCounters();
      events.emit('chamberStart', { chamberId: l.id ?? 'custom' });
      events.emit('autosave', { reason: 'chamberStart' });
    },
    current: () => level,
    restartChamber() {
      checkpoint = null;
      spawnAt(level.spawn.position, level.spawn.yaw);
      resetCounters();
      events.emit('chamberStart', { chamberId: level.id ?? 'custom' });
    },
    respawn() {
      const cp = checkpoint ? level.checkpoints?.find((c) => c.id === checkpoint) : null;
      const sp = cp ? cp.spawn : level.spawn;
      spawnAt(sp.position, sp.yaw);
      events.emit('respawn', {});
    },
    snapshot(): SessionSnapshot {
      const P = tf.player;
      const portal = (p: DevPortal | null) => (p ? { position: v3(p.position), normal: v3(p.normal), up: v3(p.up) } : null);
      return {
        version: 1,
        chamberId: level.id ?? 'custom',
        checkpoint,
        counters: session.counters(),
        player: {
          position: [r4(P.position.x), r4(P.feetY()), r4(P.position.z)],
          velocity: v3(P.velocity),
          yaw: r4(P.rig.yaw),
          pitch: r4(P.rig.pitch),
          crouched: P.crouched,
          health: 100,
        },
        portals: { a: portal(tf.portals.a), b: portal(tf.portals.b) },
        entities: {},
      };
    },
    restore(s, l) {
      level = l;
      checkpoint = s.checkpoint;
      const P = tf.player;
      tf.place(s.player.position, s.player.yaw, s.player.velocity);
      // place() lifts the capsule 1 cm off the floor; put it back exactly where it was.
      P.position.y = s.player.position[1] + P.height / 2;
      P.rig.pitch = s.player.pitch;
      tf.portals.clear();
      const T = tf.THREE;
      for (const id of ['a', 'b'] as const) {
        const p = s.portals[id] as { position: number[]; normal: number[]; up: number[] } | null;
        if (!p) continue;
        const n = new T.Vector3(...p.normal);
        const origin = new T.Vector3(...p.position).addScaledVector(n, 0.3);
        tf.portals.fire(id, origin, n.clone().negate(), new T.Vector3(...p.up), P.collider);
      }
      portalBase = tf.portals.placedCount - s.counters.portals;
      stepBase = tf.stepCount() - s.counters.steps;
      time = s.counters.time;
    },
    counters(): Counters {
      return { portals: tf.portals.placedCount - portalBase, steps: tf.stepCount() - stepBase, time: r4(time) };
    },
    setPaused(p) {
      paused = p;
      input.enabled = !p;
      if (p) input.exitLock();
    },
    applySettings(s) {
      Object.assign(settings, s);
      if (s.fov !== undefined) {
        tf.camera.fov = s.fov;
        tf.camera.updateProjectionMatrix();
      }
      if (s.recursionDepth !== undefined) tf.renderer.recursionDepth = s.recursionDepth;
      if (s.mouseSensitivity !== undefined) input.lookScale = s.mouseSensitivity / CONFIG.camera.mouseSensitivity;
      if (s.invertY !== undefined) input.invertY = s.invertY;
      if (s.toggleCrouch !== undefined) input.toggleCrouch = s.toggleCrouch;
    },
  };
  return session;
}
