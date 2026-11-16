// Culture overview: tourism and influence with every civilization, great works by building
// (with theming), antiquity sites, ideology and public opinion.
import { D, get } from '../data';
import type { GameState } from '../core/state';
import { cityCultureYields, influenceLevel, influencePct, LEVELS, tourismModifier } from '../core/systems/culture';
import { canChooseIdeology, publicOpinion, tenetProblem } from '../core/systems/ideology';
import { canSeeSite } from '../core/systems/archaeology';
import { playerCities } from '../core/query';
import { playerYields } from '../core/systems/yields';
import { canPickPolicy } from '../core/systems/policies';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function cultureHtml(s: GameState): string {
  const p = s.human;
  const pl = s.players[p];
  const tourism = Math.round(playerYields(s, p).tourism);
  const rows = s.players
    .filter((q) => !q.isMinor && !q.isBarbarian && q.id !== p && pl.met.includes(q.id))
    .map((q) => {
      const mine = influenceLevel(s, p, q.id), theirs = influenceLevel(s, q.id, p);
      const pct = Math.round(influencePct(s, p, q.id));
      return `<tr><td><span class="dot" style="background:${q.color}"></span>${esc(q.name)}${q.alive ? '' : ' (gone)'}</td>
        <td><b>${LEVELS[mine]}</b> ${pct}%<div class="bar"><i style="width:${Math.min(100, pct / 2)}%"></i></div><div class="sub">tourism modifier ${tourismModifier(s, p, q.id) >= 0 ? '+' : ''}${tourismModifier(s, p, q.id)}%</div></td>
        <td>${LEVELS[theirs]}</td><td>${q.ideology ? esc(get(D.ideologies, q.ideology).name) : '—'}</td></tr>`;
    })
    .join('');
  const works = playerCities(s, p)
    .flatMap((c) =>
      Object.entries(c.works ?? {}).map(([b, ids]) => {
        const slots = Object.values(get(D.buildings, b).greatWorkSlots).reduce((a, n) => a + n, 0);
        const themed = cityCultureYields(s, c).themed.includes(b);
        return `<tr><td>${esc(c.name)} · ${esc(get(D.buildings, b).name)}${themed ? ' <span class="happy">themed</span>' : ''}</td><td>${ids.map((id) => `“${esc(s.greatWorks[id]?.name ?? '?')}” <span class="sub">${s.greatWorks[id]?.kind}</span>`).join('<br>')}${ids.length < slots ? `<br><span class="sub">${slots - ids.length} empty</span>` : ''}</td></tr>`;
      }),
    )
    .join('');
  const sites = Object.keys(s.antiquity).filter((t) => canSeeSite(s, p, Number(t))).length;
  const op = publicOpinion(s, p);
  let ideology = '';
  if (pl.ideology) {
    ideology = `<p>Ideology: <b>${esc(get(D.ideologies, pl.ideology).name)}</b> · public opinion: <b class="${op.state === 'Content' ? 'happy' : 'bad'}">${op.state}</b>${op.unhappiness ? ` (−${op.unhappiness} happiness)` : ''}${op.preferred ? ` · your people lean toward ${esc(get(D.ideologies, op.preferred).name)}` : ''}${pl.anarchy ? ` · anarchy ${pl.anarchy} turns` : ''}</p>`;
    if (op.preferred && op.state !== 'Content') ideology += `<button data-a="switch-ideology" data-id="${op.preferred}">Switch to ${esc(get(D.ideologies, op.preferred).name)} (lose tenets, anarchy)</button>`;
  } else if (canChooseIdeology(s, p)) ideology = ideologyChoice();
  else ideology = '<p class="sub">An ideology can be chosen in the Industrial era (or with 3 Factories).</p>';
  return `<div class="dialog wide"><div class="row head"><h2>Culture</h2><span class="sub">✈ ${tourism} tourism per turn · lifetime culture ${Math.round(pl.cultureTotal)} · ${sites} antiquity site(s) known</span><button class="x" data-a="panel" data-p="none">✕</button></div>
    <div class="end-body">${ideology}
    <h4>Influence</h4><p class="sub">Your tourism against their lifetime culture: 10% Exotic, 30% Familiar, 60% Popular, 100% Influential, 200% Dominant. Influential over everyone wins a culture victory.</p>
    <table><tr><th>Civilization</th><th>Your influence on them</th><th>Theirs on you</th><th>Ideology</th></tr>${rows || '<tr><td class="sub">You have not met anyone.</td></tr>'}</table>
    <h4>Great works</h4><table>${works || '<tr><td class="sub">No great works yet. Great Artists, Writers and Musicians create them; Archaeologists dig up artifacts.</td></tr>'}</table></div></div>`;
}

export function ideologyChoice(): string {
  return `<h4>Choose an ideology</h4><div class="choices">${[...D.ideologies.values()]
    .map((i) => `<button data-a="choose-ideology" data-id="${i.id}"><b style="color:${i.color}">${esc(i.name)}</b><br><small>${esc(i.description)}</small></button>`)
    .join('')}</div>`;
}

/** Tenet picker for the policies panel. */
export function tenetsHtml(s: GameState): string {
  const p = s.human;
  const pl = s.players[p];
  if (!pl.ideology) return canChooseIdeology(s, p) ? ideologyChoice() : '';
  const ideo = get(D.ideologies, pl.ideology);
  const can = canPickPolicy(s, p);
  const tiers = [1, 2, 3]
    .map((tier) => {
      const ts = ideo.tenets.filter((t) => t.tier === tier);
      return `<div class="tree-card"><b>Tier ${tier}</b><div class="pols">${ts
        .map((t) => {
          const have = pl.policies.includes(t.id);
          const why = tenetProblem(s, p, t.id);
          return `<button class="pol ${have ? 'known' : !why ? 'avail' : 'locked'}" data-a="adopt" data-id="${t.id}" ${have || why || !can ? 'disabled' : ''} title="${esc(why ?? '')}">${have ? '✓ ' : ''}${esc(t.name)}<small>${esc(t.description)}</small></button>`;
        })
        .join('')}</div></div>`;
    })
    .join('');
  return `<h4 style="color:${ideo.color}">${esc(ideo.name)} — tenets</h4><div class="trees tenets">${tiers}</div>`;
}
