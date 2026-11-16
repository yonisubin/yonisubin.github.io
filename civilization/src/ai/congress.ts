// AI for the World Congress (proposing and voting by self-interest) and spies.
import { D, get } from '../data';
import { applyAction } from '../core/game';
import { capitalOf, majorPlayers, minorPlayers, playerCities, playerUnits, unitDef } from '../core/query';
import type { CongressProposal, GameState } from '../core/state';
import { CONGRESS_AI, delegates, leaderVotesNeeded, proposalProblem } from '../core/systems/congress';
import { opinion } from '../core/systems/diplomacy';
import { luxuryCounts } from '../core/systems/diplomacy';
import { militaryStrength } from '../core/power';
import { spyRole } from '../core/systems/espionage';
import { cityYields } from '../core/systems/yields';

const pers = (s: GameState, p: number) => get(D.factions, s.players[p].faction).leader.personality;

/** How much player p likes a resolution (positive = for). */
export function resolutionValue(s: GameState, p: number, prop: { resolution: string; target?: string | number }): number {
  const me = pers(s, p);
  const t = prop.target;
  switch (prop.resolution) {
    case 'embargo': {
      const q = Number(t);
      if (q === p) return -100;
      return -opinion(s, p, q).total / 2 - s.tradeRoutes.filter((r) => r.owner === p && s.cities[r.to]?.owner === q).length * 10;
    }
    case 'ban_luxury': {
      const have = (luxuryCounts(s, p)[String(t)] ?? 0) > 0;
      return have ? -40 : 5;
    }
    case 'world_religion':
      return s.religions[String(t)]?.founder === p ? 60 : -me.religion * 2;
    case 'world_ideology':
      return s.players[p].ideology === t ? 40 : -20;
    case 'arts_funding':
      return me.culture * 2 - 6;
    case 'science_funding':
      return me.science * 2 - 6;
    case 'scholars': {
      const median = majorPlayers(s).map((x) => x.techs.length).sort((a, b) => a - b)[Math.floor(majorPlayers(s).length / 2)];
      return s.players[p].techs.length <= median ? 20 : 5;
    }
    case 'nuclear_ban': {
      const mine = playerUnits(s, p).some((u) => unitDef(u).nuke);
      return mine ? -40 : 15;
    }
    case 'army_tax': {
      const strengths = majorPlayers(s).map((x) => militaryStrength(s, x.id));
      return militaryStrength(s, p) > Math.max(...strengths) * 0.7 ? -30 : 15;
    }
    case 'heritage': {
      const mine = playerCities(s, p).reduce((a, c) => a + c.buildings.filter((b) => D.buildings.get(b)?.wonder === 'world').length, 0);
      return mine * 5 - 5;
    }
    case 'world_fair': {
      const prod = playerCities(s, p).reduce((a, c) => a + cityYields(s, c).total.production, 0);
      return prod > 60 ? 15 : 0;
    }
    case 'repeal': {
      const [res, target] = String(t).split(':');
      return -resolutionValue(s, p, { resolution: res, target: target || undefined });
    }
  }
  return 0;
}

function candidates(s: GameState, p: number): CongressProposal[] {
  const out: CongressProposal[] = [];
  for (const r of D.resolutions.values()) {
    const targets: (string | number | undefined)[] =
      r.target === 'player' ? majorPlayers(s).filter((x) => x.alive && x.id !== p).map((x) => x.id) :
      r.target === 'luxury' ? [...D.resources.values()].filter((x) => x.kind === 'luxury').map((x) => x.id) :
      r.target === 'religion' ? Object.keys(s.religions) :
      r.target === 'ideology' ? [...D.ideologies.keys()] :
      r.target === 'resolution' ? (s.congress?.active ?? []).map((a) => `${a.resolution}:${a.target ?? ''}`) : [undefined];
    for (const target of targets) {
      const prop = { resolution: r.id, target, proposer: p };
      if (!proposalProblem(s, prop)) out.push(prop);
    }
  }
  return out;
}

CONGRESS_AI.propose = (s, p) => {
  const opts = candidates(s, p)
    .map((x) => ({ x, v: resolutionValue(s, p, x) }))
    .sort((a, b) => b.v - a.v);
  return opts[0] && opts[0].v > 5 ? opts[0].x : null;
};

CONGRESS_AI.vote = (s, p) => {
  const c = s.congress!;
  const total = delegates(s, p).total;
  const normal = c.proposals.filter((x) => !x.leader);
  const values = c.proposals.map((x) => (x.leader ? 0 : resolutionValue(s, p, x)));
  const weight = values.reduce((a, v) => a + Math.abs(v), 0) || 1;
  let left = total;
  return c.proposals.map((x, i) => {
    if (x.leader) {
      // World Leader: ourselves if we're within reach, else our best friend among the leaders.
      if (delegates(s, p).total * 2 >= leaderVotesNeeded(s) || !normal.length) return p;
      const friend = majorPlayers(s)
        .filter((q) => q.alive && q.id !== p)
        .sort((a, b) => opinion(s, p, b.id).total - opinion(s, p, a.id).total)[0];
      return friend && opinion(s, p, friend.id).total > 30 ? friend.id : p;
    }
    const n = Math.min(left, Math.round((total * Math.abs(values[i])) / weight));
    left -= n;
    return Math.abs(values[i]) < 3 ? 0 : Math.sign(values[i]) * n;
  });
};

/** Put idle spies to work. */
export function aiSpies(s: GameState, p: number): void {
  const pl = s.players[p];
  for (const spy of pl.spies) {
    const role = spyRole(s, p, spy);
    if (role !== 'home') continue;
    const atWar = majorPlayers(s).some((q) => q.id !== p && s.diplomacy.war[p][q.id]);
    const cap = capitalOf(s, p);
    if (atWar && cap && !pl.spies.some((x) => x.city === cap.id)) {
      applyAction(s, p, { type: 'moveSpy', spy: spy.id, to: cap.id });
      continue;
    }
    // Steal from a more advanced civilization's best science city.
    const rich = majorPlayers(s)
      .filter((q) => q.alive && q.id !== p && pl.met.includes(q.id) && q.techs.length > pl.techs.length)
      .flatMap((q) => playerCities(s, q.id).filter((c) => pl.explored[c.tile]))
      .sort((a, b) => cityYields(s, b).total.science - cityYields(s, a).total.science)[0];
    if (rich && !pl.spies.some((x) => x.city === rich.id)) {
      applyAction(s, p, { type: 'moveSpy', spy: spy.id, to: rich.id });
      continue;
    }
    // Rig a city-state's elections where we're close behind its ally.
    const cs = minorPlayers(s)
      .filter((m) => m.alive && pl.met.includes(m.id) && m.minor!.ally !== p && m.minor!.ally >= 0)
      .map((m) => playerCities(s, m.id)[0])
      .find((c) => c && pl.explored[c.tile] && !pl.spies.some((x) => x.city === c.id));
    if (cs) {
      applyAction(s, p, { type: 'moveSpy', spy: spy.id, to: cs.id });
      continue;
    }
    if (cap) applyAction(s, p, { type: 'moveSpy', spy: spy.id, to: cap.id });
  }
}
