// Trade routes. A Caravan (land) or Cargo Ship (sea) in one of your cities can open a route to
// a city in range: to another civilization (gold for both, science for whoever is behind, and
// religious pressure both ways), to a city-state (gold, more if allied), or to one of your own
// cities (food or production sent to it). Routes last 30 turns; then the unit comes back.
// The caravan travels its path visibly; an enemy standing on it can plunder it.
import { D } from '../../data';
import { distance, neighbors } from '../hex';
import { atWar, cityAt, dims, eraOf, notify, tileAt, unitDef } from '../query';
import type { City, GameState, TradeRoute, Unit } from '../state';
import { playerEffects, sum } from './effects';
import { createUnit, freeTileNear, removeUnit } from './units';
import { isCoastalTile, isWater } from './domain';

const T = () => D.rules.trade;

export function tradeSlots(s: GameState, p: number): number {
  let n = 0;
  for (const t of s.players[p].techs) n += D.techs.get(t)?.tradeRoutes ?? 0;
  return n + sum(playerEffects(s, p), 'trade_routes');
}

export const routesOf = (s: GameState, p: number) => s.tradeRoutes.filter((r) => r.owner === p);

function rangeOf(c: City, kind: 'land' | 'sea'): number {
  let pct = 0;
  for (const b of c.buildings) pct += D.buildings.get(b)?.routeRangePct ?? 0;
  return Math.round((kind === 'land' ? T().landRange : T().seaRange) * (1 + pct / 100));
}

/** Shortest land (or sea) path between two cities, within `max` steps; null if none. */
export function routePath(s: GameState, from: number, to: number, kind: 'land' | 'sea', max: number): number[] | null {
  const m = dims(s);
  const ok = (i: number) => {
    if (i === to || i === from) return true;
    const t = tileAt(s, i);
    if (kind === 'sea') return isWater(s, i) && t.feature !== 'ice';
    return !isWater(s, i) && t.terrain !== 'mountain' && t.feature !== 'ice';
  };
  const prev = new Map<number, number>([[from, -1]]);
  let frontier = [from];
  for (let step = 0; step < max && frontier.length; step++) {
    const next: number[] = [];
    for (const i of frontier)
      for (const n of neighbors(m, i)) {
        if (prev.has(n) || !ok(n)) continue;
        prev.set(n, i);
        if (n === to) {
          const path: number[] = [];
          for (let c = to; c !== -1; c = prev.get(c)!) path.push(c);
          return path.reverse();
        }
        next.push(n);
      }
    frontier = next;
  }
  return null;
}

export interface RouteOption {
  to: City;
  kind: 'land' | 'sea';
  path: number[];
  carries: 'gold' | 'food' | 'production';
  origin: Partial<Record<'gold' | 'science' | 'food' | 'production', number>>;
  dest: Partial<Record<'gold' | 'science' | 'food' | 'production', number>>;
}

/** Yields a route would make for its origin and destination. */
export function routeYields(s: GameState, from: City, to: City, pathLen: number, carries: 'gold' | 'food' | 'production'): Pick<RouteOption, 'origin' | 'dest'> {
  const t = T();
  if (from.owner === to.owner) {
    const amt = Math.round(t.internalBase + pathLen * t.internalPerDistance);
    return { origin: {}, dest: carries === 'production' ? { production: amt } : { food: amt } };
  }
  const gold = t.baseGold + pathLen * t.goldPerDistance + to.pop * t.goldPerTargetPop;
  const target = s.players[to.owner];
  if (target.isMinor) return { origin: { gold: Math.round(gold + (target.minor!.ally === from.owner ? t.cityStateAllyBonus : 0)) }, dest: {} };
  const a = s.players[from.owner].techs.length, b = target.techs.length;
  return {
    origin: { gold: Math.round(gold), science: b > a ? Math.round(((b - a) * t.scienceBehind) / 2) : 0 },
    dest: { gold: Math.round(gold * t.targetGoldShare), science: a > b ? Math.round(((a - b) * t.scienceBehind) / 2) : 0 },
  };
}

/** Where a trade unit standing in one of its owner's cities could go. */
export function routeOptions(s: GameState, u: Unit): RouteOption[] {
  const kind = unitDef(u).trade;
  const from = cityAt(s, u.tile);
  if (!kind || !from || from.owner !== u.owner) return [];
  if (kind === 'sea' && !isCoastalTile(s, from.tile)) return [];
  const out: RouteOption[] = [];
  const pl = s.players[u.owner];
  const range = rangeOf(from, kind);
  for (const to of Object.values(s.cities)) {
    if (to.id === from.id) continue;
    if (to.owner !== u.owner && (!pl.met.includes(to.owner) || atWar(s, u.owner, to.owner))) continue;
    if (s.players[to.owner].isBarbarian) continue;
    const embargo = s.congress?.active.some((r) => r.resolution === 'embargo' && (Number(r.target) === to.owner || Number(r.target) === u.owner));
    if (embargo && to.owner !== u.owner) continue;
    if (distance(dims(s), from.tile, to.tile) > range) continue;
    if (kind === 'sea' && !isCoastalTile(s, to.tile)) continue;
    if (s.tradeRoutes.some((r) => r.from === from.id && r.to === to.id)) continue;
    const path = routePath(s, from.tile, to.tile, kind, range);
    if (!path) continue;
    const kinds: ('gold' | 'food' | 'production')[] = to.owner === u.owner ? ['food', 'production'] : ['gold'];
    for (const carries of kinds) out.push({ to, kind, path, carries, ...routeYields(s, from, to, path.length - 1, carries) });
  }
  return out.sort((a, b) => sumY(b) - sumY(a));
}

const sumY = (o: Pick<RouteOption, 'origin' | 'dest'>) => Object.values(o.origin).reduce((x, y) => x + (y ?? 0), 0) + Object.values(o.dest).reduce((x, y) => x + (y ?? 0), 0) * 0.5;

export function establishRoute(s: GameState, u: Unit, to: number, carries?: 'gold' | 'food' | 'production'): string | null {
  if (routesOf(s, u.owner).length >= tradeSlots(s, u.owner)) return `no free trade route slot (${tradeSlots(s, u.owner)} in use)`;
  const opts = routeOptions(s, u).filter((o) => o.to.id === to && (!carries || o.carries === carries));
  if (!opts.length) return 'no route to that city';
  const o = opts[0];
  const from = cityAt(s, u.tile)!;
  s.tradeRoutes.push({ id: s.nextId++, owner: u.owner, from: from.id, to, kind: o.kind, carries: o.carries, until: s.turn + T().routeTurns, path: o.path, pos: 0, dir: 1, unit: u.type });
  removeUnit(s, u);
  s.diplomacy.trades[from.owner][o.to.owner]++;
  notify(s, from.owner, `Trade route from ${from.name} to ${o.to.name} opened.`, 'good', from.tile);
  if (o.to.owner !== from.owner) notify(s, o.to.owner, `The ${s.players[from.owner].name} opened a trade route to ${o.to.name}.`, 'info', o.to.tile);
  return null;
}

/** Route yields for a city (as origin and as destination), for cityYields. */
export function cityRouteYields(s: GameState, c: City): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of s.tradeRoutes) {
    if (r.from !== c.id && r.to !== c.id) continue;
    const from = s.cities[r.from], to = s.cities[r.to];
    if (!from || !to) continue;
    const y = routeYields(s, from, to, r.path.length - 1, r.carries);
    const part = r.from === c.id ? y.origin : y.dest;
    for (const [k, v] of Object.entries(part)) out[k] = (out[k] ?? 0) + (v ?? 0);
  }
  return out;
}

/** The tile the caravan of a route is on now. */
export const routeTile = (r: TradeRoute) => r.path[Math.max(0, Math.min(r.path.length - 1, r.pos))];

export function processTradeRoutes(s: GameState): void {
  for (const r of [...s.tradeRoutes]) {
    const from = s.cities[r.from], to = s.cities[r.to];
    const broken = !from || !to || from.owner !== r.owner || (to.owner !== r.owner && atWar(s, r.owner, to.owner));
    if (broken || r.until <= s.turn) {
      s.tradeRoutes = s.tradeRoutes.filter((x) => x !== r);
      // The trader comes home and can be sent out again.
      if (from && from.owner === r.owner) {
        const at = freeTileNear(s, r.unit, r.owner, from.tile, 2);
        if (at >= 0) createUnit(s, r.unit, r.owner, at);
        notify(s, r.owner, `The trade route from ${from.name}${to ? ` to ${to.name}` : ''} ${broken ? 'was cut' : 'has ended'}; the ${D.units.get(r.unit)?.name} is home.`, 'info', from.tile);
      }
      continue;
    }
    // The caravan shuttles back and forth along its path.
    r.pos += r.dir * 2;
    if (r.pos >= r.path.length - 1) {
      r.pos = r.path.length - 1;
      r.dir = -1;
    } else if (r.pos <= 0) {
      r.pos = 0;
      r.dir = 1;
    }
  }
}

/** An enemy military unit standing on a route's caravan can plunder it. */
export function plunderable(s: GameState, u: Unit): TradeRoute | undefined {
  if (unitDef(u).class === 'civilian') return undefined;
  return s.tradeRoutes.find((r) => r.owner !== u.owner && routeTile(r) === u.tile);
}

export function plunder(s: GameState, u: Unit): string | null {
  const r = plunderable(s, u);
  if (!r) return 'no caravan here';
  if (!atWar(s, u.owner, r.owner)) return `plundering is an act of war: declare war on the ${s.players[r.owner].name} first`;
  const gold = T().plunderGold + T().plunderPerEra * eraOf(s.players[u.owner]);
  s.players[u.owner].gold += gold;
  s.tradeRoutes = s.tradeRoutes.filter((x) => x !== r);
  u.moves = 0;
  notify(s, u.owner, `You plundered a caravan: +${gold} gold.`, 'good', u.tile);
  notify(s, r.owner, `Your trade route was plundered!`, 'bad', u.tile);
  return null;
}
