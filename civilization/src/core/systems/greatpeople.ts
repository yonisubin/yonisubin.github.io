// Great people. Specialists and some buildings/wonders make great person points; each type has
// its own empire-wide meter, and when it fills the great person appears in the city that pushed
// it over (the next one needs more). Great Generals come from combat XP. Each great person is
// used once: a lump of science/production/gold/culture, a golden age, or a special tile.
import { D, get } from '../../data';
import { eraOf, logEvent, notify, playerCities, tileAt, unitDef, cityAt } from '../query';
import { distance, neighbors } from '../hex';
import type { City, GameState, Unit } from '../state';
import { createUnit, freeTileNear, removeUnit } from './units';
import { cityGreatPeople, playerYields } from './yields';
import { addScience } from './research';
import { startGoldenAge } from './goldenage';
import { itemCost } from './cities';

export function gpThreshold(s: GameState, p: number, type: string): number {
  const g = D.rules.greatPeople;
  const n = s.players[p].gpCount[type] ?? 0;
  const pace = get(D.pace, s.settings.pace).costPct / 100;
  return Math.round((g.base + g.perPerson * n) * pace);
}

export function spawnGreatPerson(s: GameState, p: number, type: string, c: City, count = true): void {
  const gp = get(D.greatPeople, type);
  const pl = s.players[p];
  const at = freeTileNear(s, gp.unit, p, c.tile, 3);
  if (at < 0) return;
  createUnit(s, gp.unit, p, at);
  if (count) pl.gpCount[type] = (pl.gpCount[type] ?? 0) + 1;
  notify(s, p, `A ${gp.name} was born in ${c.name}!`, 'good', c.tile);
  logEvent(s, `A ${gp.name} was born in ${c.name} (${pl.name}).`, c.tile, p);
}

/** End of turn: add every city's points; spawn great people whose meter is full. */
export function processGreatPeople(s: GameState, p: number): void {
  const pl = s.players[p];
  for (const c of playerCities(s, p)) {
    for (const [type, pts] of Object.entries(cityGreatPeople(s, c))) {
      pl.gpPoints[type] = (pl.gpPoints[type] ?? 0) + pts;
      const need = gpThreshold(s, p, type);
      if (pl.gpPoints[type] >= need) {
        pl.gpPoints[type] -= need;
        spawnGreatPerson(s, p, type, c);
      }
    }
  }
}

/** Land combat XP also feeds the Great General meter. */
export function addGeneralPoints(s: GameState, p: number, xp: number, near: number): void {
  const pl = s.players[p];
  if (pl.isBarbarian || xp <= 0) return;
  pl.gpPoints.general = (pl.gpPoints.general ?? 0) + xp * D.rules.greatPeople.generalXpShare;
  const need = gpThreshold(s, p, 'general');
  if (pl.gpPoints.general >= need) {
    pl.gpPoints.general -= need;
    const cities = playerCities(s, p);
    if (!cities.length) return;
    // The general appears near the fighting if possible, else in the nearest city.
    const gp = get(D.greatPeople, 'general');
    const t = freeTileNear(s, gp.unit, p, near, 2);
    if (t >= 0) {
      createUnit(s, gp.unit, p, t);
      pl.gpCount.general = (pl.gpCount.general ?? 0) + 1;
      notify(s, p, 'A Great General rises from the ranks!', 'good', t);
    } else spawnGreatPerson(s, p, 'general', cities[0]);
  }
}

export type GreatPersonUse = 'discover' | 'hurry' | 'trade' | 'golden_age' | 'inspire' | 'concert' | 'improve';

/** What a great person can do where it stands. */
export function greatPersonUses(s: GameState, u: Unit): GreatPersonUse[] {
  const def = unitDef(u);
  const type = def.greatPerson;
  if (!type) return [];
  const out: GreatPersonUse[] = [];
  const t = tileAt(s, u.tile);
  const city = cityAt(s, u.tile);
  if (def.gpImprovement && t.owner === u.owner && !city && D.terrains.get(t.terrain)!.water === false && t.terrain !== 'mountain') out.push('improve');
  if (type === 'scientist') out.push('discover');
  if (type === 'engineer' && city && city.owner === u.owner) out.push('hurry');
  if (type === 'merchant') out.push('trade');
  if (type === 'artist') out.push('golden_age');
  if (type === 'writer') out.push('inspire');
  if (type === 'musician') out.push('concert');
  for (const h of GP_USE_HOOKS) h(s, u, out);
  return out;
}

/** Later phases add uses (great works, religion...). */
export const GP_USE_HOOKS: ((s: GameState, u: Unit, out: GreatPersonUse[]) => void)[] = [];
export const GP_DO_HOOKS: ((s: GameState, u: Unit, use: string) => string | null | undefined)[] = [];

export function describeUse(s: GameState, u: Unit, use: GreatPersonUse): string {
  const g = D.rules.greatPeople;
  const y = playerYields(s, u.owner);
  switch (use) {
    case 'discover':
      return `+${Math.round(y.science * g.scienceTurns + 50)} science`;
    case 'hurry': {
      const c = cityAt(s, u.tile);
      return `+${c ? g.hurryBase + g.hurryPerPop * c.pop : 0} production in this city`;
    }
    case 'trade':
      return `+${g.tradeGold + g.tradePerEra * eraOf(s.players[u.owner])} gold`;
    case 'golden_age':
      return 'Start a golden age';
    case 'inspire':
    case 'concert':
      return `+${Math.round(y.culture * g.cultureTurns + 50)} culture`;
    case 'improve':
      return `Build a ${get(D.improvements, unitDef(u).gpImprovement!).name}`;
  }
}

export function useGreatPerson(s: GameState, u: Unit, use: string): string | null {
  if (!greatPersonUses(s, u).includes(use as GreatPersonUse)) return 'not possible here';
  for (const h of GP_DO_HOOKS) {
    const r = h(s, u, use);
    if (r !== undefined) {
      if (r === null) removeUnit(s, u);
      return r;
    }
  }
  const g = D.rules.greatPeople;
  const p = u.owner;
  const pl = s.players[p];
  const y = playerYields(s, p);
  switch (use) {
    case 'discover':
      addScience(s, p, y.science * g.scienceTurns + 50);
      break;
    case 'hurry': {
      const c = cityAt(s, u.tile)!;
      c.production += g.hurryBase + g.hurryPerPop * c.pop;
      // Don't let the lump overflow wildly past the current item.
      if (c.queue[0]) c.production = Math.min(c.production, itemCost(s, p, c.queue[0]) * 2);
      break;
    }
    case 'trade':
      pl.gold += g.tradeGold + g.tradePerEra * eraOf(pl);
      break;
    case 'golden_age':
      startGoldenAge(s, p);
      break;
    case 'inspire':
    case 'concert': {
      const amount = y.culture * g.cultureTurns + 50;
      pl.culture += amount;
      pl.cultureTotal += amount;
      break;
    }
    case 'improve': {
      const t = tileAt(s, u.tile);
      const imp = unitDef(u).gpImprovement!;
      const def = get(D.improvements, imp);
      if (t.feature && def.clears.includes(t.feature)) t.feature = null;
      t.improvement = imp;
      t.pillaged = false;
      if (imp === 'citadel') {
        // A citadel claims the tiles around it for the nearest of its owner's cities.
        const home = playerCities(s, p).sort((a, b) => distance(s.map, a.tile, u.tile) - distance(s.map, b.tile, u.tile))[0];
        if (home)
          for (const n of neighbors(s.map, u.tile)) {
            const tn = tileAt(s, n);
            if (cityAt(s, n) || (tn.owner >= 0 && tn.owner !== p && s.cities[tn.cityId]?.tile === n)) continue;
            tn.owner = p;
            tn.cityId = home.id;
          }
      }
      break;
    }
  }
  notify(s, p, `Your ${unitDef(u).name} was used: ${describeUse(s, u, use as GreatPersonUse)}.`, 'good', u.tile);
  removeUnit(s, u);
  return null;
}
