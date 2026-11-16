// The World Congress. Founded once someone has met every civilization and reached the
// Renaissance; its first member to qualify is the host. Every session (30 turns) votes on two
// proposals, made by the host and by the member with most delegates. Delegates come from
// era, hosting, allied city-states, diplomats, wonders and world religion/ideology. Once anyone
// knows Globalization it becomes the United Nations, and each session also holds the World
// Leader vote: enough delegates for one candidate wins the diplomatic victory.
import { D, get } from '../../data';
import { eraOf, logEvent, majorPlayers, minorPlayers, notify, capitalOf } from '../query';
import type { CongressProposal, GameState } from '../state';
import { bumpEffects, playerEffects, sum, type Fx } from './effects';

const K = () => D.rules.congress;

export const isActive = (s: GameState, id: string, target?: string | number) =>
  !!s.congress?.active.some((r) => r.resolution === id && (target === undefined || String(r.target) === String(target)));

export function delegates(s: GameState, p: number): { total: number; parts: { label: string; value: number }[] } {
  const pl = s.players[p];
  const parts: { label: string; value: number }[] = [];
  const add = (label: string, value: number) => value && parts.push({ label, value });
  if (!pl.alive || pl.isMinor || pl.isBarbarian) return { total: 0, parts };
  const k = K();
  add('Base', k.baseDelegates + Math.max(0, eraOf(pl) - 3) * k.delegatesPerEraAfter3);
  if (s.congress?.host === p) add('Host', k.hostDelegates);
  add('Allied city-states', minorPlayers(s).filter((m) => m.alive && m.minor!.ally === p).length * k.allyDelegates);
  add('Diplomats', pl.spies.filter((sp) => sp.diplomat && sp.city >= 0 && sp.deadUntil <= s.turn).length * k.diplomatDelegates);
  for (const r of s.congress?.active ?? []) {
    if (r.resolution === 'world_religion' && s.religions[String(r.target)]?.founder === p) add('Faith of the World', k.worldReligionDelegates);
    if (r.resolution === 'world_ideology' && pl.ideology === r.target) add('Doctrine of the World', k.worldIdeologyDelegates);
  }
  add('Wonders', sum(playerEffects(s, p), 'delegates'));
  return { total: parts.reduce((a, x) => a + x.value, 0), parts };
}

export function totalDelegates(s: GameState): number {
  return majorPlayers(s).reduce((a, p) => a + delegates(s, p.id).total, 0);
}

export function leaderVotesNeeded(s: GameState): number {
  return Math.floor((totalDelegates(s) * K().leaderVotePct) / 100) + 1;
}

/** Why a proposal isn't valid now (or null). */
export function proposalProblem(s: GameState, prop: CongressProposal): string | null {
  const res = D.resolutions.get(prop.resolution);
  if (!res) return 'unknown resolution';
  if (res.id !== 'repeal' && isActive(s, res.id, prop.target)) return 'already in force';
  switch (res.target) {
    case 'player':
      if (!s.players[Number(prop.target)]?.alive || s.players[Number(prop.target)].isMinor || Number(prop.target) === prop.proposer) return 'choose another civilization';
      break;
    case 'luxury':
      if (D.resources.get(String(prop.target))?.kind !== 'luxury') return 'choose a luxury';
      break;
    case 'religion':
      if (!s.religions[String(prop.target)]) return 'choose a religion';
      break;
    case 'ideology':
      if (!D.ideologies.has(String(prop.target))) return 'choose an ideology';
      break;
    case 'resolution':
      if (!s.congress?.active.some((r) => `${r.resolution}:${r.target ?? ''}` === String(prop.target))) return 'choose an active resolution';
      break;
  }
  return null;
}

export function resolutionText(s: GameState, prop: { resolution: string; target?: string | number }): string {
  const res = get(D.resolutions, prop.resolution);
  if (prop.target === undefined || prop.target === null || prop.target === '') return res.name;
  const t = prop.target;
  const what =
    res.target === 'player' ? `the ${s.players[Number(t)]?.name}` :
    res.target === 'luxury' ? D.resources.get(String(t))?.name :
    res.target === 'religion' ? s.religions[String(t)]?.name :
    res.target === 'ideology' ? D.ideologies.get(String(t))?.name :
    res.target === 'resolution' ? resolutionText(s, { resolution: String(t).split(':')[0], target: String(t).split(':')[1] || undefined }) : String(t);
  return `${res.name}: ${what}`;
}

/** Who may propose at the next session: the host and the member with most delegates. */
export function proposers(s: GameState): number[] {
  if (!s.congress) return [];
  const host = s.congress.host;
  const other = majorPlayers(s)
    .filter((p) => p.alive && p.id !== host)
    .sort((a, b) => delegates(s, b.id).total - delegates(s, a.id).total || a.id - b.id)[0];
  return other ? [host, other.id] : [host];
}

/** Set by the AI layer: how an AI proposes and votes. */
export const CONGRESS_AI: {
  propose: (s: GameState, p: number) => CongressProposal | null;
  vote: (s: GameState, p: number) => number[];
} = { propose: () => null, vote: (s) => (s.congress?.proposals ?? []).map(() => 0) };

function newSessionProposals(s: GameState): void {
  const c = s.congress!;
  c.proposals = [];
  c.votes = {};
  for (const p of proposers(s)) {
    if (s.players[p].isHuman) continue; // humans propose with an action before the session
    const prop = CONGRESS_AI.propose(s, p);
    if (prop && !proposalProblem(s, prop) && !c.proposals.some((x) => x.resolution === prop.resolution && String(x.target) === String(prop.target))) c.proposals.push(prop);
  }
  if (c.un) c.proposals.push({ resolution: 'world_leader', proposer: -1, leader: true });
  for (const q of majorPlayers(s))
    notify(s, q.id, `The World Congress will meet on turn ${c.nextSession}: ${c.proposals.map((x) => (x.leader ? 'the World Leader vote' : resolutionText(s, x))).join('; ') || 'proposals pending'}.`, 'info');
}

export function propose(s: GameState, p: number, prop: CongressProposal): string | null {
  const c = s.congress;
  if (!c) return 'there is no World Congress yet';
  if (!proposers(s).includes(p)) return 'only the host and the member with most delegates may propose';
  if (c.proposals.some((x) => x.proposer === p)) return 'you already made a proposal for this session';
  const why = proposalProblem(s, prop);
  if (why) return why;
  c.proposals.splice(c.proposals.findIndex((x) => x.leader) >= 0 ? c.proposals.length - 1 : c.proposals.length, 0, prop);
  c.votes = {};
  return null;
}

export function castVotes(s: GameState, p: number, votes: number[]): string | null {
  const c = s.congress;
  if (!c) return 'there is no World Congress yet';
  const max = delegates(s, p).total;
  let used = 0;
  c.proposals.forEach((x, i) => {
    if (!x.leader) used += Math.abs(votes[i] ?? 0);
  });
  if (used > max) return `you only have ${max} delegates`;
  c.votes[p] = votes;
  return null;
}

export function processCongress(s: GameState): void {
  const k = K();
  if (!s.congress) {
    const majors = majorPlayers(s).filter((p) => p.alive);
    const founder = majors.find((p) => eraOf(p) >= k.foundEra && majors.every((q) => q.id === p.id || p.met.includes(q.id)));
    if (!founder) return;
    s.congress = { founded: s.turn, host: founder.id, nextSession: s.turn + k.firstSessionDelay, proposals: [], votes: {}, active: [], un: false, history: [], fair: null };
    logEvent(s, `The World Congress was founded, hosted by the ${founder.name}.`, capitalOf(s, founder.id)?.tile, founder.id);
    for (const q of majorPlayers(s)) notify(s, q.id, `The World Congress has been founded! The ${founder.name} host it.`, 'info');
    newSessionProposals(s);
    return;
  }
  const c = s.congress;
  if (!c.un && majorPlayers(s).some((p) => p.techs.includes(k.unTech))) {
    c.un = true;
    for (const q of majorPlayers(s)) notify(s, q.id, 'The World Congress is now the United Nations: each session will also elect a World Leader.', 'info');
    if (!c.proposals.some((x) => x.leader)) c.proposals.push({ resolution: 'world_leader', proposer: -1, leader: true });
  }
  checkWorldFair(s);
  if (s.turn < c.nextSession) return;
  // Session: every member votes (AIs decide now; humans may have voted already).
  for (const p of majorPlayers(s)) if (p.alive && !p.isHuman && !c.votes[p.id]) c.votes[p.id] = CONGRESS_AI.vote(s, p.id);
  c.proposals.forEach((prop, i) => {
    if (prop.leader) return resolveLeader(s);
    let yes = 0, no = 0;
    for (const v of Object.values(c.votes)) {
      const x = v[i] ?? 0;
      if (x > 0) yes += x;
      else no -= x;
    }
    const passed = yes > no;
    const text = `${resolutionText(s, prop)} — ${passed ? 'passed' : 'failed'} (${yes} for, ${no} against)`;
    c.history.push({ turn: s.turn, text });
    if (passed) enact(s, prop);
    for (const q of majorPlayers(s)) notify(s, q.id, `World Congress: ${text}.`, passed ? 'good' : 'info');
  });
  c.nextSession = s.turn + k.sessionTurns;
  newSessionProposals(s);
  bumpEffects(s);
}

let declare: ((s: GameState, p: number, how: string) => void) | null = null;
export function setDiplomaticWin(f: (s: GameState, p: number, how: string) => void): void {
  declare = f;
}

function resolveLeader(s: GameState): void {
  const c = s.congress!;
  const tally: Record<string, number> = {};
  for (const [p, v] of Object.entries(c.votes)) {
    const cand = v[c.proposals.findIndex((x) => x.leader)];
    if (cand === undefined || cand < 0) continue;
    tally[cand] = (tally[cand] ?? 0) + delegates(s, Number(p)).total;
  }
  const need = leaderVotesNeeded(s);
  const best = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  const text = best ? `World Leader vote: the ${s.players[Number(best[0])].name} got ${best[1]} of ${need} needed` : 'World Leader vote: nobody received votes';
  c.history.push({ turn: s.turn, text });
  for (const q of majorPlayers(s)) notify(s, q.id, text + '.', 'info');
  if (best && best[1] >= need && s.settings.victories.diplomatic) declare?.(s, Number(best[0]), 'were elected World Leader');
}

function enact(s: GameState, prop: CongressProposal): void {
  const c = s.congress!;
  if (prop.resolution === 'repeal') {
    c.active = c.active.filter((r) => `${r.resolution}:${r.target ?? ''}` !== String(prop.target));
    return;
  }
  c.active.push({ resolution: prop.resolution, target: prop.target, turn: s.turn });
  if (prop.resolution === 'world_fair') c.fair = {};
  if (prop.resolution === 'embargo') {
    const t = Number(prop.target);
    s.tradeRoutes = s.tradeRoutes.filter((r) => !(r.owner === t || s.cities[r.to]?.owner === t) || s.cities[r.to]?.owner === r.owner);
    s.diplomacy.deals = s.diplomacy.deals.filter((d) => d.from !== t && d.to !== t);
  }
}

/** World Fair: when the world's contributions reach the goal, reward the contributors. */
function checkWorldFair(s: GameState): void {
  const c = s.congress!;
  if (!c.fair || !isActive(s, 'world_fair')) return;
  const majors = majorPlayers(s).filter((p) => p.alive);
  const goal = K().worldFairPerPlayer * majors.length * (get(D.pace, s.settings.pace).costPct / 100);
  const total = Object.values(c.fair).reduce((a, b) => a + b, 0);
  if (total < goal) return;
  const ranked = Object.entries(c.fair).sort((a, b) => b[1] - a[1]);
  const top = Number(ranked[0][0]);
  s.players[top].freePolicies++;
  notify(s, top, 'You contributed most to the World Fair: a free policy!', 'good');
  for (const [p, v] of ranked)
    if (v >= goal / majors.length / 3) {
      s.players[Number(p)].culture += K().worldFairCulture;
      notify(s, Number(p), `The World Fair is complete: +${K().worldFairCulture} culture.`, 'good');
    }
  logEvent(s, `The World Fair was held; the ${s.players[top].name} contributed most.`, undefined, top);
  c.fair = null;
  c.active = c.active.filter((r) => r.resolution !== 'world_fair');
}

export function contributeToFair(s: GameState, p: number, production: number): void {
  if (!s.congress?.fair) return;
  s.congress.fair[p] = (s.congress.fair[p] ?? 0) + production;
}

/** Effects of active resolutions on a player. */
export function congressEffects(s: GameState, p: number): Fx[] {
  const out: Fx[] = [];
  if (!s.congress) return out;
  const k = K();
  const fx = (type: string, o: Partial<Fx>, source: string): Fx => ({ type, amount: 0, percent: 0, count: 1, scope: 'all', ...o, source }) as Fx;
  for (const r of s.congress.active) {
    const name = get(D.resolutions, r.resolution).name;
    if (r.resolution === 'arts_funding') for (const gp of ['artist', 'writer', 'musician']) out.push(fx('great_people_pct', { gp, percent: k.fundingPct }, name));
    if (r.resolution === 'science_funding') out.push(fx('great_people_pct', { gp: 'scientist', percent: k.fundingPct }, name));
    if (r.resolution === 'scholars') out.push(fx('city_percent', { yield: 'science', percent: k.scholarsPct }, name));
    if (r.resolution === 'army_tax') out.push(fx('upkeep_pct', { target: 'unit', percent: k.armyTaxPct }, name));
    if (r.resolution === 'world_ideology' && s.players[p].ideology === r.target) out.push(fx('happiness', { amount: 2 }, name));
  }
  return out;
}

/** City effects: heritage sites (wonders), the world religion's holy city. */
export function congressCityEffects(s: GameState, c: { id: number; buildings: string[] }): Fx[] {
  const out: Fx[] = [];
  if (!s.congress) return out;
  for (const r of s.congress.active) {
    if (r.resolution === 'heritage') {
      const n = c.buildings.filter((b) => D.buildings.get(b)?.wonder === 'world').length;
      if (n) out.push({ type: 'city_yield', yield: 'culture', amount: n * K().heritageCulture, percent: 0, count: 1, scope: 'this', source: 'Heritage Sites' } as Fx);
    }
    if (r.resolution === 'world_religion' && s.religions[String(r.target)]?.holyCity === c.id)
      out.push({ type: 'city_yield', yield: 'culture', amount: 3, percent: 0, count: 1, scope: 'this', source: 'Faith of the World' } as Fx);
  }
  return out;
}

