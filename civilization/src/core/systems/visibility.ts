// Fog of war. Each player has `explored` (ever seen) and `visible` (seen now). Units see
// `sight` tiles with line of sight: a tile is seen if a nearer neighbour on the way is seen and
// doesn't block. Mountains always block; forest/jungle and hills block a viewer standing lower.
import { D } from '../../data';
import { distance, neighbors, within } from '../hex';
import { allCities, allUnits, dims, notify, tileAt, unitDef, withIndex } from '../query';
import type { GameState, Tile } from '../state';
import { playerEffects, sum } from './effects';

/** Height level for line of sight: 0 flat, 1 hills or woods, 2 wooded hills, 3 mountain. */
function level(t: Tile): number {
  if (t.terrain === 'mountain') return 3;
  const woods = t.feature ? D.features.get(t.feature)!.blocksSight : false;
  return (t.hills ? 1 : 0) + (woods ? 1 : 0);
}

/** Tiles seen from `from` with sight radius r. */
export function sightFrom(s: GameState, from: number, r: number): number[] {
  const m = dims(s);
  const viewer = tileAt(s, from).hills ? 1 : 0;
  const seen = new Set<number>([from]);
  const out = [from];
  const tiles = within(m, from, r);
  // within() returns nearest first, so every tile's nearer neighbours are decided before it.
  for (const t of tiles) {
    if (t === from) continue;
    const d = distance(m, from, t);
    if (d === 1) {
      seen.add(t);
      out.push(t);
      continue;
    }
    const ok = neighbors(m, t).some((n) => seen.has(n) && distance(m, from, n) === d - 1 && (n === from || level(tileAt(s, n)) <= viewer));
    if (ok) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

export function unitSight(s: GameState, uid: number): number {
  const u = s.units[uid];
  let r = unitDef(u).sight;
  for (const p of u.promotions) r += D.promotions.get(p)!.sight;
  if (tileAt(s, u.tile).hills) r += D.rules.hills.sight;
  if (!s.players[u.owner].isBarbarian) r += sum(playerEffects(s, u.owner), 'sight', 'amount', (e) => !e.class || e.class === unitDef(u).class);
  return r;
}

export function recomputeVisibility(s: GameState, p: number): void {
  withIndex(s, () => recomputeIndexed(s, p));
}

function recomputeIndexed(s: GameState, p: number): void {
  const pl = s.players[p];
  if (pl.isBarbarian) return;
  const n = s.map.tiles.length;
  const vis = new Array<number>(n).fill(0);
  const mark = (i: number) => {
    vis[i] = 1;
  };
  for (const u of allUnits(s)) if (u.owner === p) for (const i of sightFrom(s, u.tile, unitSight(s, u.id))) mark(i);
  for (const c of allCities(s)) if (c.owner === p) for (const i of sightFrom(s, c.tile, 2)) mark(i);
  for (let i = 0; i < n; i++) if (s.map.tiles[i].owner === p) mark(i);
  for (const h of VISIBILITY_HOOKS) for (const i of h(s, p)) mark(i);
  pl.visible = vis;
  for (let i = 0; i < n; i++) if (vis[i]) pl.explored[i] = 1;
  meetVisible(s, p);
}

/** Extra tiles a player sees (spies...). */
export const VISIBILITY_HOOKS: ((s: GameState, p: number) => number[])[] = [];

export function recomputeAllVisibility(s: GameState): void {
  for (const pl of s.players) recomputeVisibility(s, pl.id);
}

/** Reveal tiles (ruin maps etc.). */
export function reveal(s: GameState, p: number, tiles: number[]): void {
  for (const i of tiles) s.players[p].explored[i] = 1;
}

/** Meet anyone whose units, cities or territory player p can see. */
function meetVisible(s: GameState, p: number): void {
  const pl = s.players[p];
  const meet = (q: number, at: number) => {
    if (q === p || q < 0 || s.players[q].isBarbarian || pl.met.includes(q) || !s.players[q].alive) return;
    pl.met.push(q);
    s.players[q].met.push(p);
    const f = s.players[q];
    notify(s, p, `You met the ${f.name}, led by ${f.leader}.`, 'info', at);
    notify(s, q, `You met the ${pl.name}, led by ${pl.leader}.`, 'info', at);
  };
  for (const u of allUnits(s)) if (pl.visible[u.tile]) meet(u.owner, u.tile);
  for (let i = 0; i < pl.visible.length; i++) if (pl.visible[i] && s.map.tiles[i].owner >= 0) meet(s.map.tiles[i].owner, i);
}
