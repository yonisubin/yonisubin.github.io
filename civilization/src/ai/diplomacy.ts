// AI diplomacy: wars and peace (by strength, opinion and personality), friendships and
// denouncements, deals with other AIs (luxury swaps, embassies, open borders, research
// agreements, pacts), proposals and demands to human players, and city-state patronage.
import { D, get } from '../data';
import { aiAcceptsPeace, applyAction, setWar } from '../core/game';
import { distance } from '../core/hex';
import { rand } from '../core/rng';
import { capitalOf, majorPlayers, minorPlayers } from '../core/query';
import type { Deal, DealItem, GameState } from '../core/state';
import { militaryStrength } from '../core/power';
import {
  areFriends,
  dealProblem,
  dealValue,
  declareFriendship,
  denounce,
  denounced,
  executeDeal,
  havePact,
  hasOpenBorders,
  luxuryCounts,
  opinion,
  researchAgreementCost,
} from '../core/systems/diplomacy';
import { canBully, giftInfluence, influence, relation } from '../core/systems/citystates';

const pers = (s: GameState, p: number) => get(D.factions, s.players[p].faction).leader.personality;

export function aiDiplomacy(s: GameState, p: number): void {
  const pl = s.players[p];
  const me = pers(s, p);
  for (const q of pl.met) {
    const other = s.players[q];
    if (!other.alive || other.isMinor) continue;
    const op = opinion(s, p, q);
    if (s.diplomacy.war[p][q]) {
      if (!other.isHuman && aiAcceptsPeace(s, p, q) && aiAcceptsPeace(s, q, p)) setWar(s, p, q, false);
      continue;
    }
    // Friendship and denouncements.
    if (op.total >= 35 && !areFriends(s, p, q) && (s.turn + p) % 7 === 0) {
      if (other.isHuman) {
        if (!s.diplomacy.proposals.some((x) => x.from === p && x.deal.b === q))
          s.diplomacy.proposals.push({ deal: { a: p, b: q, items: [] }, from: p, turn: s.turn, kind: 'friendship', text: `${pl.leader} offers a declaration of friendship.` });
      } else if (opinion(s, q, p).total >= 30) declareFriendship(s, p, q);
    }
    if (op.total <= -40 && !denounced(s, p, q) && (s.turn + p) % 9 === 0) denounce(s, p, q);
    // War.
    if (s.turn >= 40 && (s.turn + p) % 5 === 0) considerWar(s, p, q, op.total, me.aggression, me.boldness);
    // Deals.
    if ((s.turn + p + q) % 8 === 0) offerDeal(s, p, q);
  }
  // Demands of weaker human neighbours.
  for (const q of pl.met) {
    const other = s.players[q];
    if (!other.isHuman || !other.alive || s.diplomacy.war[p][q] || other.gold < 50) continue;
    if ((s.turn + p) % 23 !== 0 || me.aggression < 6) continue;
    if (militaryStrength(s, p) > militaryStrength(s, q) * 2 && opinion(s, p, q).total < -5) {
      const gold = Math.min(other.gold, 50 + s.turn);
      s.diplomacy.proposals.push({ deal: { a: p, b: q, items: [{ kind: 'gold', from: q, amount: gold }] }, from: p, turn: s.turn, kind: 'demand', text: `${pl.leader} demands ${gold} gold. "Pay, or we will remember it."` });
    }
  }
  cityStatePolicy(s, p);
}

function considerWar(s: GameState, p: number, q: number, op: number, aggression: number, boldness: number): void {
  if (areFriends(s, p, q) || havePact(s, p, q)) return;
  if (s.turn - s.diplomacy.changed[p][q] < D.rules.peaceTurns * 2) return;
  if (majorPlayers(s).some((x) => x.id !== q && x.id !== p && s.diplomacy.war[p][x.id])) return; // one war at a time
  const capA = capitalOf(s, p), capB = capitalOf(s, q);
  if (!capA || !capB || distance(s.map, capA.tile, capB.tile) > 22) return;
  const mine = militaryStrength(s, p), theirs = militaryStrength(s, q);
  // Their pact partners would join in.
  let allies = 0;
  for (const x of majorPlayers(s)) if (x.id !== q && x.id !== p && havePact(s, x.id, q)) allies += militaryStrength(s, x.id);
  const need = 1.6 - boldness * 0.05 - Math.min(0, op) / 200;
  if (mine > (theirs + allies) * need && rand(s) < (aggression + Math.max(0, -op) / 10) / 40) applyAction(s, p, { type: 'declareWar', target: q });
}

/** Offer a sensible deal: luxury swaps, embassies, open borders, research agreements, pacts. */
function offerDeal(s: GameState, p: number, q: number): void {
  const pending = s.diplomacy.proposals.some((x) => x.from === p && x.deal.b === q);
  if (pending) return;
  const candidates: DealItem[][] = [];
  const mine = luxuryCounts(s, p), theirs = luxuryCounts(s, q);
  const myExtra = Object.keys(mine).filter((r) => mine[r] >= 2 && !(theirs[r] > 0));
  const theirExtra = Object.keys(theirs).filter((r) => theirs[r] >= 2 && !(mine[r] > 0));
  if (myExtra.length && theirExtra.length)
    candidates.push([
      { kind: 'luxury', from: p, res: myExtra[0], amount: 1 },
      { kind: 'luxury', from: q, res: theirExtra[0], amount: 1 },
    ]);
  if (!s.diplomacy.embassy[p][q] || !s.diplomacy.embassy[q][p])
    candidates.push([
      ...(!s.diplomacy.embassy[q][p] ? [{ kind: 'embassy' as const, from: p }] : []),
      ...(!s.diplomacy.embassy[p][q] ? [{ kind: 'embassy' as const, from: q }] : []),
    ]);
  if (opinion(s, p, q).total >= 10 && !hasOpenBorders(s, p, q) && !hasOpenBorders(s, q, p))
    candidates.push([
      { kind: 'openBorders', from: p },
      { kind: 'openBorders', from: q },
    ]);
  const cost = researchAgreementCost(s, p, q);
  if (opinion(s, p, q).total >= 15 && s.players[p].gold > cost * 1.5 && s.players[q].gold > cost && !s.diplomacy.researchAgreements.some((r) => (r.a === p && r.b === q) || (r.a === q && r.b === p)))
    candidates.push([
      { kind: 'researchAgreement', from: p },
      { kind: 'researchAgreement', from: q },
    ]);
  if (areFriends(s, p, q) && !havePact(s, p, q))
    candidates.push([
      { kind: 'defensivePact', from: p },
      { kind: 'defensivePact', from: q },
    ]);
  for (const items of candidates) {
    if (!items.length) continue;
    const deal: Deal = { a: p, b: q, items };
    if (dealProblem(s, deal) || dealValue(s, p, deal) < 0) continue;
    if (s.players[q].isHuman) {
      s.diplomacy.proposals.push({ deal, from: p, turn: s.turn, kind: 'deal', text: `${s.players[p].leader} proposes a deal.` });
      return;
    }
    if (dealValue(s, q, deal) >= 0) {
      executeDeal(s, deal, setWar);
      return;
    }
  }
}

/** Gifts to city-states close to the next threshold; bullying for the aggressive. */
function cityStatePolicy(s: GameState, p: number): void {
  const pl = s.players[p];
  const me = pers(s, p);
  for (const mp of minorPlayers(s)) {
    if (!mp.alive || !pl.met.includes(mp.id) || s.diplomacy.war[p][mp.id]) continue;
    const inf = influence(s, mp.id, p);
    const rel = relation(s, mp.id, p);
    if (me.cityStateInterest >= 5 && pl.gold > 400 && rel !== 'ally') {
      const goal = rel === 'friend' ? D.rules.cityStates.ally + 5 : D.rules.cityStates.friend + 5;
      const gift = Math.min(pl.gold - 250, 250);
      if (gift > 0 && inf + giftInfluence(s, p, gift) >= goal - 20) applyAction(s, p, { type: 'giftGold', minor: mp.id, amount: gift });
    }
    if (me.aggression >= 7 && (s.turn + mp.id) % 17 === 0 && rel !== 'friend' && rel !== 'ally' && !canBully(s, p, mp.id)) applyAction(s, p, { type: 'bully', minor: mp.id, kind: 'gold' });
  }

}
