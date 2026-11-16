// The effects (modifiers) system. Every bonus — faction ability, adopted policies, finished
// policy trees, wonders, and later beliefs and tenets — is an Effect record (see data/schema.ts).
// playerEffects() gathers a player's empire-wide effects (cached until state.modGen changes);
// cityEffects() adds the local effects of wonders in one city. Systems ask for sums by type.
import { D, get, type EffectDef } from '../../data';
import { neighbors } from '../hex';
import { dims, tileAt } from '../query';
import type { City, GameState } from '../state';

export type Fx = EffectDef & { source: string };

/** Sources that later phases add (religion beliefs, ideology tenets, city-state bonuses...). */
export const EFFECT_SOURCES: ((s: GameState, p: number) => Fx[])[] = [];

const cache = new WeakMap<GameState, { gen: number; turn: number; byPlayer: Map<number, Fx[]> }>();

export function bumpEffects(s: GameState): void {
  s.modGen = (s.modGen ?? 0) + 1;
}

export function playerEffects(s: GameState, p: number): Fx[] {
  if (p < 0 || !s.players[p]) return [];
  let c = cache.get(s);
  if (!c || c.gen !== s.modGen || c.turn !== s.turn) {
    c = { gen: s.modGen, turn: s.turn, byPlayer: new Map() };
    cache.set(s, c);
  }
  const hit = c.byPlayer.get(p);
  if (hit) return hit;
  const pl = s.players[p];
  const out: Fx[] = [];
  const add = (list: EffectDef[], source: string) => {
    for (const e of list) out.push({ ...e, source });
  };
  const f = D.factions.get(pl.faction);
  if (f) add(f.ability.effects as EffectDef[], f.ability.name);
  for (const id of pl.policies ?? []) {
    if (id.startsWith('done:')) {
      const t = D.policyTrees.get(id.slice(5));
      if (t) add(t.finisher, `${t.name} (complete)`);
      continue;
    }
    const tree = D.policyTrees.get(id);
    if (tree) add(tree.opener, tree.name);
    const pol = D.policies.get(id);
    if (pol) add(pol.effects, pol.name);
  }
  for (const [w, cid] of Object.entries(s.wonders ?? {})) {
    const city = s.cities[cid];
    if (city && city.owner === p) add(get(D.buildings, w).effects, get(D.buildings, w).name);
  }
  for (const city of Object.values(s.cities)) {
    if (city.owner !== p) continue;
    for (const b of city.buildings) {
      const def = get(D.buildings, b);
      if (def.wonder === 'national') add(def.effects, def.name);
    }
  }
  for (const src of EFFECT_SOURCES) out.push(...src(s, p));
  c.byPlayer.set(p, out);
  return out;
}

/** Effects that apply to a city: the empire's plus its own wonders' local effects. */
export function cityEffects(s: GameState, c: City): Fx[] {
  const out = [...playerEffects(s, c.owner)];
  for (const b of c.buildings) {
    const def = get(D.buildings, b);
    for (const e of def.cityEffects) out.push({ ...e, scope: 'this', source: def.name });
  }
  return out;
}

export function isCoastal(s: GameState, c: City): boolean {
  return neighbors(dims(s), c.tile).some((n) => tileAt(s, n).terrain === 'coast' || tileAt(s, n).terrain === 'ocean');
}

/** Does an effect's scope include this city? */
export function inScope(s: GameState, e: Fx, c: City): boolean {
  switch (e.scope) {
    case 'capital':
      return c.isCapital;
    case 'coastal':
      return isCoastal(s, c);
    default:
      return true;
  }
}

/** Sum `amount` (or `percent`) of effects of a type that pass a filter. */
export function sum(list: Fx[], type: string, field: 'amount' | 'percent' = 'amount', filter: (e: Fx) => boolean = () => true): number {
  let v = 0;
  for (const e of list) if (e.type === type && filter(e)) v += e[field];
  return v;
}

/** Per-cent cost change for something a player builds or buys (cost_pct). */
export function costPct(s: GameState, p: number, target: string | string[]): number {
  const t = Array.isArray(target) ? target : [target];
  return sum(playerEffects(s, p), 'cost_pct', 'percent', (e) => !!e.target && t.includes(e.target));
}
