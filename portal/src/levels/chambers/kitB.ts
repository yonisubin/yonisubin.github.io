// Building blocks for workstream B's chambers (c11–c19, escape1, escape2, finale): boxes, rooms with
// doorways cut into their walls, and the standard chamber anatomy pieces (entry booth + info sign,
// exit booth). Plain functions that return level data; nothing here runs at play time.
//
// Conventions used by every B chamber: the floor of the main level is y = 0; the player walks
// roughly toward -Z (yaw 0 faces -Z), so the entry booth has yaw π (its door faces -Z) and the exit
// booth yaw 0 (its door faces +Z). Walls are 1 m thick and sit outside a room's interior box.
import type { Brush, Entity, FaceKey, SurfaceTag, Vec3 } from '../level';

export const P: SurfaceTag = 'portalable';
export const M: SurfaceTag = 'metal';
export const G: SurfaceTag = 'glass';
export type Theme = 'clean' | 'industrial';

/** One box brush. */
export function box(min: Vec3, max: Vec3, tag: SurfaceTag = M, faces?: Partial<Record<FaceKey, SurfaceTag>>, theme?: Theme): Brush {
  const b: Brush = { min, max, tag };
  if (faces) b.faces = faces;
  if (theme) b.theme = theme;
  return b;
}

/** A hole in a wall: centre along the wall, width, height above the room floor, and its bottom. */
export interface Opening {
  at: number;
  width: number;
  height: number;
  bottom?: number;
}

export interface RoomOpts {
  floor?: SurfaceTag;
  ceil?: SurfaceTag;
  /** Tag of every wall, or per side (n = -Z side, s = +Z side, w = -X side, e = +X side). */
  walls?: SurfaceTag | Partial<Record<'n' | 's' | 'w' | 'e', SurfaceTag>>;
  holes?: Partial<Record<'n' | 's' | 'w' | 'e', Opening[]>>;
  /** Leave a side out entirely (it is shared with a neighbouring room or built by hand). */
  skip?: ('n' | 's' | 'w' | 'e' | 'floor' | 'ceil')[];
  theme?: Theme;
  /** Wall thickness (default 1). */
  t?: number;
}

/**
 * A wall slab between a..b along one horizontal axis with openings cut out. `axis` 'x' means the
 * wall runs along X (a north or south wall) and occupies [c0, c1] in Z; 'z' runs along Z.
 */
export function wall(axis: 'x' | 'z', a: number, b: number, c0: number, c1: number, y0: number, y1: number, tag: SurfaceTag, holes: Opening[] = [], theme?: Theme): Brush[] {
  const out: Brush[] = [];
  const mk = (u0: number, u1: number, v0: number, v1: number) => {
    if (u1 - u0 < 1e-6 || v1 - v0 < 1e-6) return;
    out.push(axis === 'x' ? box([u0, v0, c0], [u1, v1, c1], tag, undefined, theme) : box([c0, v0, u0], [c1, v1, u1], tag, undefined, theme));
  };
  const hs = [...holes].sort((p, q) => p.at - q.at);
  let u = a;
  for (const h of hs) {
    const h0 = h.at - h.width / 2;
    const h1 = h.at + h.width / 2;
    const bottom = y0 + (h.bottom ?? 0);
    mk(u, h0, y0, y1);
    mk(h0, h1, bottom + h.height, y1); // lintel
    mk(h0, h1, y0, bottom); // sill
    u = h1;
  }
  mk(u, b, y0, y1);
  return out;
}

/** A room: interior box [x0,x1]×[y0,y1]×[z0,z1] with a floor slab, ceiling and four walls. */
export function room(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, o: RoomOpts = {}): Brush[] {
  const t = o.t ?? 1;
  const skip = new Set(o.skip ?? []);
  const wt = (side: 'n' | 's' | 'w' | 'e'): SurfaceTag => (typeof o.walls === 'string' ? o.walls : (o.walls?.[side] ?? P));
  const out: Brush[] = [];
  if (!skip.has('floor')) out.push(box([x0 - t, y0 - t, z0 - t], [x1 + t, y0, z1 + t], o.floor ?? P, undefined, o.theme));
  if (!skip.has('ceil')) out.push(box([x0 - t, y1, z0 - t], [x1 + t, y1 + t, z1 + t], o.ceil ?? M, undefined, o.theme));
  if (!skip.has('n')) out.push(...wall('x', x0 - t, x1 + t, z0 - t, z0, y0, y1, wt('n'), shift(o.holes?.n, 0), o.theme));
  if (!skip.has('s')) out.push(...wall('x', x0 - t, x1 + t, z1, z1 + t, y0, y1, wt('s'), shift(o.holes?.s, 0), o.theme));
  if (!skip.has('w')) out.push(...wall('z', z0, z1, x0 - t, x0, y0, y1, wt('w'), o.holes?.w, o.theme));
  if (!skip.has('e')) out.push(...wall('z', z0, z1, x1, x1 + t, y0, y1, wt('e'), o.holes?.e, o.theme));
  return out;
}

function shift(h: Opening[] | undefined, d: number): Opening[] | undefined {
  return h?.map((x) => ({ ...x, at: x.at + d }));
}

/** Door opening sized for the standard door entity (2.4 × 3 m) plus a little clearance. */
export const DOORWAY = (at: number): Opening => ({ at, width: 2.4, height: 3 });

/**
 * Entry anatomy: a lobby (interior x0-3..x0+3, z zBack-8..zBack) with the entry booth at its back, the
 * info sign on the east wall, and an open doorway (width 2.4) in its north wall at x0. Returns
 * brushes, entities and the spawn.
 */
export function lobby(zBack: number, y = 0, theme?: Theme, x0 = 0): { brushes: Brush[]; entities: Entity[]; spawn: { position: Vec3; yaw: number } } {
  const z0 = zBack - 8;
  return {
    brushes: room(x0 - 3, x0 + 3, y, y + 4, z0, zBack, { walls: M, floor: M, holes: { n: [{ at: x0, width: 2.4, height: 3 }] }, theme }),
    entities: [
      { id: 'entry', type: 'entryElevator', position: [x0, y, zBack - 1.6], yaw: Math.PI },
      { id: 'sign', type: 'sign', position: [x0 + 2.97, y + 1.9, zBack - 4.5], yaw: -Math.PI / 2 },
      { id: 'lobbyLight', type: 'light', position: [x0, y + 3.5, zBack - 4], props: { intensity: 6, distance: 12 } },
    ],
    spawn: { position: [x0, y, zBack - 1.6], yaw: 0 },
  };
}

/**
 * Exit anatomy: an exit hall (interior x0-3..x0+3, z zFront-6..zFront) whose south wall has a door
 * entity `exitDoor` at x0 (open input wired by the chamber), and the exit booth at its north end.
 */
export function exitHall(x0: number, zFront: number, y = 0, theme?: Theme): { brushes: Brush[]; entities: Entity[] } {
  const z0 = zFront - 6;
  return {
    brushes: room(x0 - 3, x0 + 3, y, y + 4, z0, zFront, { walls: M, floor: M, holes: { s: [DOORWAY(x0)] }, skip: ['s'], theme }),
    entities: [
      { id: 'exitDoor', type: 'door', position: [x0, y, zFront + 0.5] },
      { id: 'exit', type: 'exitElevator', position: [x0, y, z0 + 1.6], yaw: 0 },
      { id: 'exitLight', type: 'light', position: [x0, y + 3.5, z0 + 3], props: { intensity: 5, distance: 10 } },
    ],
  };
}

/** A wall (along X, at z = zc ± 0.5) with a doorway for a door entity at x = at. */
export function doorWall(x0: number, x1: number, zc: number, y0: number, y1: number, at: number, tag: SurfaceTag = M, theme?: Theme): Brush[] {
  return wall('x', x0, x1, zc - 0.5, zc + 0.5, y0, y1, tag, [DOORWAY(at)], theme);
}

/** A light strip from an input to its receiver (on the floor at y + 0.01). */
export function strip(id: string, at: Vec3, path: [number, number][], y = 0, icon?: 'check' | 'timer', yaw = 0): Entity {
  return { id, type: 'indicator', position: at, yaw, props: { path: path.map(([x, z]) => [x, y + 0.01, z]), ...(icon ? { icon } : {}) } };
}

/** A developer commentary node (shown when commentary is on). */
export function note(id: string, at: Vec3, text: string): Entity {
  return { id, type: 'commentaryNode', position: at, props: { text } };
}

/** Wall writing / drawing: a decal with text, on a wall facing `yaw`. */
export function scrawl(id: string, at: Vec3, yaw: number, text: string, size: [number, number] = [2.4, 0.6], ink = '#3b2f2a', image?: string): Entity {
  return { id, type: 'decal', position: at, yaw, props: { text, size, ink, ...(image ? { image } : {}) } };
}
