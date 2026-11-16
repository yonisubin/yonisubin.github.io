// Diplomacy screens: the leader scene (original procedural portrait, stance and the opinion
// breakdown, treaties, actions), the two-column trade screen, AI proposals waiting for an
// answer, and the city-state panel (influence, bonuses, quests, gifts, pledges, bullying).
import { D } from '../data';
import { militaryStrength } from '../core/power';
import { playerCities, playerUnits, unitDef } from '../core/query';
import type { Deal, DealItem, GameState } from '../core/state';
import { strategicResources } from '../core/systems/economy';
import { score } from '../core/systems/economy';
import {
  areFriends,
  dealProblem,
  dealValue,
  denounced,
  hasOpenBorders,
  havePact,
  itemText,
  opinion,
  researchAgreementCost,
  tradeableItems,
} from '../core/systems/diplomacy';
import { canBully, giftInfluence, influence, questText, relation } from '../core/systems/citystates';
import { distance } from '../core/hex';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** An original leader portrait drawn as SVG: shoulders, head and a faction headdress. */
export function portrait(faction: string, c1: string, c2: string, size = 120): string {
  const hat: Record<string, string> = {
    verdant: `<path d="M38 34 q22 -26 44 0 q-6 -4 -10 2 q-6 -10 -12 0 q-6 -10 -12 0 q-4 -6 -10 -2z" fill="#3f8a3c"/><circle cx="60" cy="18" r="5" fill="${c2}"/>`,
    iron: `<path d="M34 40 q26 -40 52 0 v6 h-52z" fill="#6c6f76"/><rect x="57" y="18" width="6" height="24" fill="#4a4d52"/><path d="M34 46 l-6 -14 l10 6z M86 46 l6 -14 l-10 6z" fill="#e8e0d0"/>`,
    sunwake: `<path d="M36 40 q24 -30 48 0z" fill="${c2}"/><path d="M36 40 h48 l-4 6 h-40z" fill="${c1}"/><circle cx="60" cy="24" r="6" fill="#f0c040"/>`,
    starlit: `<path d="M40 36 l20 -16 l20 16" fill="none" stroke="${c2}" stroke-width="4"/><path d="M60 12 l3 7 l7 1 l-5 5 l1 7 l-6 -3 l-6 3 l1 -7 l-5 -5 l7 -1z" fill="#e8f0ff"/>`,
    frostfang: `<path d="M36 42 q24 -28 48 0z" fill="#8a8f96"/><path d="M36 40 q-14 -6 -12 -24 q8 14 16 16z M84 40 q14 -6 12 -24 q-8 14 -16 16z" fill="#e8e4d0"/>`,
    mesa: `<path d="M36 40 h48 l-6 -10 h-36z" fill="${c1}"/><path d="M40 30 l6 -18 l6 16 l8 -20 l8 20 l6 -16 l6 18z" fill="#e0b040"/>`,
  };
  return `<svg viewBox="0 0 120 120" width="${size}" height="${size}" class="portrait">
    <defs><radialGradient id="bg-${faction}"><stop offset="0" stop-color="${c2}" stop-opacity="0.35"/><stop offset="1" stop-color="${c1}" stop-opacity="0.15"/></radialGradient></defs>
    <rect width="120" height="120" rx="14" fill="url(#bg-${faction})"/>
    <path d="M16 120 q8 -40 44 -40 q36 0 44 40z" fill="${c1}"/>
    <path d="M44 84 q16 10 32 0 l-4 -8 h-24z" fill="${c2}"/>
    <ellipse cx="60" cy="56" rx="20" ry="24" fill="#c8a07a"/>
    <ellipse cx="52" cy="54" rx="2.6" ry="2" fill="#2a1a10"/><ellipse cx="68" cy="54" rx="2.6" ry="2" fill="#2a1a10"/>
    <path d="M53 68 q7 4 14 0" stroke="#5a3020" stroke-width="2" fill="none"/>
    ${hat[faction] ?? ''}
  </svg>`;
}

// ---- Leader scene ----

export function leaderHtml(s: GameState, q: number): string {
  const p = s.human;
  const other = s.players[q];
  const f = D.factions.get(other.faction)!;
  const op = opinion(s, q, p);
  const war = s.diplomacy.war[p][q];
  const d = s.diplomacy;
  const treaties = [
    war ? '<b class="bad">At war</b>' : 'At peace',
    d.embassy[p][q] ? 'You have an embassy' : '',
    d.embassy[q][p] ? 'They have an embassy' : '',
    hasOpenBorders(s, q, p) ? `Their borders are open to you (until turn ${d.openBorders[q][p]})` : '',
    hasOpenBorders(s, p, q) ? `Your borders are open to them` : '',
    havePact(s, p, q) ? 'Defensive pact' : '',
    areFriends(s, p, q) ? 'Declared friends' : '',
    denounced(s, p, q) ? 'You denounced them' : '',
    denounced(s, q, p) ? '<span class="bad">They denounced you</span>' : '',
    d.researchAgreements.some((r) => (r.a === p && r.b === q) || (r.a === q && r.b === p)) ? 'Research agreement' : '',
  ].filter(Boolean);
  const line = war ? f.lines.war : op.stance === 'Friendly' ? f.lines.greeting : op.stance === 'Hostile' ? f.lines.war : f.lines.greeting;
  const since = s.turn - d.changed[p][q];
  const parts = op.parts.map((x) => `<tr><td>${esc(x.label)}</td><td class="${x.value < 0 ? 'bad' : 'happy'}">${x.value > 0 ? '+' : ''}${x.value}</td></tr>`).join('');
  return `<div class="dialog"><div class="row head"><h2>${esc(other.leader)}</h2><button class="x" data-a="panel" data-p="relations">✕</button></div>
    <div class="leader">${portrait(other.faction, other.color, other.color2)}
      <div><div class="sub">${esc(other.name)} · ${esc(f.ability.name)}: ${esc(f.ability.description)}</div>
      <p class="quote">“${esc(line)}”</p>
      <div>${other.isHuman ? `Played by <b>${esc(other.nick ?? 'another player')}</b>` : `Mood: <b>${op.stance}</b> (${op.total > 0 ? '+' : ''}${op.total})`} · score ${score(s, q)} · military ${Math.round(militaryStrength(s, q))}</div>
      <div class="note">${treaties.join(' · ')}</div></div></div>
    ${other.isHuman ? '<p class="sub">Offers to another player wait for their answer on their turn.</p>' : `<details><summary>Why they feel this way</summary><table>${parts || '<tr><td class="sub">Nothing in particular.</td></tr>'}</table></details>`}
    <div class="row">
      <button class="primary" data-a="open-trade" data-p="${q}">${war ? 'Negotiate peace' : 'Trade'}</button>
      ${war ? '' : areFriends(s, p, q) ? '' : `<button data-a="friendship" data-p="${q}">Declare friendship</button>`}
      ${war || denounced(s, p, q) ? '' : `<button data-a="denounce" data-p="${q}">Denounce</button>`}
      ${war ? `<button data-a="peace" data-p="${q}">Ask for peace</button>` : `<button data-a="war" data-p="${q}" ${since < D.rules.peaceTurns ? 'disabled title="Peace treaty in force"' : ''}>Declare war</button>`}
      ${other.isHuman ? '' : `<button data-a="demand" data-p="${q}" title="Ask for gold or a resource with nothing in return">Make a demand</button>`}
    </div></div>`;
}

// ---- Trade screen ----

export function tradeHtml(s: GameState, deal: Deal): string {
  const p = deal.a, q = deal.b;
  const mine = tradeableItems(s, p, q, strategicResources(s, p));
  const theirs = tradeableItems(s, q, p, strategicResources(s, q));
  const inDeal = (i: DealItem) => deal.items.findIndex((x) => x.kind === i.kind && x.from === i.from && x.res === i.res && x.city === i.city && x.target === i.target);
  const offerList = (list: DealItem[]) =>
    list
      .filter((i) => inDeal(i) < 0)
      .map((i) => `<button data-a="trade-add" data-i='${esc(JSON.stringify(i))}'>${esc(itemText(s, i))}</button>`)
      .join('');
  const dealList = (side: number) =>
    deal.items
      .map((i, k) => ({ i, k }))
      .filter(({ i }) => i.from === side)
      .map(({ i, k }) => {
        const amount = i.kind === 'gold' || i.kind === 'gpt' ? `<input type="number" min="1" data-a="trade-amount" data-k="${k}" value="${i.amount}">` : '';
        return `<div class="deal-item">${amount}${esc(itemText(s, i))} <button class="x" data-a="trade-remove" data-k="${k}">✕</button></div>`;
      })
      .join('') || '<div class="sub">nothing</div>';
  const problem = deal.items.length ? dealProblem(s, deal) : 'add something to trade';
  const value = !problem && !s.players[q].isHuman ? dealValue(s, q, deal) : 0;
  const ra = deal.items.some((i) => i.kind === 'researchAgreement') ? `<div class="note">A research agreement costs each side ${researchAgreementCost(s, p, q)} gold and pays out after ${D.rules.diplomacy.researchAgreementTurns} turns of peace.</div>` : '';
  return `<div class="dialog wide trade"><div class="row head"><h2>Trade with the ${esc(s.players[q].name)}</h2><button class="x" data-a="close-trade">✕</button></div>
    <div class="trade-cols">
      <div><h4>You can offer</h4><div class="offers">${offerList(mine)}</div></div>
      <div class="deal"><h4>You give</h4>${dealList(p)}<h4>They give</h4>${dealList(q)}
        ${ra}<div class="note">${problem ? esc(problem) : s.players[q].isHuman ? 'They will see your proposal.' : value >= 0 ? '<span class="happy">They would accept this.</span>' : `They want about ${Math.ceil(-value / 10) * 10} gold more in value.`}</div>
        <div class="row"><button class="primary" data-a="trade-propose" ${problem ? 'disabled' : ''}>Propose</button>
        <button data-a="trade-balance" title="Add gold from you to make it acceptable">What would make this work?</button>
        <button data-a="trade-clear">Clear</button></div></div>
      <div><h4>They can offer</h4><div class="offers">${offerList(theirs)}</div></div>
    </div></div>`;
}

/** Add enough of the human's gold (or gold per turn) to make the AI accept. */
export function balanceDeal(s: GameState, deal: Deal): Deal {
  const p = deal.a, q = deal.b;
  const v = dealValue(s, q, deal);
  if (v >= 0) return deal;
  const need = Math.ceil(-v / 5) * 5;
  const items = deal.items.filter((i) => !(i.from === p && i.kind === 'gold'));
  const existing = deal.items.find((i) => i.from === p && i.kind === 'gold')?.amount ?? 0;
  const gold = existing + need;
  if (gold <= s.players[p].gold) return { ...deal, items: [...items, { kind: 'gold', from: p, amount: gold }] };
  const gpt = Math.ceil(need / (D.rules.diplomacy.dealTurns * 0.8));
  return { ...deal, items: [...deal.items, { kind: 'gpt', from: p, amount: gpt }] };
}

// ---- Proposals waiting for the human ----

export function proposalHtml(s: GameState): string {
  const p = s.human;
  const mine = s.diplomacy.proposals.filter((x) => x.deal.b === p);
  if (!mine.length) return '';
  const x = mine[0];
  const from = s.players[x.from];
  const items = (side: number) => x.deal.items.filter((i) => i.from === side).map((i) => esc(itemText(s, i))).join(', ') || 'nothing';
  return `<div class="dialog"><div class="leader">${portrait(from.faction, from.color, from.color2, 90)}<div><h2>${esc(from.leader)}</h2><p class="quote">${esc(x.text)}</p>
    ${x.kind === 'friendship' ? '<p>A public declaration of friendship for 50 turns.</p>' : `<p>They give: <b>${items(x.from)}</b><br>You give: <b>${items(p)}</b></p>`}</div></div>
    <div class="row"><button class="primary" data-a="respond" data-k="0" data-accept="1">Accept</button><button data-a="respond" data-k="0" data-accept="0">${x.kind === 'demand' ? 'Refuse' : 'Decline'}</button></div></div>`;
}

// ---- City-state panel ----

export function cityStateHtml(s: GameState, m: number): string {
  const p = s.human;
  const mp = s.players[m];
  const info = mp.minor!;
  const city = playerCities(s, m)[0];
  const rel = relation(s, m, p);
  const def = D.cityStates.get(info.def);
  const C = D.rules.cityStates;
  const bonus = C.bonuses[info.type];
  const bonusText = (b: Record<string, number>) =>
    Object.entries(b)
      .map(([k, v]) => ({ food_capital: `+${v} food in your capital`, food_all: `+${v} food in every city`, culture: `+${v} culture`, happiness: `+${v} happiness`, faith: `+${v} faith` })[k] ?? `${k} ${v}`)
      .join(', ') || (info.type === 'militaristic' ? 'gifts of military units' : '');
  const bars = s.players
    .filter((x) => !x.isMinor && !x.isBarbarian && x.alive && (x.id === p || s.players[p].met.includes(x.id)) && x.met.includes(m))
    .map((x) => {
      const v = Math.round(influence(s, m, x.id));
      return `<div class="infl"><span class="dot" style="background:${x.color}"></span>${esc(x.id === p ? 'You' : x.name)} <b>${v}</b>${info.ally === x.id ? ' (ally)' : v >= C.friend ? ' (friend)' : ''}<div class="bar"><i style="width:${Math.max(0, Math.min(100, v))}%;background:${x.color}"></i></div></div>`;
    })
    .join('');
  const quests = info.quests.filter((q) => q.until > s.turn).map((q) => `<li>${esc(questText(s, q))} <span class="sub">(${q.until - s.turn} turns${q.done.includes(p) ? ', done' : ''})</span></li>`).join('');
  const war = s.diplomacy.war[p][m];
  const bullyWhy = canBully(s, p, m);
  const gift = (g: number) => `<button data-a="cs-gift" data-m="${m}" data-g="${g}" ${s.players[p].gold < g || war ? 'disabled' : ''}>Gift ${g} gold (+${giftInfluence(s, p, g)})</button>`;
  return `<div class="dialog"><div class="row head"><h2>${esc(mp.name)}</h2><button class="x" data-a="panel" data-p="none">✕</button></div>
    <p class="sub">${info.type[0].toUpperCase() + info.type.slice(1)} city-state · ${info.personality}${def?.luxury ? ` · has ${esc(D.resources.get(def.luxury)!.name)}` : ''}${city ? ` · size ${city.pop}` : ''}</p>
    <p>You are <b>${rel}</b>${info.pledges.includes(p) ? ' · you pledged to protect it' : ''}. Ally: ${info.ally >= 0 ? esc(s.players[info.ally].name) : 'none'}.</p>
    <div class="note">Friends (${C.friend}+): ${esc(bonusText(bonus.friend))}. Ally (${C.ally}+ and highest): ${esc(bonusText(bonus.ally))}, its resources, and it joins your wars.</div>
    ${bars}
    <h4>Quests</h4><ul>${quests || '<li class="sub">None right now.</li>'}</ul>
    <div class="row">${gift(100)}${gift(250)}${gift(500)}</div>
    <div class="row"><button data-a="cs-pledge" data-m="${m}">${info.pledges.includes(p) ? 'Revoke pledge' : 'Pledge to protect'}</button>
      <button data-a="cs-bully" data-m="${m}" data-k="gold" ${bullyWhy ? `disabled title="${esc(bullyWhy)}"` : ''}>Demand tribute</button>
      <button data-a="cs-bully" data-m="${m}" data-k="worker" ${bullyWhy ? `disabled title="${esc(bullyWhy)}"` : ''}>Demand a worker</button>
      ${war ? `<button data-a="peace" data-p="${m}">Make peace</button>` : `<button data-a="war" data-p="${m}">Declare war</button>`}</div></div>`;
}

/** City-states a unit could be gifted to (it stands in or next to their land). */
export function giftTargets(s: GameState, uid: number): number[] {
  const u = s.units[uid];
  if (!u || unitDef(u).class === 'civilian') return [];
  const out: number[] = [];
  for (const mp of s.players) {
    if (!mp.isMinor || !mp.alive || s.diplomacy.war[u.owner][mp.id]) continue;
    const c = playerCities(s, mp.id)[0];
    if (c && (distance(s.map, u.tile, c.tile) <= 3 || s.map.tiles[u.tile].owner === mp.id)) out.push(mp.id);
  }
  return out;
}

export { playerUnits };
