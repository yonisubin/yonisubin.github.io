// GameSession: what the shell (menus, saves, editor test-play, challenges) may ask of the running
// simulation. Part of the CONTRACT: the simulation side (game/) implements it; the shell only calls it.
import type { LevelData } from '../levels/level';
import type { EventBus } from './events';

export interface Counters {
  /** Portals successfully placed since the chamber started. */
  portals: number;
  /** Footsteps since the chamber started. */
  steps: number;
  /** Seconds of simulated time since the chamber started (not counting pauses). */
  time: number;
}

/** Everything needed to resume exactly where the player was. Plain JSON. */
export interface SessionSnapshot {
  version: 1;
  chamberId: string;
  checkpoint: string | null;
  counters: Counters;
  player: { position: [number, number, number]; velocity: [number, number, number]; yaw: number; pitch: number; crouched: boolean; health: number };
  portals: { a: unknown | null; b: unknown | null };
  /** Per-entity state from Element.snapshot(), by entity id. */
  entities: Record<string, unknown>;
}

/** Settings the shell pushes into the simulation/renderer (from the options menu). */
export interface SessionSettings {
  fov: number;
  mouseSensitivity: number;
  invertY: boolean;
  renderScale: number;
  recursionDepth: number;
  portalColors: { a: number; b: number };
  reduceRoll: boolean;
  reduceFlashing: boolean;
  highContrastHazards: boolean;
  /** Accessibility assist: slow motion during flings and wider placement tolerance. */
  assist: boolean;
  toggleCrouch: boolean;
  /** Most frames drawn per second; 0 = no cap (the display's rate). Physics stays at 60 Hz. */
  frameCap: number;
}

export interface GameSession {
  readonly events: EventBus;
  /** Load and start a chamber (from the chamber list, the editor, or a share link). */
  loadChamber(level: LevelData, opts?: { checkpoint?: string | null }): void;
  /** The chamber currently loaded. */
  current(): LevelData | null;
  /** Back to the chamber start (pause-menu "Restart chamber", R key). */
  restartChamber(): void;
  /** Back to the last checkpoint (after death). */
  respawn(): void;
  snapshot(): SessionSnapshot;
  restore(s: SessionSnapshot, level: LevelData): void;
  counters(): Counters;
  /** When paused the simulation doesn't step and the pointer is free. */
  setPaused(paused: boolean): void;
  applySettings(s: Partial<SessionSettings>): void;
}
