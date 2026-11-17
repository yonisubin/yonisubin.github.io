// Level data format, version 2 (the CONTRACT shared by the simulation and the shell/editor; change
// it only by agreement). Plain JSON-able data: the editor writes it, the loader validates it, the
// simulation builds a chamber from it.
//
//   brushes   axis-aligned boxes with a surface tag per face (portalable / metal / glass)
//   entities  everything else: props, buttons, doors, hazards, turrets... (`type` + free `props`)
//   wiring    edges from an entity output to an entity input. Several wires into one input are
//             AND-ed; use a `gate` entity (props.op = 'and' | 'or' | 'not' | 'timer') for anything else
//   triggers  invisible boxes that fire an event (scripting, dialogue, checkpoints)
//   dialogue  event name → dialogue line ids (the lines themselves live in dialogue/, owned by the shell)

export type SurfaceTag = 'portalable' | 'metal' | 'glass';
export type FaceKey = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';
export type Vec3 = [number, number, number];

export interface Brush {
  min: Vec3;
  max: Vec3;
  /** Tag of every face unless overridden in `faces`. */
  tag: SurfaceTag;
  faces?: Partial<Record<FaceKey, SurfaceTag>>;
  /** Optional visual theme override for this brush (escape levels are darker / rustier). */
  theme?: 'clean' | 'industrial';
}

/** A marker drawn on the floor (no collision), e.g. the target pad of the fling test. */
export interface Marker {
  position: Vec3;
  size: [number, number];
  color: number;
}

/** Every entity type the simulation knows. Add new ones here (contract change). */
export type EntityType =
  // props (phase 5)
  | 'cube'
  | 'companionCube'
  | 'sphere'
  | 'debris'
  // inputs / receivers / logic (phase 6)
  | 'floorButton' // props: accepts?: 'any' | 'cube' | 'sphere'
  | 'pedestalButton' // props: seconds?: number (0 = toggle/latch)
  | 'door'
  | 'platform' // props: waypoints: Vec3[], speed, loop?
  | 'lift' // props: height, speed
  | 'panel' // moving/rotating wall panel; props: to: Vec3, rotate?: number
  | 'gate' // props: op: 'and' | 'or' | 'not' | 'timer', seconds?
  | 'indicator' // light strip; props: path: Vec3[], icon?: 'check' | 'timer'
  | 'sign' // chamber info sign; uses level.info
  | 'entryElevator'
  | 'exitElevator'
  | 'fixedPortal' // pre-placed portal end; props: which: 'a' | 'b', normal: Vec3, cycle?: Vec3[][] (flipping exit)
  // hazards and enemies (phase 7)
  | 'pelletLauncher' // props: direction: Vec3, life: seconds
  | 'pelletCatcher'
  | 'grill' // props: size: [w, h], normal: Vec3
  | 'liquid' // props: size: Vec3 (toxic box)
  | 'crusher' // props: travel: Vec3, period
  | 'turret'
  | 'rocketTurret'
  | 'disposal' // boss: disposal unit for detached components
  | 'bossCore' // boss: the overseer's body
  // flavour
  | 'light'
  | 'decal' // props: text?: string, image?: string (procedural), size
  | 'commentaryNode' // props: text
  // story elements (wave 2, workstream B: elements/story.ts)
  | 'zone' // invisible box watching the player; props: size. Outputs: inside, entered
  | 'chute' // files (dissolves) one prop; props: size, accepts?: id, acceptsType?. Output: filed
  | 'exitZone' // exit without a booth; props: size, delay. Input: armed
  | 'erasure'; // finale countdown hazard; props: seconds[], core, moat, boardSize. Input: active

export interface Entity {
  id: string;
  type: EntityType;
  position: Vec3;
  /** Rotation about Y (radians). Use props for anything more. */
  yaw?: number;
  props?: Record<string, unknown>;
}

export interface Wire {
  /** "entityId.output", e.g. "button1.pressed" */
  from: string;
  /** "entityId.input", e.g. "door1.open" */
  to: string;
}

export interface Trigger {
  id: string;
  min: Vec3;
  max: Vec3;
  /** Event name fired on the bus as `trigger` with this name. */
  event: string;
  once?: boolean;
}

export interface Checkpoint {
  id: string;
  /** Entering this box makes the checkpoint current (and emits `checkpoint`). */
  min: Vec3;
  max: Vec3;
  spawn: { position: Vec3; yaw: number };
}

export interface DialogueHook {
  /** Bus event that plays the lines: 'chamberStart', 'idle', 'death', 'exitReached', or a trigger event name. */
  event: string;
  lines: string[];
}

export interface LevelData {
  version?: 2;
  /** Stable id, used in saves, chapter select and the chamber list. */
  id?: string;
  name: string;
  spawn: { position: Vec3; yaw: number };
  brushes: Brush[];
  markers?: Marker[];
  entities?: Entity[];
  wiring?: Wire[];
  triggers?: Trigger[];
  checkpoints?: Checkpoint[];
  dialogue?: DialogueHook[];
  /** Which ends the player's device can fire in this chamber (spec: early chambers). Default 'both'. */
  device?: 'none' | 'a' | 'both';
  /** Info sign content and look. */
  info?: { number?: number; title?: string; icons?: string[]; theme?: 'clean' | 'industrial' };
  /** Id of the chamber the exit elevator leads to. */
  next?: string;
}

export function faceTag(b: Brush, face: FaceKey): SurfaceTag {
  return b.faces?.[face] ?? b.tag;
}

/** The face key for an axis-aligned unit normal (or null if it isn't axis-aligned). */
export function faceKeyFromNormal(n: { x: number; y: number; z: number }): FaceKey | null {
  const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
  if (ax > 0.99) return n.x > 0 ? '+x' : '-x';
  if (ay > 0.99) return n.y > 0 ? '+y' : '-y';
  if (az > 0.99) return n.z > 0 ? '+z' : '-z';
  return null;
}
