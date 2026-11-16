// Research: tech costs (era cost × pace × difficulty × per-city scaling, minus a discount for
// techs known by players you've met), queueing a target with its prerequisites, and learning.
import { D, get, unitForFaction } from '../../data';
import { costMult, notify, playerCities } from '../query';
import type { GameState, Player } from '../state';

export function availableTechs(pl: Player): string[] {
  return [...D.techs.values()].filter((t) => !pl.techs.includes(t.id) && t.prereqs.every((p) => pl.techs.includes(p))).map((t) => t.id);
}

export function techCost(s: GameState, p: number, tech: string): number {
  const t = get(D.techs, tech);
  const pl = s.players[p];
  const cities = Math.max(1, playerCities(s, p).length);
  const size = get(D.mapSizes, s.settings.mapSize);
  let cost = t.cost * costMult(s, p) * (1 + (size.techCostPerCityPct / 100) * (cities - 1));
  const met = pl.met.filter((q) => s.players[q].alive);
  if (met.length) {
    const knowing = met.filter((q) => s.players[q].techs.includes(tech)).length;
    cost *= 1 - (D.rules.techPlayersMetDiscountPct / 100) * (knowing / met.length);
  }
  return Math.max(1, Math.round(cost));
}

/** Unknown techs needed for `target` (itself included), in an order that respects prerequisites. */
export function techPath(pl: Player, target: string): string[] {
  const out: string[] = [];
  const visit = (id: string) => {
    if (pl.techs.includes(id) || out.includes(id)) return;
    const t = get(D.techs, id);
    // Visit cheaper prerequisites first so the path reads naturally.
    for (const p of [...t.prereqs].sort((a, b) => get(D.techs, a).cost - get(D.techs, b).cost)) visit(p);
    out.push(id);
  };
  visit(target);
  return out;
}

export function setResearch(s: GameState, p: number, target: string): string | null {
  const pl = s.players[p];
  if (!D.techs.has(target)) return 'unknown tech';
  if (pl.techs.includes(target)) return 'already known';
  const path = techPath(pl, target);
  pl.research = path[0];
  pl.researchQueue = path.slice(1);
  return null;
}

export function learnTech(s: GameState, p: number, tech: string): void {
  const pl = s.players[p];
  if (pl.techs.includes(tech)) return;
  pl.techs.push(tech);
  delete pl.techProgress[tech];
  pl.researchQueue = pl.researchQueue.filter((t) => t !== tech);
  if (pl.research === tech) pl.research = pl.researchQueue.shift() ?? null;
  const t = get(D.techs, tech);
  const unlocks = describeUnlocks(tech, pl.faction);
  notify(s, p, `Researched ${t.name}.${unlocks.length ? ' Unlocks: ' + unlocks.join(', ') + '.' : ''}`, 'good');
}

/** Names of what a tech unlocks for a faction. */
export function describeUnlocks(tech: string, faction: string): string[] {
  const out: string[] = [];
  for (const u of D.units.values()) {
    if (u.tech !== tech) continue;
    if (u.faction && u.faction !== faction) continue;
    if (!u.faction && unitForFaction(u.id, faction) !== u.id) continue;
    out.push(u.name);
  }
  for (const b of D.buildings.values()) {
    if (b.tech !== tech || b.auto) continue;
    if (b.faction && b.faction !== faction) continue;
    if (!b.faction && [...D.buildings.values()].some((x) => x.replaces === b.id && x.faction === faction)) continue;
    out.push(b.name);
  }
  for (const i of D.improvements.values()) if (i.tech === tech) out.push(i.name);
  for (const r of D.resources.values()) if (r.revealTech === tech) out.push(`reveals ${r.name}`);
  if (tech === 'the_wheel') out.push('Roads');
  const t = get(D.techs, tech);
  if (t.bridges) out.push('river bridges');
  for (const m of t.tileMods) out.push(`+${m.amount} ${m.yield} on ${get(D.improvements, m.improvement).name}s`);
  return out;
}

/** Put a turn's science into research; overflow carries into the next tech. */
export function addScience(s: GameState, p: number, amount: number): void {
  const pl = s.players[p];
  let left = amount;
  for (let guard = 0; guard < 10 && left > 0; guard++) {
    if (!pl.research) {
      // Nothing chosen: bank it on the cheapest available tech so it isn't wasted.
      const avail = availableTechs(pl);
      if (!avail.length) return;
      if (!pl.isHuman) pl.research = avail.sort((a, b) => techCost(s, p, a) - techCost(s, p, b))[0];
      else {
        const t = avail.sort((a, b) => techCost(s, p, a) - techCost(s, p, b))[0];
        pl.techProgress[t] = (pl.techProgress[t] ?? 0) + left;
        return;
      }
    }
    const tech = pl.research!;
    const cost = techCost(s, p, tech);
    const have = (pl.techProgress[tech] ?? 0) + left;
    if (have >= cost) {
      left = have - cost;
      learnTech(s, p, tech);
    } else {
      pl.techProgress[tech] = have;
      left = 0;
    }
  }
}
