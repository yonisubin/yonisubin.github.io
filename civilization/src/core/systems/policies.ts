// Social policies. Empire culture accumulates; at the policy cost the player adopts a tree
// (its opener effect) or a policy whose requirements are met; finishing all five policies of a
// tree gives its finisher. Some trees unlock by era and some exclude each other.
// One-shot effects (free units, buildings, techs, policies, great people, golden ages) are
// applied the moment they are gained — by a policy or a wonder.
import { D, get, type EffectDef } from '../../data';
import { eraOf, logEvent, notify, playerCities } from '../query';
import type { GameState } from '../state';
import { bumpEffects, costPct } from './effects';
import { availableTechs, learnTech } from './research';
import { createUnit, freeTileNear } from './units';
import { startGoldenAge } from './goldenage';
import { spawnGreatPerson } from './greatpeople';
import { unitForFaction } from '../../data';

/** Number of policies that count toward the cost (openers and policies, not finishers). */
export function policyCount(s: GameState, p: number): number {
  return s.players[p].policies.filter((x) => !x.startsWith('done:')).length;
}

export function policyCost(s: GameState, p: number): number {
  const r = D.rules.policy;
  const n = policyCount(s, p);
  const cities = Math.max(1, playerCities(s, p).length);
  const pace = get(D.pace, s.settings.pace).costPct / 100;
  let cost = (r.base + Math.pow(r.perPolicy * n, r.exponent)) * (1 + (r.perCityPct / 100) * (cities - 1)) * pace;
  cost *= 1 + costPct(s, p, 'policy') / 100;
  return Math.max(1, Math.round(cost / 5) * 5);
}

/** Why player p can't adopt `id` (a tree to open or a policy), or null. */
export function cannotAdopt(s: GameState, p: number, id: string): string | null {
  const pl = s.players[p];
  if (pl.policies.includes(id)) return 'already adopted';
  const tree = D.policyTrees.get(id);
  if (tree) {
    if (eraOf(pl) < tree.era) return `opens in the ${['Ancient', 'Classical', 'Medieval', 'Renaissance'][tree.era]} era`;
    if (tree.excludes && pl.policies.includes(tree.excludes)) return `can't be combined with ${get(D.policyTrees, tree.excludes).name}`;
    return null;
  }
  const pol = D.policies.get(id);
  if (!pol) return 'unknown policy';
  if (!pl.policies.includes(pol.tree)) return `open ${get(D.policyTrees, pol.tree).name} first`;
  for (const r of pol.requires) if (!pl.policies.includes(r)) return `needs ${D.policies.get(r)!.name}`;
  return null;
}

export function adoptablePolicies(s: GameState, p: number): string[] {
  const out: string[] = [];
  for (const t of D.policyTrees.values()) {
    if (!cannotAdopt(s, p, t.id)) out.push(t.id);
    for (const pol of t.policies) if (!cannotAdopt(s, p, pol.id)) out.push(pol.id);
  }
  return out;
}

/** Can the player pick a policy now (enough culture or a free pick)? */
export function canPickPolicy(s: GameState, p: number): boolean {
  const pl = s.players[p];
  return (pl.freePolicies > 0 || pl.culture >= policyCost(s, p)) && adoptablePolicies(s, p).length > 0;
}

export function adoptPolicy(s: GameState, p: number, id: string): string | null {
  const pl = s.players[p];
  const why = cannotAdopt(s, p, id);
  if (why) return why;
  if (pl.freePolicies > 0) pl.freePolicies--;
  else {
    const cost = policyCost(s, p);
    if (pl.culture < cost) return `needs ${cost} culture`;
    pl.culture -= cost;
  }
  pl.policies.push(id);
  const tree = D.policyTrees.get(id);
  const pol = D.policies.get(id);
  applyOneShots(s, p, tree ? tree.opener : pol!.effects);
  // Finishing a tree.
  const t = tree ?? D.policyTrees.get(pol!.tree)!;
  if (!tree && t.policies.every((x) => pl.policies.includes(x.id)) && !pl.policies.includes(`done:${t.id}`)) {
    pl.policies.push(`done:${t.id}`);
    applyOneShots(s, p, t.finisher);
    notify(s, p, `You completed ${t.name}!`, 'good');
    logEvent(s, `The ${pl.name} completed ${t.name}.`, undefined, p);
  }
  notify(s, p, `Adopted ${tree ? tree.name : pol!.name}.`, 'good');
  bumpEffects(s);
  return null;
}

/** Apply the one-shot effects in a list (the rest are continuous and read from playerEffects). */
export function applyOneShots(s: GameState, p: number, list: EffectDef[], at?: number): void {
  const pl = s.players[p];
  const cities = playerCities(s, p).sort((a, b) => a.founded - b.founded || a.id - b.id);
  const cap = cities.find((c) => c.isCapital) ?? cities[0];
  for (const e of list) {
    switch (e.type) {
      case 'free_unit': {
        const type = unitForFaction(e.unit!, pl.faction);
        const origin = at ?? cap?.tile;
        if (origin === undefined) break;
        for (let k = 0; k < e.count; k++) {
          const t = freeTileNear(s, type, p, origin, 3);
          if (t >= 0) createUnit(s, type, p, t);
        }
        break;
      }
      case 'free_building':
        for (const c of cities.slice(0, e.count)) {
          const b = e.building!;
          if (!c.buildings.some((x) => x === b || D.buildings.get(x)?.replaces === b)) c.buildings.push(b);
        }
        break;
      case 'free_policy':
        pl.freePolicies += e.count;
        break;
      case 'free_tech':
        for (let k = 0; k < e.count; k++) {
          const avail = availableTechs(pl).filter((t) => !D.techs.get(t)!.repeatable);
          if (!avail.length) break;
          // The cheapest available tech (or the current research if it's available).
          const pick = pl.research && avail.includes(pl.research) ? pl.research : avail.sort((a, b) => get(D.techs, a).cost - get(D.techs, b).cost)[0];
          learnTech(s, p, pick);
        }
        break;
      case 'free_great_person': {
        if (!cap) break;
        const types = e.gp ? [e.gp] : ['scientist', 'engineer', 'merchant', 'artist', 'writer', 'musician'];
        // Without a choice UI: the type the empire has fewest of.
        const type = types.sort((a, b) => (pl.gpCount[a] ?? 0) - (pl.gpCount[b] ?? 0))[0];
        for (let k = 0; k < e.count; k++) spawnGreatPerson(s, p, type, cap, false);
        break;
      }
      case 'golden_age':
        startGoldenAge(s, p);
        break;
    }
  }
}
