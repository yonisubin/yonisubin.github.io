// Archaeology. Battles, ruins, cleared camps and razed cities leave antiquity sites behind. Once
// a player knows Archaeology they see them (some stay hidden until Voyaging is completed), and an
// Archaeologist can dig one: either an artifact for a museum slot, or a Landmark tile (culture
// and tourism for whoever owns the land). Digging in someone else's land annoys them.
import { D } from '../../data';
import { rand } from '../rng';
import { cityAt, eraOf, hasTech, majorPlayers, notify, tileAt, unitDef } from '../query';
import type { GameState, Unit } from '../state';
import { playerEffects, sum } from './effects';
import { findSlot, makeGreatWork } from './culture';
import { removeUnit } from './units';

const A = () => D.rules.archaeology;

/** Leave a site on a tile (chance-based for battles). */
export function recordSite(s: GameState, tile: number, kind: string, chancePct = 100): void {
  if (s.antiquity[tile] || cityAt(s, tile)) return;
  if (D.terrains.get(tileAt(s, tile).terrain)!.water || tileAt(s, tile).terrain === 'mountain') return;
  if (rand(s) * 100 >= chancePct) return;
  const era = Math.max(0, ...majorPlayers(s).map(eraOf));
  s.antiquity[tile] = { era, kind, hidden: rand(s) * 100 < A().hiddenSharePct };
}

export function canSeeSite(s: GameState, p: number, tile: number): boolean {
  const site = s.antiquity[tile];
  if (!site || !hasTech(s.players[p], 'archaeology')) return false;
  return !site.hidden || sum(playerEffects(s, p), 'reveal_hidden_sites', 'amount') > 0 || s.players[p].policies.includes('done:voyaging');
}

export function canDig(s: GameState, u: Unit): string | null {
  if (!unitDef(u).archaeology) return 'only archaeologists dig';
  if (!canSeeSite(s, u.owner, u.tile)) return 'no antiquity site here';
  if (u.job) return 'already digging';
  return null;
}

export function startDig(s: GameState, u: Unit, choice: 'artifact' | 'landmark'): string | null {
  const why = canDig(s, u);
  if (why) return why;
  if (choice === 'artifact' && !findSlot(s, u.owner, 'artifact')) return 'no free art slot for an artifact (build a Museum), or make a Landmark';
  u.job = { improvement: `dig_${choice}`, turnsLeft: A().digTurns };
  u.moves = 0;
  return null;
}

/** Called when a dig job finishes. */
export function finishDig(s: GameState, u: Unit, choice: string): void {
  const tile = u.tile;
  const t = tileAt(s, tile);
  if (!s.antiquity[tile]) return;
  delete s.antiquity[tile];
  // makeGreatWork returns null on success; without a slot the dig becomes a landmark.
  if (choice !== 'artifact' || makeGreatWork(s, u.owner, 'artifact') !== null) {
    t.improvement = 'landmark';
    t.feature = t.feature === 'forest' || t.feature === 'jungle' ? null : t.feature;
    t.pillaged = false;
    notify(s, u.owner, 'Your archaeologist uncovered a Landmark.', 'good', tile);
  }
  // Digging in someone else's land annoys them.
  if (t.owner >= 0 && t.owner !== u.owner && !s.players[t.owner].isMinor) {
    s.diplomacy.trades[t.owner][u.owner] -= 3;
    notify(s, t.owner, `The ${s.players[u.owner].name} dug up an antiquity site in your land.`, 'bad', tile);
  }
  removeUnit(s, u);
}

