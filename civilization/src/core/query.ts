// Small read-only helpers over GameState used by every system.
import { D, get, type UnitDef } from '../data';
import type { MapDims } from './hex';
import type { City, GameState, Notification, Player, Tile, Unit } from './state';

export const dims = (s: GameState): MapDims => s.map;
export const tileAt = (s: GameState, i: number): Tile => s.map.tiles[i];
export const unitDef = (u: Unit | string): UnitDef => get(D.units, typeof u === 'string' ? u : u.type);
export const isCivilian = (u: Unit) => unitDef(u).class === 'civilian';
export const isMilitary = (u: Unit) => !isCivilian(u);

export const allUnits = (s: GameState): Unit[] => Object.values(s.units);
export const allCities = (s: GameState): City[] => Object.values(s.cities);
export const playerUnits = (s: GameState, p: number) => allUnits(s).filter((u) => u.owner === p);
export const playerCities = (s: GameState, p: number) => allCities(s).filter((c) => c.owner === p);
export const majorPlayers = (s: GameState) => s.players.filter((p) => !p.isBarbarian && !p.isMinor);
export const minorPlayers = (s: GameState) => s.players.filter((p) => p.isMinor);
export const barbarianId = (s: GameState) => s.players.findIndex((p) => p.isBarbarian);

// A temporary tile → units/city index for read-only stretches (path searches, scoring loops),
// where looking things up by scanning every unit would be too slow. Nothing may move units or
// cities while it is active.
let index: { s: GameState; units: Map<number, Unit[]>; cities: Map<number, City> } | null = null;
const NONE: Unit[] = [];

export function withIndex<T>(s: GameState, fn: () => T): T {
  if (index && index.s === s) return fn();
  const prev = index;
  const units = new Map<number, Unit[]>();
  for (const id in s.units) {
    const u = s.units[id];
    const l = units.get(u.tile);
    if (l) l.push(u);
    else units.set(u.tile, [u]);
  }
  const cities = new Map<number, City>();
  for (const id in s.cities) cities.set(s.cities[id].tile, s.cities[id]);
  index = { s, units, cities };
  try {
    return fn();
  } finally {
    index = prev;
  }
}

export function unitsAt(s: GameState, tile: number): Unit[] {
  if (index && index.s === s) return index.units.get(tile) ?? NONE;
  const out: Unit[] = [];
  for (const id in s.units) if (s.units[id].tile === tile) out.push(s.units[id]);
  return out;
}

export function cityAt(s: GameState, tile: number): City | undefined {
  if (index && index.s === s) return index.cities.get(tile);
  for (const id in s.cities) if (s.cities[id].tile === tile) return s.cities[id];
  return undefined;
}

/** The military unit on a tile (aircraft based there don't count). */
export function militaryAt(s: GameState, tile: number): Unit | undefined {
  return unitsAt(s, tile).find((u) => isMilitary(u) && unitDef(u).domain !== 'air');
}
export function civilianAt(s: GameState, tile: number): Unit | undefined {
  return unitsAt(s, tile).find(isCivilian);
}

export const hasTech = (p: Player, tech: string | undefined) => !tech || p.techs.includes(tech);

export function atWar(s: GameState, a: number, b: number): boolean {
  if (a === b || a < 0 || b < 0) return false;
  if (s.players[a].isBarbarian || s.players[b].isBarbarian) return true;
  return s.diplomacy.war[a][b];
}

export function capitalOf(s: GameState, p: number): City | undefined {
  return allCities(s).find((c) => c.owner === p && c.isCapital);
}

/** Era of a player (latest era of any tech they own). */
export function eraOf(p: Player): number {
  let e = 0;
  for (const t of p.techs) e = Math.max(e, D.techs.get(t)!.era);
  return e;
}

export function difficultyOf(s: GameState) {
  return get(D.difficulty, s.settings.difficulty);
}

/** Cost multiplier (research, production, growth) for a player: pace × difficulty. */
export function costMult(s: GameState, p: number): number {
  const pace = get(D.pace, s.settings.pace).costPct / 100;
  const diff = difficultyOf(s);
  const pl = s.players[p];
  const pct = pl.isBarbarian ? 100 : pl.isHuman ? diff.humanCostPct : diff.aiCostPct;
  return (pace * pct) / 100;
}

export function notify(s: GameState, p: number, text: string, kind: Notification['kind'] = 'info', tile?: number): void {
  const pl = s.players[p];
  if (!pl || pl.isBarbarian || pl.isMinor) return;
  pl.notifications.push({ turn: s.turn, text, kind, tile });
  if (pl.notifications.length > 60) pl.notifications.splice(0, pl.notifications.length - 60);
}

export function factionOf(s: GameState, p: number) {
  const pl = s.players[p];
  return pl.isBarbarian || pl.isMinor ? undefined : D.factions.get(pl.faction);
}

/** Year label for a turn ("3600 BC"). */
export function yearOf(s: GameState, turn = s.turn): string {
  const pace = get(D.pace, s.settings.pace);
  let year = -4000;
  let t = 0;
  for (const [until, step] of pace.yearsPerTurn) {
    const n = Math.max(0, Math.min(turn, until) - t);
    year += n * step;
    t += n;
    if (t >= turn) break;
  }
  if (turn > t) year += turn - t;
  return year < 0 ? `${-year} BC` : `${year} AD`;
}

/** Record a notable event for the replay (kept short: the last 400). */
export function logEvent(s: GameState, text: string, tile?: number, player?: number): void {
  s.events.push({ turn: s.turn, text, tile, player });
  if (s.events.length > 400) s.events.splice(0, s.events.length - 400);
}
