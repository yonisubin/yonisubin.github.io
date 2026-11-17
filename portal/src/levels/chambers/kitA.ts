// Building blocks for workstream A's chambers (c01–c10, adv1–adv6): box brushes by tag, a room shell
// with doorways cut into its walls, and the standard chamber anatomy (spec "Chamber anatomy"):
//
//   entry elevator → antechamber with the info sign → [test area] → exit door gated by inputs → exit elevator
//
// Conventions: floors have their top at the given y; walls are THICK thick, outside the room box;
// "north" is −z (the way the player faces at yaw 0), the antechamber is always south of the test area
// and the exit bay north of it. Everything returns plain LevelData pieces (no three.js).
import type { Brush, Entity, FaceKey, SurfaceTag, Vec3, Wire } from '../level';


export const THICK = 0.5;
/** Centre height of a wall portal standing on the floor (portal height 2.1, plus a hair). */
export const PORTAL_Y = 1.06;
/** Exit door opening (the door entity is 2.4 m wide, 3 m tall). */
const DOOR_W = 2.4;
const DOOR_H = 3;

export const box = (min: Vec3, max: Vec3, tag: SurfaceTag, faces?: Partial<Record<FaceKey, SurfaceTag>>, theme?: Brush['theme']): Brush => {
  const b: Brush = { min, max, tag };
  if (faces) b.faces = faces;
  if (theme) b.theme = theme;
  return b;
};
/** White (portalable) box. */
export const white = (min: Vec3, max: Vec3, faces?: Partial<Record<FaceKey, SurfaceTag>>): Brush => box(min, max, 'portalable', faces);
/** Dark metal (non-portalable) box. */
export const metal = (min: Vec3, max: Vec3, faces?: Partial<Record<FaceKey, SurfaceTag>>): Brush => box(min, max, 'metal', faces);
export const glass = (min: Vec3, max: Vec3): Brush => box(min, max, 'glass');

/** An opening in a wall: [a0, a1] along the wall (x for north/south walls, z for east/west), [y0, y1] up. */
export interface Hole {
  a0: number;
  a1: number;
  y0: number;
  y1: number;
  /** Fill the opening with a full-thickness piece of this tag (a white panel set into a metal wall,
   *  or a window). Panels must be part of the wall: a thin slab in front of it would leave the wall
   *  behind an aperture solid. */
  fill?: SurfaceTag;
}

/** A panel of `tag` set into a wall: [a0, a1] along it, [y0, y1] up. */
export const panel = (a0: number, a1: number, y0: number, y1: number, tag: SurfaceTag = 'portalable'): Hole => ({ a0, a1, y0, y1, fill: tag });

type Side = 'n' | 's' | 'e' | 'w';

export interface ShellOptions {
  /** Inside of the room: min = [x0, floorTop, z0], max = [x1, ceilingBottom, z1]. */
  min: Vec3;
  max: Vec3;
  floor?: SurfaceTag | null;
  ceiling?: SurfaceTag | null;
  /** Tag per wall (default metal). null leaves that wall out. */
  walls?: Partial<Record<Side, SurfaceTag | null>>;
  holes?: Partial<Record<Side, Hole[]>>;
  t?: number;
}

/** Wall pieces around holes: solid columns between holes, plus sills and lintels. */
function wallWithHoles(side: Side, o: Required<Pick<ShellOptions, 'min' | 'max' | 't'>>, tag: SurfaceTag, holes: Hole[]): Brush[] {
  const [x0, y0, z0] = o.min;
  const [x1, y1, z1] = o.max;
  const t = o.t;
  const alongX = side === 'n' || side === 's';
  const a0 = alongX ? x0 - t : z0;
  const a1 = alongX ? x1 + t : z1;
  // Thickness range across the wall.
  const c0 = side === 'n' ? z0 - t : side === 's' ? z1 : side === 'w' ? x0 - t : x1;
  const c1 = c0 + t;
  const mk = (p0: number, p1: number, h0: number, h1: number): Brush =>
    alongX ? box([p0, h0, c0], [p1, h1, c1], tag) : box([c0, h0, p0], [c1, h1, p1], tag);
  const out: Brush[] = [];
  let at = a0;
  for (const h of [...holes].sort((p, q) => p.a0 - q.a0)) {
    if (h.a0 > at + 1e-6) out.push(mk(at, h.a0, y0, y1));
    if (h.y0 > y0 + 1e-6) out.push(mk(h.a0, h.a1, y0, h.y0));
    if (h.y1 < y1 - 1e-6) out.push(mk(h.a0, h.a1, h.y1, y1));
    if (h.fill) out.push(alongX ? box([h.a0, h.y0, c0], [h.a1, h.y1, c1], h.fill) : box([c0, h.y0, h.a0], [c1, h.y1, h.a1], h.fill));
    at = h.a1;
  }
  if (a1 > at + 1e-6) out.push(mk(at, a1, y0, y1));
  return out;
}

/** A closed room (floor, ceiling, four walls) with optional doorways / windows. */
export function shell(opts: ShellOptions): Brush[] {
  const t = opts.t ?? THICK;
  const [x0, y0, z0] = opts.min;
  const [x1, y1, z1] = opts.max;
  const out: Brush[] = [];
  const floor = opts.floor === undefined ? 'portalable' : opts.floor;
  const ceiling = opts.ceiling === undefined ? 'metal' : opts.ceiling;
  if (floor) out.push(box([x0 - t, y0 - t, z0 - t], [x1 + t, y0, z1 + t], floor));
  if (ceiling) out.push(box([x0 - t, y1, z0 - t], [x1 + t, y1 + t, z1 + t], ceiling));
  for (const side of ['n', 's', 'e', 'w'] as Side[]) {
    const tag = opts.walls?.[side] === undefined ? 'metal' : opts.walls[side];
    if (!tag) continue;
    out.push(...wallWithHoles(side, { min: opts.min, max: opts.max, t }, tag, opts.holes?.[side] ?? []));
  }
  return out;
}

/** A doorway hole for the standard door, centred at `a` along the wall, standing on `y`. */
export const doorway = (a: number, y = 0): Hole => ({ a0: a - DOOR_W / 2 - 0.05, a1: a + DOOR_W / 2 + 0.05, y0: y, y1: y + DOOR_H + 0.05 });

export interface Piece {
  brushes: Brush[];
  entities: Entity[];
  wiring?: Wire[];
}

/**
 * Entry elevator + antechamber south of a test area whose south wall is at z = `z` (the wall itself
 * must leave `doorway(x, y)` open). The antechamber is 6 m wide, 7 m deep, 4 m tall, dark metal, with
 * the info sign on its east wall. Returns the spawn too.
 */
export function intake(x: number, z: number, y = 0): Piece & { spawn: { position: Vec3; yaw: number } } {
  const brushes = shell({
    min: [x - 3, y, z + THICK],
    max: [x + 3, y + 4, z + 7.5],
    floor: 'metal',
    ceiling: 'metal',
    walls: { n: null },
  });
  // Close the gap between the antechamber and the test-area wall (the wall belongs to the test area).
  const entities: Entity[] = [
    { id: 'entry', type: 'entryElevator', position: [x, y, z + 5.6], yaw: Math.PI },
    { id: 'sign', type: 'sign', position: [x + 2.95, y + 1.9, z + 2.6], yaw: -Math.PI / 2 },
    { id: 'introLight', type: 'light', position: [x, y + 3.4, z + 2.5], props: { intensity: 6, distance: 9, color: 0xeaf4ff } },
  ];
  return { brushes, entities, spawn: { position: [x, y, z + 5.6], yaw: 0 } };
}

/**
 * Exit door + exit bay + exit elevator north of a test area whose north wall is at z = `z` (inner
 * face; the wall spans z − THICK..z and must leave `doorway(x, y)` open). The door sits in the wall
 * opening; `open` lists outputs AND-ed into it (empty = always open).
 */
export function exitBay(x: number, z: number, y = 0, open: string[] = []): Piece {
  const brushes = shell({
    min: [x - 2.5, y, z - THICK - 6],
    max: [x + 2.5, y + 4, z - THICK],
    floor: 'metal',
    ceiling: 'metal',
    walls: { s: null },
  });
  const entities: Entity[] = [
    { id: 'exitDoor', type: 'door', position: [x, y, z - THICK / 2], props: { open: open.length === 0 } },
    { id: 'exit', type: 'exitElevator', position: [x, y, z - THICK - 4.4], yaw: 0 },
    { id: 'exitLight', type: 'light', position: [x, y + 3.4, z - THICK - 2], props: { intensity: 5, distance: 8, color: 0xdff6ff } },
  ];
  const wiring = open.map((from) => ({ from, to: 'exitDoor.open' }));
  return { brushes, entities, wiring };
}

/** An indicator strip on the floor (y + 0.01) through `path`, with its icon on a wall at `icon`. */
export function strip(id: string, path: Vec3[], icon: Vec3, iconYaw: number, kind: 'check' | 'timer' = 'check'): Entity {
  return { id, type: 'indicator', position: icon, yaw: iconYaw, props: { path: path.map((p) => [p[0], p[1] + 0.01, p[2]]), icon: kind } };
}

/** A ceiling light. */
export const lamp = (id: string, at: Vec3, intensity = 9, distance = 18): Entity => ({ id, type: 'light', position: at, props: { intensity, distance } });

/**
 * A floor slab [x0..x1] × [z0..z1] (top `top`, bottom `bottom`) with a full-depth white pad set into
 * it whose top is `padTop` (it may stand proud of the slab). Apertures need the brush they sit on to
 * reach ~2.6 m down (their tunnel), so a pad can't be a thin tile on a metal floor.
 */
export function padded(x0: number, x1: number, z0: number, z1: number, top: number, bottom: number, pad: { x0: number; x1: number; z0: number; z1: number }, padTop: number): Brush[] {
  return [
    metal([x0, bottom, z0], [x1, top, pad.z0]),
    metal([x0, bottom, pad.z1], [x1, top, z1]),
    metal([x0, bottom, pad.z0], [pad.x0, top, pad.z1]),
    metal([pad.x1, bottom, pad.z0], [x1, top, pad.z1]),
    white([pad.x0, Math.min(bottom, padTop - 3), pad.z0], [pad.x1, padTop, pad.z1], { '-y': 'metal' }),
  ];
}

/** Toxic liquid filling [x0..x1] × [z0..z1] (surface y, depth) around a dry rectangle (as four pools). */
export function liquidAround(id: string, x0: number, x1: number, z0: number, z1: number, surface: number, depth: number, dry: { x0: number; x1: number; z0: number; z1: number }): Entity[] {
  const boxes: [number, number, number, number][] = [
    [x0, x1, z0, dry.z0],
    [x0, x1, dry.z1, z1],
    [x0, dry.x0, dry.z0, dry.z1],
    [dry.x1, x1, dry.z0, dry.z1],
  ];
  return boxes
    .filter(([a, b, c, d]) => b - a > 1e-6 && d - c > 1e-6)
    .map(([a, b, c, d], i) => ({ id: `${id}${i + 1}`, type: 'liquid', position: [(a + b) / 2, surface, (c + d) / 2], props: { size: [b - a, depth, d - c] } }));
}
