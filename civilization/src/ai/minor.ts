// City-state AI: keep a small garrison (a few of the best units it can build), add defensive and
// growth buildings, shoot at enemies in range, and keep its units close to home.
import { D, get } from '../data';
import { applyAction } from '../core/game';
import { distance, within } from '../core/hex';
import { cityAt, dims, isCivilian, militaryAt, playerCities, playerUnits, unitDef } from '../core/query';
import type { GameState, Unit } from '../core/state';
import { buildableItems, itemCost } from '../core/systems/cities';
import { canAttack, previewAttack } from '../core/systems/combat';
import { availablePromotions } from '../core/systems/units';

export function minorTurn(s: GameState, p: number): void {
  const city = playerCities(s, p)[0];
  if (!city) return;
  const units = playerUnits(s, p);
  const military = units.filter((u) => !isCivilian(u));
  if (!city.queue.length) {
    const options = buildableItems(s, city).filter((q) => q.kind !== 'project' && !(q.kind === 'unit' && (get(D.units, q.id).canFound || get(D.units, q.id).class === 'recon')) && !(q.kind === 'building' && get(D.buildings, q.id).wonder));
    const want = military.length < D.rules.cityStates.maxMilitary;
    const pickFrom = options.filter((q) => (want ? q.kind === 'unit' && !get(D.units, q.id).canBuild : q.kind === 'building'));
    const list = pickFrom.length ? pickFrom : options;
    // Strongest unit, or cheapest building.
    list.sort((a, b) => (a.kind === 'unit' ? get(D.units, b.id).strength - get(D.units, a.id).strength : itemCost(s, p, a) - itemCost(s, p, b)));
    if (list[0]) applyAction(s, p, { type: 'produce', city: city.id, item: list[0] });
  }
  for (const u of units) {
    if (!s.units[u.id]) continue;
    while (u.pendingPromotions > 0) applyAction(s, p, { type: 'promote', unit: u.id, promotion: availablePromotions(u)[0] ?? 'heal' });
    if (isCivilian(u)) continue;
    if (attack(s, p, u)) continue;
    // Stay within two tiles of the city; the strongest unit garrisons it.
    if (!militaryAt(s, city.tile) && u.moves > 0) {
      if (applyAction(s, p, { type: 'move', unit: u.id, to: city.tile }).ok) continue;
    }
    if (distance(dims(s), u.tile, city.tile) > 2) applyAction(s, p, { type: 'move', unit: u.id, to: city.tile });
    else applyAction(s, p, { type: 'order', unit: u.id, order: 'fortify' });
  }
  for (const t of within(dims(s), city.tile, D.rules.city.range)) if (applyAction(s, p, { type: 'cityAttack', city: city.id, to: t }).ok) break;
}

function attack(s: GameState, p: number, u: Unit): boolean {
  const range = unitDef(u).ranged > 0 ? unitDef(u).range : 1;
  for (const t of within(dims(s), u.tile, range)) {
    if (t === u.tile || canAttack(s, u, t) || cityAt(s, t)) continue;
    const pv = previewAttack(s, u, t);
    if (!pv) continue;
    const dealt = (pv.toDefender[0] + pv.toDefender[1]) / 2, taken = (pv.toAttacker[0] + pv.toAttacker[1]) / 2;
    if (pv.ranged || (dealt > taken && taken < u.hp - 20)) return applyAction(s, p, { type: 'attack', unit: u.id, to: t }).ok;
  }
  return false;
}
