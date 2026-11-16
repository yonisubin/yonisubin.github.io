// Ideologies. Entering the Industrial era (or having 3 Factories) lets a player choose one of
// three ideologies; afterwards each policy pick may go to one of its tenets instead (tier 2 needs
// two tier-1 tenets per slot, tier 3 two tier-2). Civilizations with a different ideology whose
// culture is popular among your people sway public opinion: dissidents, civil resistance and
// finally a revolutionary wave, with unhappiness — and you may have to switch ideology.
import { D, get } from '../../data';
import { eraOf, logEvent, majorPlayers, notify, playerCities } from '../query';
import type { GameState } from '../state';
import { bumpEffects, playerEffects, sum } from './effects';
import { influenceLevel } from './culture';
import { hasBuilding } from './yields';

const I = () => D.rules.ideology;

export function canChooseIdeology(s: GameState, p: number): boolean {
  const pl = s.players[p];
  if (pl.ideology || pl.isMinor || pl.isBarbarian) return false;
  return eraOf(pl) >= I().era || playerCities(s, p).filter((c) => hasBuilding(c, 'factory')).length >= I().factories;
}

export function chooseIdeology(s: GameState, p: number, id: string): string | null {
  if (!D.ideologies.has(id)) return 'unknown ideology';
  if (!canChooseIdeology(s, p)) return 'not yet';
  const already = majorPlayers(s).filter((x) => x.ideology).length;
  s.players[p].ideology = id;
  // The first civilizations to adopt an ideology get a free tenet.
  if (already < I().freeTenetsFirst) s.players[p].freePolicies++;
  logEvent(s, `The ${s.players[p].name} adopted ${get(D.ideologies, id).name}.`, undefined, p);
  for (const q of majorPlayers(s)) notify(s, q.id, q.id === p ? `You adopted ${get(D.ideologies, id).name}.` : `The ${s.players[p].name} adopted ${get(D.ideologies, id).name}.`, 'info');
  bumpEffects(s);
  return null;
}

/** Why a tenet can't be adopted (or null). */
export function tenetProblem(s: GameState, p: number, id: string): string | null {
  const t = D.tenets.get(id);
  if (!t) return 'unknown tenet';
  const pl = s.players[p];
  if (pl.ideology !== t.ideology) return 'not your ideology';
  if (pl.policies.includes(id)) return 'already adopted';
  const count = (tier: number) => pl.policies.filter((x) => D.tenets.get(x)?.tier === tier).length;
  if (t.tier === 2 && count(2) >= Math.floor(count(1) / 2)) return 'needs two more tier-1 tenets';
  if (t.tier === 3 && count(3) >= Math.floor(count(2) / 2)) return 'needs two more tier-2 tenets';
  return null;
}

export interface PublicOpinion {
  pressure: number;
  state: 'Content' | 'Dissidents' | 'Civil Resistance' | 'Revolutionary Wave';
  unhappiness: number;
  preferred: string | null;
}

export function publicOpinion(s: GameState, p: number): PublicOpinion {
  const pl = s.players[p];
  if (!pl.ideology) return { pressure: 0, state: 'Content', unhappiness: 0, preferred: null };
  const by: Record<string, number> = {};
  for (const q of majorPlayers(s)) {
    if (q.id === p || !q.alive || !q.ideology) continue;
    const lvl = influenceLevel(s, q.id, p);
    if (lvl <= 0) continue;
    by[q.ideology] = (by[q.ideology] ?? 0) + lvl * I().pressurePerLevel;
  }
  const own = by[pl.ideology] ?? 0;
  let foreign = 0, preferred: string | null = null, best = 0;
  for (const [id, v] of Object.entries(by)) {
    if (id === pl.ideology) continue;
    foreign += v;
    if (v > best) [best, preferred] = [v, id];
  }
  const resist = sum(playerEffects(s, p), 'ideology_resist_pct', 'percent');
  const pressure = Math.max(0, Math.round((foreign - own) * (1 - resist / 100)));
  const state = pressure >= I().revolution ? 'Revolutionary Wave' : pressure >= I().resistance ? 'Civil Resistance' : pressure >= I().dissidents ? 'Dissidents' : 'Content';
  return { pressure, state, unhappiness: pressure * I().unhappinessPerPressure, preferred };
}

/** Switch to another ideology: its tenets are lost and a few turns of anarchy follow. */
export function switchIdeology(s: GameState, p: number, id: string): string | null {
  const pl = s.players[p];
  if (!pl.ideology) return 'no ideology yet';
  if (pl.ideology === id || !D.ideologies.has(id)) return 'choose a different ideology';
  pl.policies = pl.policies.filter((x) => !D.tenets.has(x));
  pl.ideology = id;
  pl.anarchy = I().anarchyTurns;
  notify(s, p, `Your people embrace ${get(D.ideologies, id).name}. Anarchy grips the land for ${pl.anarchy} turns.`, 'bad');
  logEvent(s, `The ${pl.name} switched to ${get(D.ideologies, id).name}.`, undefined, p);
  bumpEffects(s);
  return null;
}

/** End of turn: anarchy counts down; revolutionary waves can make cities defect. */
export function processIdeology(s: GameState, happinessOf: (s: GameState, p: number) => number): void {
  for (const pl of majorPlayers(s)) {
    if (!pl.alive) continue;
    if (pl.anarchy > 0) pl.anarchy--;
    const op = publicOpinion(s, pl.id);
    if (op.state !== 'Revolutionary Wave' || happinessOf(s, pl.id) > -20 || s.turn % 10 !== pl.id % 10 || !op.preferred) continue;
    // A city (not the capital) defects to the most influential civilization of the preferred ideology.
    const to = majorPlayers(s)
      .filter((q) => q.alive && q.ideology === op.preferred)
      .sort((a, b) => influenceLevel(s, b.id, pl.id) - influenceLevel(s, a.id, pl.id))[0];
    const city = playerCities(s, pl.id).filter((c) => !c.isCapital).sort((a, b) => a.pop - b.pop)[0];
    if (!to || !city) continue;
    city.owner = to.id;
    for (const t of s.map.tiles) if (t.cityId === city.id) t.owner = to.id;
    notify(s, pl.id, `${city.name} has rebelled and joined the ${to.name}!`, 'bad', city.tile);
    notify(s, to.id, `${city.name} rebelled against the ${pl.name} and joined you!`, 'good', city.tile);
    logEvent(s, `${city.name} defected from the ${pl.name} to the ${to.name}.`, city.tile, to.id);
    bumpEffects(s);
  }
}
