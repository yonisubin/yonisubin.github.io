// Movement and pathfinding.
//
// Costs are integers in rules.moveScale units per tile (6): flat 6, hills/forest 12, road 2.
// A unit with any movement left may always enter a tile, even if the cost is higher; crossing a
// river without a bridge takes all remaining movement; leaving one enemy zone of control for
// another ends the move. Pathfinding is A* over (tile) with the cost of a path measured as
// "turns × full moves + moves spent", so it prefers paths that finish in fewer turns.
import { D, get } from '../../data';
import { dirTo, distance, neighbors } from '../hex';
import { atWar, cityAt, dims, isCivilian, militaryAt, tileAt, unitDef, unitsAt, withIndex } from '../query';
import type { GameState, Unit } from '../state';
import { fullMoves, hasRoom, onEnterTile } from './units';
import { isWater, stealthSeen, terrainAllows } from './domain';
import { carryAircraft } from './air';
import { recomputeVisibility, sightFrom, unitSight } from './visibility';

/** Cost marker meaning "uses all remaining movement" (river crossing). */
export const ALL_MOVES = -1;

export function riverBetween(s: GameState, a: number, b: number): boolean {
  const d = dirTo(dims(s), a, b);
  return d >= 0 && (tileAt(s, a).river & (1 << d)) !== 0;
}

/** Movement cost to step from `from` to neighbour `to` (Infinity if impossible terrain). */
export function stepCost(s: GameState, u: Unit, from: number, to: number): number {
  const t = tileAt(s, to);
  const ter = get(D.terrains, t.terrain);
  if (!terrainAllows(s, u, to)) return Infinity;
  const scale = D.rules.moveScale;
  const def = unitDef(u);
  // Ships pay one move per tile; embarking costs a normal move, landing ends the turn.
  if (def.domain === 'sea') return scale;
  const fromWater = isWater(s, from);
  if (ter.water) return scale;
  if (fromWater) return ALL_MOVES;
  const f = tileAt(s, from);
  const pl = s.players[u.owner];
  const bridged = pl.techs.some((x) => D.techs.get(x)!.bridges);
  const river = riverBetween(s, from, to);
  const roadLink = (f.road || !!cityAt(s, from)) && (t.road || !!cityAt(s, to));
  if (roadLink && (!river || bridged)) return D.rules.roadMove;
  if (river) return ALL_MOVES;
  if (unitDef(u).ignoresTerrainCost) return scale;
  let move = ter.move;
  if (t.hills) move = Math.max(move, D.rules.hills.move);
  if (t.feature) move = Math.max(move, D.features.get(t.feature)!.move);
  return move * scale;
}

/** Does an enemy military unit (or city) of u's enemies sit next to tile i? */
export function inEnemyZoc(s: GameState, u: Unit, i: number): boolean {
  const dom = unitDef(u).domain;
  for (const n of neighbors(dims(s), i)) {
    const m = militaryAt(s, n);
    // Ships exert zones of control on ships, land units on land units.
    if (m && m.owner !== u.owner && atWar(s, u.owner, m.owner) && unitDef(m).domain === dom) return true;
    const c = cityAt(s, n);
    if (c && c.owner !== u.owner && atWar(s, u.owner, c.owner)) return true;
  }
  return false;
}

/**
 * Can unit u be on tile i? `final`: it would stop there (stacking applies);
 * otherwise it's only passing through. Uses only what u's owner can see.
 */
export function canEnter(s: GameState, u: Unit, i: number, final: boolean): boolean {
  const t = tileAt(s, i);
  const pl = s.players[u.owner];
  const known = pl.isBarbarian || pl.explored[i] === 1;
  if (!known) return true; // unexplored: assume passable (the step will be checked for real)
  if (!terrainAllows(s, u, i)) return false;
  // Foreign land at peace is closed without open borders (city-states' land is always open).
  if (t.owner >= 0 && t.owner !== u.owner && !atWar(s, u.owner, t.owner) && !s.players[t.owner].isMinor && !(s.diplomacy.openBorders[t.owner]?.[u.owner] > s.turn)) return false;
  const city = cityAt(s, i);
  if (city && city.owner !== u.owner) return false;
  const visible = pl.isBarbarian || pl.visible[i] === 1;
  if (visible) {
    for (const o of unitsAt(s, i)) {
      if (o.id === u.id || unitDef(o).domain === 'air') continue;
      if (o.owner !== u.owner) {
        // Hidden submarines don't block (the move will bump into them for real).
        if (unitDef(o).stealth && !stealthSeen(s, o, u.owner)) continue;
        // Military units may step onto a lone enemy civilian (capturing it).
        if (isCivilian(o) && !isCivilian(u) && atWar(s, u.owner, o.owner) && !militaryAt(s, i)) continue;
        return false;
      }
      if (final && isCivilian(o) === isCivilian(u)) return false;
    }
  }
  return true;
}

export interface PathResult {
  /** Tiles to step through, start excluded, goal last. */
  path: number[];
  /** Turns needed (1 = arrives this turn). */
  turns: number;
}

/** A* path for unit u to `goal`. Returns null if unreachable. */
export function findPath(s: GameState, u: Unit, goal: number, maxNodes = 6000): PathResult | null {
  return withIndex(s, () => findPathIndexed(s, u, goal, maxNodes));
}

function findPathIndexed(s: GameState, u: Unit, goal: number, maxNodes: number): PathResult | null {
  if (goal === u.tile) return { path: [], turns: 0 };
  const zocCache = new Map<number, boolean>();
  const zoc = (i: number) => {
    let v = zocCache.get(i);
    if (v === undefined) zocCache.set(i, (v = inEnemyZoc(s, u, i)));
    return v;
  };
  const m = dims(s);
  const full = fullMoves(s, u);
  if (!canEnter(s, u, goal, true)) return null;
  // Node state per tile: best cost, moves left on arrival, turns.
  const best = new Map<number, number>();
  const came = new Map<number, number>();
  const info = new Map<number, { left: number; turns: number }>();
  const open = new Heap();
  best.set(u.tile, 0);
  info.set(u.tile, { left: u.moves, turns: 0 });
  open.push(u.tile, distance(m, u.tile, goal) * D.rules.roadMove);
  let nodes = 0;
  while (open.size) {
    const cur = open.pop();
    if (cur === goal) break;
    if (++nodes > maxNodes) return null;
    const ci = info.get(cur)!;
    for (const n of neighbors(m, cur)) {
      const isGoal = n === goal;
      if (!canEnter(s, u, n, isGoal)) continue;
      const c = stepCost(s, u, cur, n);
      if (c === Infinity) continue;
      let left = ci.left;
      let turns = ci.turns;
      if (left <= 0) {
        left = full;
        turns++;
      }
      // A unit can't end a turn on a tile with a friendly unit of the same kind.
      let after = c === ALL_MOVES || c >= left ? 0 : left - c;
      if (after > 0 && zoc(cur) && zoc(n)) after = 0;
      if (after === 0 && !isGoal && !hasRoom(s, u, n, u.owner) && s.players[u.owner].visible[n]) continue;
      const g = turns * full + (full - after);
      if (g >= (best.get(n) ?? Infinity)) continue;
      best.set(n, g);
      came.set(n, cur);
      info.set(n, { left: after, turns });
      open.push(n, g + distance(m, n, goal) * D.rules.roadMove);
    }
  }
  if (!came.has(goal)) return null;
  const path: number[] = [];
  for (let c = goal; c !== u.tile; c = came.get(c)!) path.push(c);
  path.reverse();
  const gi = info.get(goal)!;
  return { path, turns: gi.turns + 1 };
}

/**
 * Move unit u toward `goal` along a path, as far as its movement allows this turn. The rest of
 * the path is kept in u.path and continued next turn. Returns an error string or null.
 */
export function moveUnit(s: GameState, u: Unit, goal: number): string | null {
  if (goal === u.tile) return null;
  const res = findPath(s, u, goal);
  if (!res) return 'no path';
  u.path = res.path;
  u.order = 'none';
  u.fortifyTurns = 0;
  u.job = null;
  followPath(s, u);
  return null;
}

/** Step along u.path while movement lasts. */
export function followPath(s: GameState, u: Unit): void {
  const pl = s.players[u.owner];
  let moved = false;
  while (u.path.length && u.moves > 0 && s.units[u.id]) {
    const next = u.path[0];
    const final = u.path.length === 1;
    if (!canEnter(s, u, next, final)) {
      // Something appeared in the way: try to swap with a friendly unit at the goal, else stop.
      if (final && trySwap(s, u, next)) {
        u.path = [];
        moved = true;
      }
      break;
    }
    const c = stepCost(s, u, u.tile, next);
    if (c === Infinity) break;
    // Don't stop on an occupied tile mid-path: if this step would end the turn there, wait.
    const after = c === ALL_MOVES || c >= u.moves ? 0 : u.moves - c;
    if (!final && after === 0 && !hasRoom(s, u, next, u.owner)) break;
    const zoc = inEnemyZoc(s, u, u.tile) && inEnemyZoc(s, u, next);
    const prevTile = u.tile;
    u.tile = next;
    carryAircraft(s, u, prevTile);
    u.path.shift();
    u.moves = zoc ? 0 : after;
    u.acted = true;
    u.setUp = false;
    moved = true;
    // Reveal as we go, so newly seen enemies stop the move.
    if (!pl.isBarbarian) for (const i of sightFrom(s, u.tile, unitSight(s, u.id))) {
      pl.visible[i] = 1;
      pl.explored[i] = 1;
    }
    onEnterTile(s, u);
    if (!s.units[u.id]) break;
  }
  if (moved && !pl.isBarbarian) recomputeVisibility(s, u.owner);
}

/** Swap places with a friendly unit of the same kind on an adjacent tile. */
function trySwap(s: GameState, u: Unit, to: number): boolean {
  if (distance(dims(s), u.tile, to) !== 1) return false;
  const other = unitsAt(s, to).find((o) => o.owner === u.owner && isCivilian(o) === isCivilian(u));
  if (!other || other.moves <= 0) return false;
  const c1 = stepCost(s, u, u.tile, to), c2 = stepCost(s, other, to, u.tile);
  if (c1 === Infinity || c2 === Infinity) return false;
  const from = u.tile;
  u.tile = to;
  other.tile = from;
  u.moves = c1 === ALL_MOVES ? 0 : Math.max(0, u.moves - c1);
  other.moves = c2 === ALL_MOVES ? 0 : Math.max(0, other.moves - c2);
  u.acted = other.acted = true;
  other.path = [];
  other.order = 'none';
  return true;
}

/** Tiles reachable this turn (for the move highlight), with their remaining moves. */
export function reachable(s: GameState, u: Unit): Map<number, number> {
  return withIndex(s, () => reachableIndexed(s, u));
}

function reachableIndexed(s: GameState, u: Unit): Map<number, number> {
  const m = dims(s);
  const out = new Map<number, number>();
  if (u.moves <= 0) return out;
  const best = new Map<number, number>([[u.tile, u.moves]]);
  const queue = [u.tile];
  while (queue.length) {
    const cur = queue.shift()!;
    const left = best.get(cur)!;
    if (left <= 0) continue;
    for (const n of neighbors(m, cur)) {
      if (!canEnter(s, u, n, false)) continue;
      const c = stepCost(s, u, cur, n);
      if (c === Infinity) continue;
      let after = c === ALL_MOVES || c >= left ? 0 : left - c;
      if (after > 0 && inEnemyZoc(s, u, cur) && inEnemyZoc(s, u, n)) after = 0;
      if (after <= (best.get(n) ?? -1)) continue;
      best.set(n, after);
      queue.push(n);
    }
  }
  for (const [t, left] of best) if (t !== u.tile && canEnter(s, u, t, true)) out.set(t, left);
  return out;
}

/** Binary min-heap of tile ids by priority. */
class Heap {
  private items: number[] = [];
  private prio: number[] = [];
  get size() {
    return this.items.length;
  }
  push(item: number, p: number) {
    this.items.push(item);
    this.prio.push(p);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[parent] <= this.prio[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): number {
    const top = this.items[0];
    const lastI = this.items.pop()!;
    const lastP = this.prio.pop()!;
    if (this.items.length) {
      this.items[0] = lastI;
      this.prio[0] = lastP;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.items.length && this.prio[l] < this.prio[m]) m = l;
        if (r < this.items.length && this.prio[r] < this.prio[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.prio[a], this.prio[b]] = [this.prio[b], this.prio[a]];
  }
}
