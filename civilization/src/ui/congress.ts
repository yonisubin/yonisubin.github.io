// World Congress and espionage screens.
import { D } from '../data';
import type { GameState } from '../core/state';
import { delegates, leaderVotesNeeded, proposers, resolutionText, totalDelegates } from '../core/systems/congress';
import { coupChance, rankName, spyRole, stealRate, stealTarget } from '../core/systems/espionage';
import { majorPlayers } from '../core/query';
import { ui } from './store';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function congressHtml(s: GameState): string {
  const p = s.human;
  const c = s.congress;
  const head = `<div class="row head"><h2>World Congress</h2><button class="x" data-a="panel" data-p="none">✕</button></div>`;
  if (!c) return `<div class="dialog">${head}<p class="sub">The World Congress is founded once a civilization has met everyone and reached the Renaissance.</p></div>`;
  const mine = delegates(s, p);
  const draft = ui().votes ?? c.votes[p] ?? c.proposals.map((x) => (x.leader ? -1 : 0));
  const used = c.proposals.reduce((a, x, i) => a + (x.leader ? 0 : Math.abs(draft[i] ?? 0)), 0);
  const props = c.proposals
    .map((x, i) => {
      if (x.leader) {
        const opts = majorPlayers(s)
          .filter((q) => q.alive && (q.id === p || s.players[p].met.includes(q.id)))
          .map((q) => `<option value="${q.id}" ${draft[i] === q.id ? 'selected' : ''}>${esc(q.id === p ? 'You' : q.name)}</option>`)
          .join('');
        return `<tr><td><b>World Leader</b><div class="sub">All your ${mine.total} delegates go to one candidate. ${leaderVotesNeeded(s)} of ${totalDelegates(s)} needed to win.</div></td>
          <td colspan="2"><select data-a="leader-vote" data-i="${i}"><option value="-1">Abstain</option>${opts}</select></td></tr>`;
      }
      const v = draft[i] ?? 0;
      return `<tr><td><b>${esc(resolutionText(s, x))}</b><div class="sub">${esc(D.resolutions.get(x.resolution)?.description ?? '')} — proposed by ${esc(s.players[x.proposer]?.name ?? '?')}</div></td>
        <td>${v > 0 ? `<span class="happy">${v} for</span>` : v < 0 ? `<span class="bad">${-v} against</span>` : 'abstain'}</td>
        <td><button data-a="vote-adj" data-i="${i}" data-d="-1">− / against</button><button data-a="vote-adj" data-i="${i}" data-d="1">+ / for</button></td></tr>`;
    })
    .join('');
  const canPropose = proposers(s).includes(p) && !c.proposals.some((x) => x.proposer === p);
  const propose = canPropose ? proposeForm(s) : '';
  const active = c.active.map((r) => `<li>${esc(resolutionText(s, r))} <span class="sub">(since turn ${r.turn})</span></li>`).join('');
  const table = majorPlayers(s)
    .filter((q) => q.alive && (q.id === p || s.players[p].met.includes(q.id)))
    .map((q) => `<tr><td><span class="dot" style="background:${q.color}"></span>${esc(q.id === p ? 'You' : q.name)}${c.host === q.id ? ' (host)' : ''}</td><td>${delegates(s, q.id).total}</td><td class="sub">${delegates(s, q.id).parts.map((x) => `${esc(x.label)} ${x.value}`).join(', ')}</td></tr>`)
    .join('');
  return `<div class="dialog wide">${head}<div class="end-body">
    <p>${c.un ? 'United Nations' : 'World Congress'} · next session on turn ${c.nextSession} (${c.nextSession - s.turn} turns) · you have <b>${mine.total}</b> delegates (${used} used)</p>
    <h4>This session</h4><table>${props || '<tr><td class="sub">No proposals yet.</td></tr>'}</table>
    <button class="primary" data-a="vote-cast">Cast votes</button> ${c.votes[p] ? '<span class="happy">Votes cast.</span>' : ''}
    ${propose}
    <h4>In force</h4><ul>${active || '<li class="sub">Nothing yet.</li>'}</ul>
    <h4>Delegates</h4><table>${table}</table>
    <h4>History</h4><div class="note">${c.history.slice(-8).reverse().map((h) => `Turn ${h.turn}: ${esc(h.text)}`).join('<br>') || 'No sessions yet.'}</div></div></div>`;
}

function proposeForm(s: GameState): string {
  const res = [...D.resolutions.values()];
  const targets = [
    ...majorPlayers(s).filter((q) => q.alive && q.id !== s.human).map((q) => `<option value="player:${q.id}">${esc(q.name)}</option>`),
    ...[...D.resources.values()].filter((r) => r.kind === 'luxury').map((r) => `<option value="luxury:${r.id}">${esc(r.name)}</option>`),
    ...Object.values(s.religions).map((r) => `<option value="religion:${r.id}">${esc(r.name)}</option>`),
    ...[...D.ideologies.values()].map((i) => `<option value="ideology:${i.id}">${esc(i.name)}</option>`),
    ...(s.congress?.active ?? []).map((r) => `<option value="resolution:${r.resolution}:${r.target ?? ''}">${esc(resolutionText(s, r))}</option>`),
  ].join('');
  return `<h4>Your proposal</h4><div class="row"><select id="prop-res">${res.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select>
    <select id="prop-target"><option value="">(no target)</option>${targets}</select><button data-a="propose">Propose</button></div>
    <p class="sub">Pick a target that fits: a civilization for an embargo, a luxury for a ban, a religion, an ideology, or an active resolution to repeal.</p>`;
}

export function spiesHtml(s: GameState): string {
  const p = s.human;
  const pl = s.players[p];
  const head = `<div class="row head"><h2>Espionage</h2><button class="x" data-a="panel" data-p="none">✕</button></div>`;
  if (!pl.spies.length) return `<div class="dialog">${head}<p class="sub">Your first spy arrives in the Renaissance; more come with each era (and the Signal Bureau).</p></div>`;
  const cities = Object.values(s.cities).filter((c) => pl.explored[c.tile] && !s.players[c.owner].isBarbarian);
  const opts = (sel: number) =>
    `<option value="-1">— at home —</option>` +
    cities
      .sort((a, b) => a.owner - b.owner || a.name.localeCompare(b.name))
      .map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)} (${esc(c.owner === p ? 'yours' : s.players[c.owner].name)})</option>`)
      .join('');
  const rows = pl.spies
    .map((sp) => {
      const role = spyRole(s, p, sp);
      const c = s.cities[sp.city];
      let status = '';
      if (role === 'dead') status = `<span class="bad">dead — replaced on turn ${sp.deadUntil}</span>`;
      else if (role === 'steal') status = `stealing: ${Math.round(sp.progress)}/${stealTarget(s, c.owner)} (+${Math.round(stealRate(s, p, sp))}/turn)`;
      else if (role === 'counter') status = 'counter-intelligence';
      else if (role === 'diplomat') status = 'diplomat (+1 delegate)';
      else if (role === 'rig') status = `rigging elections${coupChance(s, p, sp) ? ` · coup chance ${coupChance(s, p, sp)}%` : ''}`;
      else status = 'awaiting orders';
      return `<tr><td><b>${esc(sp.name)}</b><div class="sub">${rankName(sp.rank)}</div></td><td>${status}</td>
        <td>${role === 'dead' ? '' : `<select data-a="spy-move" data-s="${sp.id}">${opts(sp.city)}</select>
          ${c && c.isCapital && c.owner !== p && !s.players[c.owner].isMinor && !sp.diplomat ? `<button data-a="spy-diplomat" data-s="${sp.id}" data-c="${c.id}">Make diplomat</button>` : ''}
          ${role === 'rig' && coupChance(s, p, sp) ? `<button data-a="spy-coup" data-s="${sp.id}">Stage coup</button>` : ''}`}</td></tr>`;
    })
    .join('');
  return `<div class="dialog wide">${head}<div class="end-body"><p class="sub">In a rival's city a spy steals technology; in a capital you're at peace with it can serve as a diplomat; in a city-state it rigs elections; at home it hunts enemy spies.</p>
    <table><tr><th>Spy</th><th>Doing</th><th>Station</th></tr>${rows}</table></div></div>`;
}
