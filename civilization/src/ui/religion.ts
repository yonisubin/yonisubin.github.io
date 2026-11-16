// Religion and trade screens: the religion panel (pantheon, your faith, world religions,
// reformation), founding/enhancing a religion with a Great Prophet, and choosing a trade route.
import { D, get } from '../data';
import type { GameState } from '../core/state';
import { availableBeliefs, canChoosePantheon, canReform, majority, maxReligions, pantheonCost, prophetCost } from '../core/systems/religion';
import { routeOptions, routesOf, tradeSlots } from '../core/systems/trade';
import { playerYields } from '../core/systems/yields';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function religionHtml(s: GameState): string {
  const p = s.human;
  const pl = s.players[p];
  const faithPerTurn = Math.round(playerYields(s, p).faith);
  let mine = '';
  if (!pl.pantheon) {
    const opts = availableBeliefs(s, 'pantheon');
    mine = `<h4>Choose a pantheon (${pantheonCost(s)} faith; you have ${Math.round(pl.faith)})</h4>
      <div class="items">${opts
        .map((b) => `<button class="pol ${canChoosePantheon(s, p) ? 'avail' : 'locked'}" data-a="pantheon" data-id="${b.id}" ${canChoosePantheon(s, p) ? '' : 'disabled'}>${esc(b.name)}<small>${esc(b.description)}</small></button>`)
        .join('')}</div>`;
  } else {
    const rel = pl.religion ? s.religions[pl.religion] : undefined;
    mine = `<p>Pantheon: <b>${esc(get(D.beliefs, pl.pantheon).name)}</b> — ${esc(get(D.beliefs, pl.pantheon).description)}</p>`;
    if (rel) {
      mine += `<p>Your religion: <b>${esc(rel.name)}</b> (holy city ${esc(s.cities[rel.holyCity]?.name ?? 'lost')}${rel.enhanced ? ', enhanced' : ''})</p>
        <ul>${rel.beliefs.map((b) => `<li><b>${esc(get(D.beliefs, b).name)}</b> (${get(D.beliefs, b).kind}): ${esc(get(D.beliefs, b).description)}</li>`).join('')}</ul>`;
      if (canReform(s, p))
        mine += `<h4>Reformation belief</h4><div class="items">${availableBeliefs(s, 'reformation')
          .map((b) => `<button class="pol avail" data-a="reform" data-id="${b.id}">${esc(b.name)}<small>${esc(b.description)}</small></button>`)
          .join('')}</div>`;
    } else
      mine += `<p class="sub">A Great Prophet appears when you have ${prophetCost(s, p)} faith. ${Object.keys(s.religions).length}/${maxReligions(s)} religions have been founded.</p>`;
  }
  const world = Object.values(s.religions)
    .map((r) => {
      const cities = Object.values(s.cities).filter((c) => majority(c) === r.id);
      const followers = Object.values(s.cities).reduce((a, c) => a + (c.followers[r.id] ?? 0), 0);
      return `<tr><td><b>${esc(r.name)}</b><div class="sub">${r.beliefs.map((b) => esc(get(D.beliefs, b).name)).join(', ')}</div></td><td>${esc(s.players[r.founder].name)}</td><td>${cities.length}</td><td>${followers}</td></tr>`;
    })
    .join('');
  return `<div class="dialog"><div class="row head"><h2>Religion</h2><span class="sub">✦ ${Math.round(pl.faith)} faith (+${faithPerTurn} per turn)</span><button class="x" data-a="panel" data-p="none">✕</button></div>
    ${mine}<h4>World religions</h4><table><tr><th>Religion</th><th>Founder</th><th>Cities</th><th>Followers</th></tr>${world || '<tr><td class="sub">None founded yet.</td></tr>'}</table></div>`;
}

/** Found or enhance with the selected prophet. */
export function prophetHtml(s: GameState, uid: number, mode: 'found' | 'enhance'): string {
  const opt = (kind: 'founder' | 'follower' | 'enhancer', name: string) =>
    `<label>${name}<select id="bel-${kind}">${availableBeliefs(s, kind).map((b) => `<option value="${b.id}" title="${esc(b.description)}">${esc(b.name)} — ${esc(b.description)}</option>`).join('')}</select></label>`;
  const name = D.religionNames.find((n) => !Object.values(s.religions).some((r) => r.name === n)) ?? 'The Faith';
  return `<div class="dialog"><div class="row head"><h2>${mode === 'found' ? 'Found a religion' : 'Enhance your religion'}</h2><button class="x" data-a="panel" data-p="none">✕</button></div>
    <div class="grid">${mode === 'found' ? `<label>Name<input id="rel-name" value="${esc(name)}"></label>${opt('founder', 'Founder belief')}${opt('follower', 'Follower belief')}` : `${opt('follower', 'Second follower belief')}${opt('enhancer', 'Enhancer belief')}`}</div>
    <button class="primary" data-a="${mode === 'found' ? 'do-found' : 'do-enhance'}" data-u="${uid}">${mode === 'found' ? 'Found it' : 'Enhance'}</button></div>`;
}

export function routesHtml(s: GameState, uid: number): string {
  const u = s.units[uid];
  if (!u) return '';
  const used = routesOf(s, u.owner).length, slots = tradeSlots(s, u.owner);
  const rows = routeOptions(s, u)
    .map((o) => {
      const fmt = (y: Record<string, number | undefined>) => Object.entries(y).filter(([, v]) => v).map(([k, v]) => `+${v} ${k}`).join(', ') || '—';
      return `<tr><td><b>${esc(o.to.name)}</b> <span class="sub">${esc(s.players[o.to.owner].name)} · ${o.path.length - 1} tiles${o.to.owner === u.owner ? ` · sends ${o.carries}` : ''}</span></td>
        <td>${fmt(o.origin)}</td><td>${fmt(o.dest)}</td><td><button data-a="do-route" data-u="${uid}" data-c="${o.to.id}" data-k="${o.carries}" ${used >= slots ? 'disabled' : ''}>Go</button></td></tr>`;
    })
    .join('');
  return `<div class="dialog"><div class="row head"><h2>Trade route</h2><span class="sub">${used}/${slots} routes in use</span><button class="x" data-a="panel" data-p="none">✕</button></div>
    <table><tr><th>Destination</th><th>You get</th><th>They get</th><th></th></tr>${rows || '<tr><td class="sub">No city in range.</td></tr>'}</table></div>`;
}
