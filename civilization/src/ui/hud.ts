// The HUD: DOM panels drawn from the game state and UI store. Panels are re-rendered as HTML
// strings (only when their HTML changes), and clicks are handled by one delegated listener that
// reads data-a="action" attributes.
import { D, ERA_NAMES, get } from '../data';
import { YIELD_KEYS } from '../data/schema';
import { nextRequiredAction, militaryStrength } from '../core/game';
import { distance, within } from '../core/hex';
import { cityAt, eraOf, playerCities, playerUnits, unitDef, yearOf } from '../core/query';
import type { City, GameState, QueueItem, Unit } from '../core/state';
import {
  buildableItems,
  buyCost,
  cannotBuild,
  canFoundAt,
  cityMaxHp,
  cityStrength,
  claimableTiles,
  itemCost,
  itemDef,
  isProcess,
  borderCost,
  tileBuyCost,
} from '../core/systems/cities';
import { canCityAttack, previewAttack, previewCityAttack } from '../core/systems/combat';
import { autoExplore } from '../core/systems/explore';
import { goldReport, score, strategicResources } from '../core/systems/economy';
import { happinessOf } from '../core/systems/happiness';
import { stepCost } from '../core/systems/movement';
import { availableTechs, describeUnlocks, techCost } from '../core/systems/research';
import { availablePromotions, buildOptions, upgradeCost, upgradeTarget } from '../core/systems/units';
import { cityGreatPeople, cityYields, inGoldenAge, playerYields, resourceVisible, specialistSlots, tileYields } from '../core/systems/yields';
import { deleteSave, listSaves, type SaveSummary } from '../save/db';
import { cannotAdopt, canPickPolicy, policyCost } from '../core/systems/policies';
import { goldenAgeThreshold } from '../core/systems/goldenage';
import { describeUse, gpThreshold, greatPersonUses } from '../core/systems/greatpeople';
import { religionHtml, prophetHtml, routesHtml } from './religion';
import { cultureHtml, tenetsHtml } from './culture';
import { congressHtml, spiesHtml } from './congress';
import { canSeeSite } from '../core/systems/archaeology';
import { influenceLevel, LEVELS } from '../core/systems/culture';
import { faithItems, majority } from '../core/systems/religion';
import { plunderable } from '../core/systems/trade';
import { balanceDeal, cityStateHtml, giftTargets, leaderHtml, proposalHtml, tradeHtml } from './diplomacy';
import { opinion } from '../core/systems/diplomacy';
import { influence, relation } from '../core/systems/citystates';
import { drawEndgame, endgameHtml, hallOfFameHtml, recordHallOfFame } from './endgame';
import { act, endTurn, endTurnLabel, load, nextUnit, quickSave, selectCity, selectUnit, startGame, toast } from './controller';
import { set, store, ui } from './store';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const $ = (id: string) => document.getElementById(id)!;
const ICON: Record<string, string> = { food: '🌾', production: '⚒', gold: '●', science: '⚗', culture: '♪', faith: '✦', tourism: '✈' };
const fmt = (n: number) => (Math.round(n * 10) / 10).toString();
const sign = (n: number) => (n >= 0 ? `+${fmt(n)}` : fmt(n));

function setHtml(el: HTMLElement, html: string): void {
  if (el.dataset.h === html) return;
  el.dataset.h = html;
  el.innerHTML = html;
}

function show(el: HTMLElement, on: boolean): void {
  el.style.display = on ? '' : 'none';
}

let saves: SaveSummary[] = [];
export async function refreshSaves(): Promise<void> {
  try {
    saves = await listSaves();
  } catch {
    saves = [];
  }
  renderHud();
}

// ---------------------------------------------------------------------------------------------

export function renderHud(): void {
  const st = ui();
  const s = st.game;
  show($('setup'), st.setup);
  show($('game-ui'), !st.setup && !!s);
  if (st.setup || !s) {
    renderSetup();
    return;
  }
  renderTop(s);
  renderUnit(s);
  renderCity(s);
  renderNotes(s);
  renderEndTurn(s);
  renderModal(s);
  show($('busy'), st.busy);
  const t = $('toast');
  show(t, !!st.toast);
  if (st.toast) setHtml(t, esc(st.toast));
}

// ---- Top bar ----

function renderTop(s: GameState): void {
  const p = s.human >= 0 ? s.human : 0;
  const pl = s.players[p];
  const y = playerYields(s, p);
  const g = goldReport(s, p);
  const h = happinessOf(s, p);
  const strat = strategicResources(s, p);
  const research = pl.research ? `${get(D.techs, pl.research).name} (${Math.max(1, Math.ceil((techCost(s, p, pl.research) - (pl.techProgress[pl.research] ?? 0)) / Math.max(1, y.science)))})` : 'nothing';
  const res = Object.entries(strat)
    .filter(([id]) => pl.techs.includes(D.resources.get(id)!.revealTech ?? ''))
    .map(([id, r]) => `<span class="chip" title="${esc(D.resources.get(id)!.name)}: ${r.total - r.used} free of ${r.total}">${esc(D.resources.get(id)!.name)} ${r.total - r.used}</span>`)
    .join('');
  setHtml(
    $('topbar'),
    `<span class="logo">⬡ Hexborne</span>
    <button class="chip sci" data-a="panel" data-p="tech" title="Science per turn — click for the tech tree">⚗ ${sign(y.science)} · ${esc(research)}</button>
    <span class="chip gold" title="Cities ${g.cities}, connections ${g.connections}, buildings −${g.buildings}, units −${g.units}, roads −${g.roads}">● ${pl.gold} (${sign(g.net)})</span>
    <span class="chip ${h.net < 0 ? 'bad' : 'happy'}" title="Happiness ${h.happy} − unhappiness ${h.unhappy}. Luxuries: ${esc(h.luxuries.map((l) => D.resources.get(l)!.name).join(', ') || 'none')}">${h.net < 0 ? '☹' : '☺'} ${h.net}</span>
    <button class="chip cult" data-a="panel" data-p="policies" title="Culture per turn — ${pl.culture.toFixed(0)}/${policyCost(s, p)} toward the next policy">♪ ${sign(y.culture)} · ${pl.freePolicies > 0 || pl.culture >= policyCost(s, p) ? '<b>policy!</b>' : `policy ${Math.max(1, Math.ceil((policyCost(s, p) - pl.culture) / Math.max(1, y.culture)))}t`}</button>
    <button class="chip cult" data-a="panel" data-p="culture" title="Tourism per turn — influence, great works, ideology">✈ ${sign(y.tourism)}</button>
    <button class="chip faith" data-a="panel" data-p="religion" title="Faith per turn — pantheon, prophets, missionaries">✦ ${Math.round(pl.faith)} (${sign(y.faith)})</button>
    <span class="chip ${inGoldenAge(s, p) ? 'happy' : ''}" title="Golden age: ${inGoldenAge(s, p) ? `${pl.goldenAge.turnsLeft} turns left` : `${Math.round(pl.goldenAge.points)}/${goldenAgeThreshold(s, p)} points from happiness`}">☀ ${inGoldenAge(s, p) ? `Golden age ${pl.goldenAge.turnsLeft}` : `${Math.round((100 * pl.goldenAge.points) / goldenAgeThreshold(s, p))}%`}</span>
    ${res}
    <span class="spacer"></span>
    <span class="chip">Turn ${s.turn} · ${yearOf(s)}</span>
    <button class="chip" data-a="lens" title="Yield icons on tiles (Y)">${ui().lens ? '◉' : '○'} Yields</button>
    ${s.congress ? `<button class="chip" data-a="panel" data-p="congress">Congress</button>` : ''}
    ${pl.spies.length ? `<button class="chip" data-a="panel" data-p="spies">Spies</button>` : ''}
    <button class="chip" data-a="panel" data-p="victory">Victory</button>
    <button class="chip" data-a="panel" data-p="relations">Relations</button>
    <button class="chip" data-a="panel" data-p="menu">Menu</button>`,
  );
}

// ---- Unit panel ----

function renderUnit(s: GameState): void {
  const el = $('unit');
  const id = ui().selUnit;
  const u = id !== null ? s.units[id] : undefined;
  show(el, !!u);
  if (!u) return;
  const def = unitDef(u);
  const own = u.owner === s.human;
  const pl = s.players[u.owner];
  const moves = `${fmt(u.moves / D.rules.moveScale)}/${fmt(unitDefMoves(u))}`;
  const xpNext = D.rules.xp.thresholds[u.level] ?? D.rules.xp.thresholds[D.rules.xp.thresholds.length - 1];
  const stats = [
    def.strength ? `⚔ ${def.strength}` : '',
    def.ranged ? `➶ ${def.ranged} (range ${def.range})` : '',
    `Moves ${moves}`,
    `HP ${u.hp}`,
    def.class !== 'civilian' ? `XP ${u.xp}/${xpNext}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  let actions = '';
  if (own) {
    const b = (a: string, label: string, title = '', extra = '') => `<button data-a="${a}" ${extra} title="${esc(title)}">${label}</button>`;
    if (u.pendingPromotions > 0) {
      actions += `<div class="promos"><b>Choose a promotion:</b> ${availablePromotions(u)
        .map((p) => b('promote', esc(D.promotions.get(p)!.name), D.promotions.get(p)!.description, `data-p="${p}"`))
        .join('')}${b('promote', 'Heal +50', 'Heal 50 HP instead', 'data-p="heal"')}</div>`;
    }
    if (def.canFound) actions += b('found', 'Found city (B)', canFoundAt(s, u.owner, u.tile) ?? 'Found a city here');
    if (def.canBuild) for (const o of buildOptions(s, u)) actions += b('build', `${esc(o.name)} (${o.turns})`, `${o.turns} turns`, `data-job="${o.job}"`);
    for (const use of greatPersonUses(s, u)) actions += b('gp-use', esc(GP_USE_NAMES[use] ?? use), describeUse(s, u, use), `data-u="${use}"`);
    if (u.job) actions += `<span class="note">Working: ${esc(jobName(u.job.improvement))}, ${u.job.turnsLeft} turn(s) left</span>`;
    if (def.class !== 'civilian') actions += b('order', 'Fortify (F)', 'Dig in: +25% defence, +50% after two turns', 'data-o="fortify"');
    actions += b('order', 'Sleep (S)', 'Skip this unit until woken', 'data-o="sleep"');
    actions += b('order', 'Skip (Space)', 'Done for this turn', 'data-o="skip"');
    actions += b('order', 'Explore (E)', 'Explore automatically', 'data-o="explore"');
    if (u.order !== 'none' || u.exploring || u.path.length) actions += b('order', 'Wake', '', 'data-o="wake"');
    if (def.class !== 'civilian' && s.map.tiles[u.tile].owner !== u.owner) actions += b('pillage', 'Pillage (P)', 'Destroy an improvement or road here');
    const to = upgradeTarget(s, u);
    if (to) actions += b('upgrade', `Upgrade → ${esc(get(D.units, to).name)} (${upgradeCost(s, u)}●)`, 'In your territory');
    // Phase 10: religion, trade, air, admirals.
    if (def.religious === 'prophet' && !pl.religion) actions += b('prophet', 'Found religion', 'Found a religion in this city', 'data-m="found"');
    if (def.religious === 'prophet' && pl.religion && !s.religions[pl.religion]?.enhanced) actions += b('prophet', 'Enhance religion', '', 'data-m="enhance"');
    if (def.religious === 'missionary' || def.religious === 'prophet') actions += b('spread', `Spread religion${u.charges ? ` (${u.charges})` : ''}`, 'In or next to a city');
    if (def.religious === 'inquisitor') actions += b('heresy', 'Remove other religions', 'In one of your cities');
    if (def.religious) actions += b('target', 'Debate', 'Theological combat with an adjacent rival religious unit', 'data-k="theological"');
    if (def.trade) actions += b('routes', 'Trade route…', 'Open a trade route from this city');
    if (def.archaeology && canSeeSite(s, u.owner, u.tile) && !u.job) {
      actions += b('dig', 'Dig: artifact', 'Takes a few turns; the artifact goes to a free art slot', 'data-k="artifact"');
      actions += b('dig', 'Dig: landmark', 'Takes a few turns; leaves a Landmark tile', 'data-k="landmark"');
    }
    if (plunderable(s, u)) actions += b('plunder', 'Plunder caravan', 'Take the gold of an enemy caravan here');
    if (def.domain === 'air' && !def.nuke) actions += b('target', 'Strike', `Range ${def.range}`, 'data-k="strike"');
    if (def.domain === 'air' && def.nuke) actions += b('target', 'Launch nuclear strike', `Range ${def.range}, blast ${def.nuke}`, 'data-k="nuke"');
    if (def.domain === 'air') actions += b('target', 'Rebase', 'Move to another city or carrier', 'data-k="rebase"');
    if (def.greatPerson === 'admiral') actions += b('admiral', 'Heal fleet', 'Heals nearby ships, using up the admiral');
    for (const m of giftTargets(s, u.id)) actions += b('gift-unit', `Gift to ${esc(s.players[m].name)}`, 'Give this unit to the city-state for influence', `data-m="${m}"`);
    actions += b('next-unit', 'Next (.)', 'Next unit needing orders');
    actions += b('delete', 'Disband', 'Remove this unit');
  }
  const promos = u.promotions.length ? `<div class="note">Promotions: ${u.promotions.map((p) => esc(D.promotions.get(p)!.name)).join(', ')}</div>` : '';
  setHtml(
    el,
    `<div class="title"><span class="swatch" style="background:${pl.color};border-color:${pl.color2}">${esc(def.glyph)}</span>
      <div><b>${esc(def.name)}</b><div class="sub">${esc(pl.isBarbarian ? 'Barbarian' : pl.name)} · ${def.class}${u.order !== 'none' ? ` · ${u.order}` : ''}${u.exploring ? ' · exploring' : ''}</div></div>
      <button class="x" data-a="deselect">✕</button></div>
    <div class="stats">${stats}</div>${promos}
    <div class="actions">${actions}</div>`,
  );
}

const GP_USE_NAMES: Record<string, string> = {
  discover: 'Discover', hurry: 'Hurry production', trade: 'Trade mission', golden_age: 'Golden age', inspire: 'Write', concert: 'Concert', improve: 'Build special tile',
};

function unitDefMoves(u: Unit): number {
  let m = unitDef(u).moves;
  for (const p of u.promotions) m += D.promotions.get(p)!.moves;
  return m;
}

function jobName(job: string): string {
  if (job === 'road') return 'Road';
  if (job === 'repair') return 'Repair';
  if (job.startsWith('remove_')) return `Clear ${get(D.features, job.slice(7)).name}`;
  return get(D.improvements, job).name;
}

// ---- City panel ----

function itemTurns(s: GameState, c: City, item: QueueItem, prod: number, progress: number): number {
  return Math.max(1, Math.ceil((itemCost(s, c.owner, item) - progress) / Math.max(0.5, prod)));
}

function renderCity(s: GameState): void {
  const el = $('city');
  const id = ui().selCity;
  const c = id !== null ? s.cities[id] : undefined;
  show(el, !!c);
  if (!c) return;
  const own = c.owner === s.human;
  const pl = s.players[c.owner];
  const r = cityYields(s, c);
  const t = r.total;
  const yields = YIELD_KEYS.filter((k) => (k !== 'faith' && k !== 'tourism') || t[k] > 0).map((k) => `<span class="y ${k}" title="${k}">${ICON[k]} ${fmt(k === 'food' ? r.foodSurplus : t[k])}</span>`).join('');
  const growth =
    r.foodSurplus > 0 ? `grows in ${r.growthTurns} turns` : r.foodSurplus < 0 ? `<span class="bad">starving</span>` : 'not growing';
  let body = '';
  const strength = cityStrength(s, c);
  body += `<div class="stats">Size ${c.pop} · food ${fmt(c.food)}/${r.growthNeeded} (${growth}) · ⛨ ${fmt(strength.value)} · HP ${c.hp}/${cityMaxHp(c)}${c.resistance ? ` · <span class="bad">resistance ${c.resistance}</span>` : ''}${c.puppet ? ' · puppet' : ''}${c.occupied ? ' · occupied' : ''}${c.razing ? ' · <span class="bad">burning</span>' : ''}</div>
  <div class="yields">${yields}</div>
  <div class="stats">Borders: ${fmt(c.culture)}/${borderCost(s, c)} culture to the next tile</div>`;
  if (own) {
    const prod = t.production;
    const head = c.queue[0];
    if (head && isProcess(head)) {
      body += `<h4>Producing</h4><div class="prod"><b>${esc(itemDef(head).name)}</b> — ${D.rules.processPct}% of production becomes ${get(D.projects, head.id).process}</div>`;
    } else if (head) {
      const cost = itemCost(s, c.owner, head);
      body += `<h4>Producing</h4><div class="prod"><b>${esc(itemDef(head).name)}</b> — ${fmt(c.production)}/${cost}, ${itemTurns(s, c, head, prod, c.production)} turns
        <div class="bar"><i style="width:${Math.min(100, (100 * c.production) / cost)}%"></i></div></div>`;
      if (c.queue.length > 1)
        body += `<div class="queue">${c.queue
          .slice(1)
          .map((q, i) => `<span>${esc(itemDef(q).name)} <button class="x" data-a="dequeue" data-i="${i + 1}">✕</button></span>`)
          .join('')}</div>`;
    } else if (!c.puppet) body += `<h4 class="bad">Choose what to build</h4>`;
    if (!c.puppet && !c.razing) {
      const items = buildableItems(s, c);
      const row = (q: QueueItem) => {
        const d = itemDef(q);
        const progress = head && head.kind === q.kind && head.id === q.id ? c.production : 0;
        const turns = itemTurns(s, c, q, prod, progress);
        const gold = buyCost(s, c, q);
        const desc = q.kind === 'unit' ? unitSummary(q.id) : q.kind === 'project' ? get(D.projects, q.id).description : buildingSummary(q.id);
        return `<div class="item" title="${esc(desc)}"><button class="name" data-a="produce" data-k="${q.kind}" data-id="${q.id}">${esc(d.name)} <small>${turns}t</small></button>
          <button data-a="queue" data-k="${q.kind}" data-id="${q.id}" title="Add to queue">+</button>
          <button data-a="buy" data-k="${q.kind}" data-id="${q.id}" ${pl.gold < gold || c.resistance ? 'disabled' : ''} title="Buy now">${gold}●</button></div>`;
      };
      body += `<h4>Units</h4><div class="items">${items.filter((q) => q.kind === 'unit').map(row).join('')}</div>`;
      const blds = items.filter((q) => q.kind === 'building' && !get(D.buildings, q.id).wonder);
      if (blds.length) body += `<h4>Buildings</h4><div class="items">${blds.map(row).join('')}</div>`;
      const wnd = items.filter((q) => q.kind === 'building' && get(D.buildings, q.id).wonder);
      if (wnd.length) body += `<h4>Wonders</h4><div class="items">${wnd.map(row).join('')}</div>`;
      const projects = items.filter((q) => q.kind === 'project');
      if (projects.length)
        body += `<h4>Projects</h4><div class="items">${projects
          .map((q) => {
            const pr = get(D.projects, q.id);
            if (!pr.process) return row(q);
            return `<div class="item" title="${esc(pr.description)}"><button class="name" data-a="produce" data-k="project" data-id="${q.id}">${esc(pr.name)} <small>${pr.process}</small></button></div>`;
          })
          .join('')}</div>`;
      const locked = [...D.buildings.values()].filter((b) => !b.auto && !c.buildings.includes(b.id) && (!b.faction || b.faction === pl.faction) && cannotBuild(s, c, { kind: 'building', id: b.id })?.startsWith('needs'));
      if (locked.length) body += `<div class="note">Later: ${locked.slice(0, 6).map((b) => `${esc(b.name)} (${esc(cannotBuild(s, c, { kind: 'building', id: b.id })!)})`).join(', ')}</div>`;
    }
    body += `<h4>Citizens</h4><div class="row">Focus <select data-a="focus">${['default', 'food', 'production', 'gold', 'science', 'culture']
      .map((f) => `<option value="${f}" ${c.focus === f ? 'selected' : ''}>${f}</option>`)
      .join('')}</select>
      <label><input type="checkbox" data-a="avoid-growth" ${c.avoidGrowth ? 'checked' : ''}> Avoid growth</label></div>
      <div class="note">Click a worked tile (circle) to lock or unlock it; click a priced tile next to your border to buy it.</div>`;
    if (within(s.map, c.tile, D.rules.city.range).some((i) => !canCityAttack(s, c, i)))
      body += `<button class="primary" data-a="city-attack">${ui().cityAttack ? 'Choose a target…' : 'City attack'}</button>`;
    if (c.puppet) body += `<button data-a="annex" data-c="${c.id}">Annex this puppet</button>`;
  }
  const slots = specialistSlots(c);
  if (own && Object.keys(slots).length) {
    body += `<h4>Specialists</h4><div class="items">${Object.entries(slots)
      .map(([k, n]) => {
        const sp = get(D.specialists, k);
        const have = c.specialists[k] ?? 0;
        return `<div class="item"><span class="name" title="${esc(Object.entries(sp.yields).map(([y, v]) => `+${v} ${y}`).join(', '))}, ${sp.points} great ${sp.gp} points">${esc(sp.name)} ${have}/${n}</span>
          <button data-a="spec" data-k="${k}" data-d="-1" ${(c.manualSpecialists[k] ?? 0) <= 0 ? 'disabled' : ''}>−</button><button data-a="spec" data-k="${k}" data-d="1" ${have >= n ? 'disabled' : ''}>+</button></div>`;
      })
      .join('')}</div>`;
  }
  const gpp = cityGreatPeople(s, c);
  if (own && Object.keys(gpp).length) body += `<div class="note">Great people points: ${Object.entries(gpp).map(([k, v]) => `${esc(k)} +${fmt(v)}`).join(', ')}</div>`;
  // Religion.
  const fol = Object.entries(c.followers ?? {}).filter(([, v]) => v > 0);
  if (fol.length) body += `<div class="note">Religion: ${fol.map(([r, v]) => `${esc(s.religions[r]?.name ?? r)} ${v}`).join(', ')} (of ${c.pop}) — majority ${esc(s.religions[majority(c) ?? '']?.name ?? 'none')}</div>`;
  if (own) {
    const fi = faithItems(s, c).filter((o) => !o.why);
    if (fi.length)
      body += `<h4>Buy with faith (✦ ${Math.round(pl.faith)})</h4><div class="items">${fi
        .map((o) => `<div class="item"><span class="name">${esc(itemDef(o.item).name)}</span><button data-a="buy-faith" data-k="${o.item.kind}" data-id="${o.item.id}" ${pl.faith < o.cost ? 'disabled' : ''}>${o.cost}✦</button></div>`)
        .join('')}</div>`;
    const routes = s.tradeRoutes.filter((r) => r.from === c.id || r.to === c.id);
    if (routes.length) body += `<div class="note">Trade routes: ${routes.map((r) => `${esc(s.cities[r.from]?.name ?? '?')} → ${esc(s.cities[r.to]?.name ?? '?')} (${r.until - s.turn} turns)`).join(', ')}</div>`;
  }
  const wonders = c.buildings.filter((b) => get(D.buildings, b).wonder);
  if (wonders.length) body += `<h4>Wonders</h4><div class="note">${wonders.map((b) => `<span title="${esc(buildingSummary(b))}">${esc(get(D.buildings, b).name)}</span>`).join(', ')}</div>`;
  body += `<h4>Buildings</h4><div class="note">${c.buildings.filter((b) => !get(D.buildings, b).wonder).map((b) => esc(get(D.buildings, b).name)).join(', ') || 'none yet'}</div>`;
  setHtml(
    el,
    `<div class="title"><span class="swatch" style="background:${pl.color};border-color:${pl.color2}">${c.pop}</span>
      <div><b>${c.isCapital ? '★ ' : ''}${esc(c.name)}</b><div class="sub">${esc(pl.name)}</div></div>
      <button class="x" data-a="close-city">✕</button></div>${!own && !pl.isBarbarian ? `<button data-a="${pl.isMinor ? 'citystate' : 'leader'}" data-p="${pl.id}">Diplomacy</button>` : ''}${body}`,
  );
}

export function unitSummary(id: string): string {
  const u = get(D.units, id);
  const parts = [u.strength ? `Strength ${u.strength}` : '', u.ranged ? `Ranged ${u.ranged}, range ${u.range}` : '', `Moves ${u.moves}`, u.resource ? `Needs ${get(D.resources, u.resource).name}` : ''];
  for (const b of u.bonuses) parts.push(`${b.percent > 0 ? '+' : ''}${b.percent}% vs ${b.vs}`);
  if (u.replaces) parts.push(`Unique: replaces ${get(D.units, u.replaces).name}`);
  if (u.canFound) parts.push('Founds cities');
  if (u.canBuild) parts.push('Builds improvements');
  return parts.filter(Boolean).join('. ');
}

export function buildingSummary(id: string): string {
  const b = get(D.buildings, id);
  const parts: string[] = [];
  for (const k of YIELD_KEYS) if (b.yields[k]) parts.push(`+${b.yields[k]} ${k}`);
  for (const k of YIELD_KEYS) if (b.percent[k]) parts.push(`+${b.percent[k]}% ${k}`);
  for (const k of YIELD_KEYS) if (b.perPop[k]) parts.push(`+${b.perPop[k]} ${k} per citizen`);
  if (b.happiness) parts.push(`+${b.happiness} happiness`);
  if (b.defense) parts.push(`+${b.defense} defence`);
  if (b.hp) parts.push(`+${b.hp} HP`);
  if (b.xp) parts.push(`+${b.xp} XP for new units`);
  if (b.growthKeep) parts.push(`keeps ${b.growthKeep}% food on growth`);
  if (b.endsOccupation) parts.push('ends occupation unhappiness');
  parts.push(`upkeep ${b.maintenance}●`);
  if (b.replaces) parts.push(`Unique: replaces ${get(D.buildings, b.replaces).name}`);
  for (const [k, v] of Object.entries(b.specialists)) parts.push(`${v} ${k} slot${v > 1 ? 's' : ''}`);
  for (const [k, v] of Object.entries(b.greatPeople)) parts.push(`+${v} great ${k} points`);
  for (const e of b.effects) parts.push(`empire: ${effectText(e)}`);
  for (const e of b.cityEffects) parts.push(effectText({ ...e, scope: 'this' }));
  if (b.wonder) parts.unshift(b.wonder === 'world' ? 'World wonder' : 'National wonder');
  if (b.requires.allCities) parts.push(`needs a ${get(D.buildings, b.requires.allCities).name} in every city`);
  return parts.join(', ');
}

// ---- Notifications ----

function renderNotes(s: GameState): void {
  const el = $('notes');
  show(el, ui().selCity === null);
  if (s.human < 0) return setHtml(el, '');
  const notes = s.players[s.human].notifications.filter((n) => n.turn >= s.turn - 1).slice(-7).reverse();
  setHtml(el, notes.map((n) => `<div class="note-card ${n.kind}" data-a="note" ${n.tile !== undefined ? `data-t="${n.tile}"` : ''}>${esc(n.text)}</div>`).join(''));
}

function renderEndTurn(s: GameState): void {
  const label = endTurnLabel();
  const n = s.human >= 0 ? nextRequiredAction(s, s.human) : { kind: 'done' };
  setHtml($('endturn'), `<button class="end ${n.kind === 'done' || n.kind === 'unit' ? '' : 'need'}" data-a="end-turn">${esc(label)}</button>`);
}

// ---- Modals: tech tree, relations, menu, capture, game over ----

function renderModal(s: GameState): void {
  const el = $('modal');
  const st = ui();
  const pl = s.human >= 0 ? s.players[s.human] : s.players[0];
  let html = '';
  let endgame = false;
  if (s.winner && st.panel === 'none' && !st.endClosed) {
    recordHallOfFame(s);
    html = endgameHtml(s, st.endTab, st.endStat, st.replayTurn);
    endgame = true;
  } else if (st.panel === 'none' && s.human >= 0 && proposalHtml(s)) {
    html = proposalHtml(s);
  } else if (pl.pendingCaptures.length && st.panel === 'none' && s.cities[pl.pendingCaptures[0]]) {
    const c = s.cities[pl.pendingCaptures[0]];
    const noRaze = c.wasCapital && c.originalOwner !== c.owner;
    html = `<div class="dialog"><h2>${esc(c.name)} is yours</h2><p>What will you do with the city?</p>
      <div class="choices">
        <button data-a="capture" data-c="${c.id}" data-choice="annex"><b>Annex</b><br><small>Full control. Extra unhappiness until it has a Courthouse.</small></button>
        <button data-a="capture" data-c="${c.id}" data-choice="puppet"><b>Puppet</b><br><small>It runs itself (no say in production), less unhappiness. Can be annexed later.</small></button>
        <button data-a="capture" data-c="${c.id}" data-choice="raze" ${noRaze ? 'disabled' : ''}><b>Raze</b><br><small>${noRaze ? 'An original capital cannot be razed.' : 'Burn it down, one citizen per turn.'}</small></button>
      </div></div>`;
  } else if (st.panel === 'tech') html = techTree(s);
  else if (st.panel === 'relations') html = relations(s);
  else if (st.panel === 'menu') html = menu(s);
  else if (st.panel === 'help') html = help();
  else if (st.panel === 'victory') html = victoryPanel(s);
  else if (st.panel === 'policies') html = policiesPanel(s);
  else if (st.panel === 'leader' && s.players[st.diploWith]) html = leaderHtml(s, st.diploWith);
  else if (st.panel === 'trade' && st.tradeDeal) html = tradeHtml(s, st.tradeDeal);
  else if (st.panel === 'citystate' && s.players[st.diploWith]?.isMinor) html = cityStateHtml(s, st.diploWith);
  else if (st.panel === 'religion') html = religionHtml(s);
  else if (st.panel === 'culture') html = cultureHtml(s);
  else if (st.panel === 'congress') html = congressHtml(s);
  else if (st.panel === 'spies') html = spiesHtml(s);
  else if (st.panel === 'prophet' && s.units[st.panelUnit]) html = prophetHtml(s, st.panelUnit, st.prophetMode);
  else if (st.panel === 'routes' && s.units[st.panelUnit]) html = routesHtml(s, st.panelUnit);
  show(el, !!html);
  setHtml(el, html);
  if (endgame) drawEndgame(s, st.endTab, st.endStat, st.replayTurn);
}

function techTree(s: GameState): string {
  const p = s.human;
  const pl = s.players[p];
  // Column = longest chain of prerequisites (so arrows always go right).
  const depth = new Map<string, number>();
  const dep = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    const t = get(D.techs, id);
    const d = t.prereqs.length ? Math.max(...t.prereqs.map(dep)) + 1 : 0;
    depth.set(id, d);
    return d;
  };
  const techs = [...D.techs.values()];
  techs.forEach((t) => dep(t.id));
  const cols = new Map<number, string[]>();
  for (const t of techs) {
    const d = depth.get(t.id)!;
    if (!cols.has(d)) cols.set(d, []);
    cols.get(d)!.push(t.id);
  }
  const W = 190, H = 64, GX = 46, GY = 12;
  const pos = new Map<string, { x: number; y: number }>();
  for (const [d, ids] of cols) ids.forEach((id, k) => pos.set(id, { x: 16 + d * (W + GX), y: 34 + k * (H + GY) }));
  const width = 16 + cols.size * (W + GX);
  const height = 34 + Math.max(...[...cols.values()].map((c) => c.length)) * (H + GY);
  const sci = Math.max(1, playerYields(s, p).science);
  const avail = availableTechs(pl);
  let lines = '';
  for (const t of techs)
    for (const pre of t.prereqs) {
      const a = pos.get(pre)!, b = pos.get(t.id)!;
      const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2;
      lines += `<path d="M${x1},${y1} C${x1 + GX / 2},${y1} ${x2 - GX / 2},${y2} ${x2},${y2}" class="${pl.techs.includes(pre) ? 'known' : ''}"/>`;
    }
  const eraHeads = [...new Set(techs.map((t) => t.era))]
    .map((e) => {
      const xs = techs.filter((t) => t.era === e).map((t) => pos.get(t.id)!.x);
      return `<div class="era" style="left:${Math.min(...xs)}px">${ERA_NAMES[e]}</div>`;
    })
    .join('');
  const boxes = techs
    .map((t) => {
      const known = pl.techs.includes(t.id);
      const cur = pl.research === t.id;
      const queued = pl.researchQueue.indexOf(t.id);
      const cls = known ? 'known' : cur ? 'current' : queued >= 0 ? 'queued' : avail.includes(t.id) ? 'avail' : 'locked';
      const cost = techCost(s, p, t.id);
      const turns = Math.max(1, Math.ceil((cost - (pl.techProgress[t.id] ?? 0)) / sci));
      const unlocks = describeUnlocks(t.id, pl.faction);
      const { x, y } = pos.get(t.id)!;
      return `<button class="tech ${cls}" style="left:${x}px;top:${y}px;width:${W}px;height:${H}px" data-a="research" data-t="${t.id}" title="${esc(unlocks.join(', ') || 'No unlocks')}">
        <b>${esc(t.name)}</b>${queued >= 0 ? ` <span class="qn">${queued + 2}</span>` : ''}<span class="tt">${known ? '✓' : `${turns}t`}</span>
        <small>${esc(unlocks.slice(0, 3).join(', '))}${unlocks.length > 3 ? '…' : ''}</small></button>`;
    })
    .join('');
  return `<div class="dialog wide"><div class="row head"><h2>Technology</h2><span class="sub">⚗ ${fmt(sci)} per turn · era: ${ERA_NAMES[eraOf(pl)]} · click a tech to research it (and everything it needs)</span><button class="x" data-a="panel" data-p="none">✕</button></div>
    <div class="tree"><div class="tree-inner" style="width:${width}px;height:${height}px"><svg width="${width}" height="${height}">${lines}</svg>${eraHeads}${boxes}</div></div></div>`;
}

function policiesPanel(s: GameState): string {
  const p = s.human;
  const pl = s.players[p];
  const cost = policyCost(s, p);
  const can = canPickPolicy(s, p);
  const trees = [...D.policyTrees.values()]
    .map((t) => {
      const opened = pl.policies.includes(t.id);
      const done = pl.policies.includes(`done:${t.id}`);
      const why = cannotAdopt(s, p, t.id);
      const fx = (list: { type: string }[]) => esc(list.map(effectText).join('; '));
      const pols = t.policies
        .map((x) => {
          const have = pl.policies.includes(x.id);
          const w = cannotAdopt(s, p, x.id);
          return `<button class="pol ${have ? 'known' : !w ? 'avail' : 'locked'}" data-a="adopt" data-id="${x.id}" ${have || w || !can ? 'disabled' : ''} title="${esc(x.description)}${w && !have ? ` — ${esc(w)}` : ''}">${have ? '✓ ' : ''}${esc(x.name)}<small>${esc(x.description)}</small></button>`;
        })
        .join('');
      return `<div class="tree-card ${opened ? 'open' : ''}"><div class="row head"><b>${esc(t.name)}</b>${done ? '<span class="happy">complete</span>' : ''}</div>
        <div class="sub">${esc(t.description)}</div>
        ${opened ? `<div class="note">Opened: ${fx(t.opener)}</div>` : `<button class="${!why && can ? 'primary' : ''}" data-a="adopt" data-id="${t.id}" ${why || !can ? 'disabled' : ''} title="${esc(why ?? '')}">Open ${esc(t.name)}${why ? ` — ${esc(why)}` : ''}</button><div class="note">${fx(t.opener)}</div>`}
        <div class="pols">${pols}</div><div class="note">Completing it: ${fx(t.finisher)}</div></div>`;
    })
    .join('');
  const gpRows = [...D.greatPeople.values()]
    .map((g) => `<span class="chip" title="${esc(g.name)}s born: ${pl.gpCount[g.id] ?? 0}">${esc(g.name.replace('Great ', ''))} ${Math.round(pl.gpPoints[g.id] ?? 0)}/${gpThreshold(s, p, g.id)}</span>`)
    .join(' ');
  return `<div class="dialog wide"><div class="row head"><h2>Policies</h2><span class="sub">Culture ${Math.round(pl.culture)}/${cost}${pl.freePolicies ? ` · ${pl.freePolicies} free` : ''} · ${can ? '<b>pick one</b>' : 'keep making culture'} · golden age ${inGoldenAge(s, p) ? `active (${pl.goldenAge.turnsLeft} turns)` : `${Math.round(pl.goldenAge.points)}/${goldenAgeThreshold(s, p)}`}</span><button class="x" data-a="panel" data-p="none">✕</button></div>
    <div class="row">Great people: ${gpRows}</div>
    <div class="end-body">${tenetsHtml(s)}<div class="trees">${trees}</div></div></div>`;
}

/** Human-readable text for an effect. */
export function effectText(e: { type: string; [k: string]: unknown }): string {
  const x = e as unknown as { type: string; yield?: string; amount: number; percent: number; count: number; scope: string; target?: string; unit?: string; building?: string; gp?: string; class?: string; when?: string; where?: string };
  const sc = x.scope === 'capital' ? ' in the capital' : x.scope === 'coastal' ? ' in coastal cities' : x.scope === 'this' ? ' here' : '';
  const pct = (n: number) => `${n > 0 ? '+' : ''}${n}%`;
  switch (x.type) {
    case 'city_yield':
      return `+${x.amount} ${x.yield}${sc || ' in every city'}`;
    case 'per_pop':
      return `+${x.amount} ${x.yield} per citizen`;
    case 'city_percent':
      return `${pct(x.percent)} ${x.yield}${sc}`;
    case 'growth_pct':
      return `${pct(x.percent)} growth${sc}`;
    case 'tile_yield':
      return `+${x.amount} ${x.yield} on ${x.where} tiles`;
    case 'combat':
      return `${pct(x.percent)} combat ${String(x.when).replace('vs_', 'vs ').replace('_', ' ')}`;
    case 'happiness':
      return `+${x.amount} happiness`;
    case 'luxury_happiness':
      return `+${x.amount} happiness per luxury`;
    case 'happiness_per_building':
      return `+${x.amount} happiness per ${D.buildings.get(x.building!)?.name}`;
    case 'garrison_happiness':
      return `+${x.amount} happiness per garrisoned city`;
    case 'unhappiness_city_pct':
      return `${pct(x.percent)} unhappiness from cities`;
    case 'unhappiness_pop_pct':
      return `${pct(x.percent)} unhappiness from citizens`;
    case 'cost_pct':
      return `${x.target} cost ${pct(x.percent)}`;
    case 'upkeep_pct':
      return `${x.target} upkeep ${pct(x.percent)}`;
    case 'golden_age_length_pct':
      return `golden ages ${pct(x.percent)} longer`;
    case 'golden_age_points_pct':
      return `${pct(x.percent)} golden age points`;
    case 'great_people_pct':
      return `${pct(x.percent)} ${x.gp ? `Great ${x.gp}` : 'great people'} points`;
    case 'xp':
      return `+${x.amount} XP for new units`;
    case 'heal':
      return `+${x.amount} healing`;
    case 'moves':
      return `+${x.amount} movement${x.class ? ` (${x.class})` : ''}`;
    case 'sight':
      return `+${x.amount} sight`;
    case 'defense_pct':
      return `${pct(x.percent)} city defence${sc}`;
    case 'kill_culture':
      return `+${x.amount} culture per kill`;
    case 'kill_gold':
      return `+${x.amount} gold per kill`;
    case 'connection_gold':
      return `+${x.amount} gold per connected city`;
    case 'free_unit':
      return `free ${D.units.get(x.unit!)?.name}${x.count > 1 ? ` ×${x.count}` : ''}`;
    case 'free_building':
      return `free ${D.buildings.get(x.building!)?.name} in ${x.count} cities`;
    case 'free_policy':
      return 'a free policy';
    case 'free_tech':
      return x.count > 1 ? `${x.count} free techs` : 'a free tech';
    case 'free_great_person':
      return `a free ${x.gp ? `Great ${x.gp}` : 'great person'}`;
    case 'golden_age':
      return 'a golden age starts';
    default:
      return EFFECT_TEXT[x.type]?.(x) ?? x.type.replace(/_/g, ' ');
  }
}

/** Text for effect types added by later phases. */
export const EFFECT_TEXT: Record<string, (e: { amount: number; percent: number; yield?: string; [k: string]: unknown }) => string> = {
  cs_decay_pct: (e) => `city-state influence decays ${Math.abs(e.percent)}% slower`,
  cs_resting: (e) => `city-state influence rests ${e.amount} higher`,
  cs_gift_pct: (e) => `+${e.percent}% influence from gifts`,
  cs_bonus_pct: (e) => `+${e.percent}% city-state bonuses`,
  cs_ally_yield: (e) => `+${e.amount} ${e.yield} per allied city-state`,
};

function victoryPanel(s: GameState): string {
  const v = s.settings.victories;
  const majors = s.players.filter((p) => !p.isBarbarian && !p.isMinor);
  const capitals = Object.values(s.cities).filter((c) => c.wasCapital);
  const need = D.rules.spaceship;
  const total = Object.values(need).reduce((a, n) => a + n, 0);
  const rows = majors
    .map((p) => {
      const known = p.id === s.human || s.players[s.human]?.met.includes(p.id);
      const held = capitals.filter((c) => c.owner === p.id).length;
      const parts = Object.entries(need).reduce((a, [k, n]) => a + Math.min(n, p.spaceship[k] ?? 0), 0);
      return `<tr><td><span class="dot" style="background:${known ? p.color : '#555'}"></span>${known ? esc(p.name) : 'Unknown'}</td>
        <td>${p.alive ? held : '—'} / ${capitals.length}</td><td>${p.projects.includes('apollo_program') ? `${parts} / ${total}` : '—'}</td><td>${score(s, p.id)}</td></tr>`;
    })
    .join('');
  const extra =
    `<h4>Culture (${v.culture ? 'on' : 'off'})</h4><p class="sub">Be Influential over every other civilization.</p><table>${majors
      .filter((x) => x.alive)
      .map((x) => {
        const others = majors.filter((y) => y.alive && y.id !== x.id);
        const n = others.filter((y) => influenceLevel(s, x.id, y.id) >= 4).length;
        return `<tr><td>${x.id === s.human || s.players[s.human]?.met.includes(x.id) ? esc(x.name) : 'Unknown'}</td><td>Influential over ${n}/${others.length}</td><td class="sub">${others.map((y) => LEVELS[influenceLevel(s, x.id, y.id)]).join(', ')}</td></tr>`;
      })
      .join('')}</table>` + VICTORY_ROWS.map((f) => f(s)).join('');
  return `<div class="dialog"><div class="row head"><h2>Victory progress</h2><button class="x" data-a="panel" data-p="none">✕</button></div>
    <p class="sub">Domination ${v.domination ? 'on' : 'off'}: hold every original capital. Science ${v.science ? 'on' : 'off'}: build the Apollo Program, then deliver ${total} spaceship parts to your capital.
    Time ${v.time ? 'on' : 'off'}: best score on turn ${s.settings.maxTurns} (${s.settings.maxTurns - s.turn} turns left).</p>
    <table><tr><th>Civilization</th><th>Capitals held</th><th>Spaceship</th><th>Score</th></tr>${rows}</table>${extra}</div>`;
}

/** Extra rows/sections for the victory panel, added by later phases. */
export const VICTORY_ROWS: ((s: GameState) => string)[] = [];

function relations(s: GameState): string {
  const p = s.human;
  const pl = s.players[p];
  const rows = s.players
    .filter((q) => !q.isBarbarian && !q.isMinor && q.id !== p)
    .map((q) => {
      if (!pl.met.includes(q.id)) return `<tr><td colspan="5" class="sub">An unknown civilization</td></tr>`;
      const war = s.diplomacy.war[p][q.id];
      const since = s.turn - s.diplomacy.changed[p][q.id];
      const f = D.factions.get(q.faction)!;
      const btn = !q.alive
        ? 'destroyed'
        : war
          ? `<button data-a="peace" data-p="${q.id}">Propose peace</button>`
          : `<button data-a="war" data-p="${q.id}" ${since < D.rules.peaceTurns ? 'disabled title="Peace treaty in force"' : ''}>Declare war</button>`;
      const op = q.alive ? opinion(s, q.id, p) : null;
      return `<tr><td><span class="dot" style="background:${q.color}"></span><button class="link" data-a="leader" data-p="${q.id}"><b>${esc(q.name)}</b></button><div class="sub">${esc(q.leader)} — ${esc(f.ability.name)}: ${esc(f.ability.description)}</div></td>
        <td>${score(s, q.id)}</td><td>${Math.round(militaryStrength(s, q.id))}</td><td class="${war ? 'bad' : ''}">${war ? 'War' : op ? op.stance : 'Peace'}</td><td>${btn}</td></tr>`;
    })
    .join('');
  return `<div class="dialog"><div class="row head"><h2>Relations</h2><button class="x" data-a="panel" data-p="none">✕</button></div>
    <p class="sub">You: ${esc(pl.name)} — score ${score(s, p)}, military ${Math.round(militaryStrength(s, p))}. ${esc(D.factions.get(pl.faction)!.ability.name)}: ${esc(D.factions.get(pl.faction)!.ability.description)}</p>
    <table><tr><th>Civilization</th><th>Score</th><th>Military</th><th>Mood</th><th></th></tr>${rows}</table>
    <h4>City-states</h4><table>${cityStateRows(s)}</table>
    <h4>Recent diplomacy</h4><div class="note">${s.diplomacy.log.slice(-6).reverse().map((x) => `Turn ${x.turn}: ${esc(x.text)}`).join('<br>') || 'Nothing yet.'}</div></div>`;
}

function cityStateRows(s: GameState): string {
  const p = s.human;
  const rows = s.players
    .filter((m) => m.isMinor && s.players[p].met.includes(m.id))
    .map((m) => `<tr><td><span class="dot" style="background:${m.color}"></span><button class="link" data-a="citystate" data-p="${m.id}">${esc(m.name)}</button> <span class="sub">${m.minor!.type}</span></td>
      <td>${m.alive ? `${Math.round(influence(s, m.id, p))} · ${relation(s, m.id, p)}` : 'conquered'}</td><td>${m.alive && m.minor!.ally >= 0 ? `ally: ${esc(s.players[m.minor!.ally].name)}` : ''}</td></tr>`)
    .join('');
  return rows || '<tr><td class="sub">You have not met any city-states.</td></tr>';
}

function menu(s: GameState): string {
  const list = saves
    .map((v) => `<tr><td><b>${esc(v.name)}</b><div class="sub">${esc(v.faction)} · turn ${v.turn} · ${new Date(v.date).toLocaleString()}</div></td>
      <td><button data-a="load" data-n="${esc(v.name)}">Load</button> <button data-a="delete-save" data-n="${esc(v.name)}">Delete</button></td></tr>`)
    .join('');
  void s;
  return `<div class="dialog"><div class="row head"><h2>Menu</h2><button class="x" data-a="panel" data-p="none">✕</button></div>
    <div class="row"><input id="save-name" placeholder="Save name" value="Turn ${s.turn}"><button class="primary" data-a="save">Save</button>
    <button data-a="quick-save" title="Ctrl+S">Quick save</button><button data-a="quick-load" title="Ctrl+L">Quick load</button></div>
    <table>${list || '<tr><td class="sub">No saves yet.</td></tr>'}</table>
    <div class="row"><button data-a="panel" data-p="help">Controls</button>${s.winner ? '<button data-a="summary">Game summary</button>' : ''}<button data-a="new-game">New game</button></div></div>`;
}

function help(): string {
  return `<div class="dialog"><div class="row head"><h2>Controls</h2><button class="x" data-a="panel" data-p="none">✕</button></div>
  <table class="keys">
  <tr><td>Click</td><td>Select a unit or city; with a unit selected, click a tile to move or attack (right-click works too)</td></tr>
  <tr><td>Drag / WASD / arrows</td><td>Pan the map · wheel or +/− to zoom</td></tr>
  <tr><td>Enter</td><td>End turn · <b>.</b> next unit · <b>Space</b> skip · <b>F</b> fortify · <b>S</b> sleep · <b>E</b> explore</td></tr>
  <tr><td>B</td><td>Found a city · <b>R</b> road · <b>M</b> mine · <b>I</b> farm · <b>P</b> pillage</td></tr>
  <tr><td>T</td><td>Tech tree · <b>Y</b> yield icons · <b>H</b> go to capital · <b>Esc</b> close</td></tr>
  <tr><td>Ctrl+S / Ctrl+L</td><td>Quick save / quick load</td></tr>
  </table>
  <p class="sub">Cities grow from food, build with production and expand borders with culture. Keep your empire happy with luxuries (improve them with Workers), Shrines and Colosseums. Win by holding every other civilization's original capital, or have the best score at the turn limit.</p></div>`;
}

// ---- Setup screen ----

function renderSetup(): void {
  const factions = [...D.factions.values()];
  const opt = (list: { id: string; name: string }[], sel: string) => list.map((x) => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  const cont = saves.find((v) => v.name === 'Autosave');
  const html = `<div class="setup-card">
    <h1>⬡ Hexborne</h1><p class="tag">Found a city. Grow an empire. Outlast them all.</p>
    ${cont ? `<button class="primary big" data-a="load" data-n="Autosave">Continue (${esc(cont.faction)}, turn ${cont.turn})</button>` : ''}
    <button class="primary big" data-a="play-now">Play now</button>
    <details ${cont ? '' : 'open'}><summary>Set up a game</summary>
    <div class="grid">
      <label>Civilization<select id="o-faction"><option value="random">Random</option>${opt(factions, '')}</select></label>
      <label>Map<select id="o-map">${opt([{ id: 'continents', name: 'Continents' }, { id: 'pangaea', name: 'Pangaea' }], 'continents')}</select></label>
      <label>Size<select id="o-size">${opt([...D.mapSizes.values()], 'tiny')}</select></label>
      <label>Difficulty<select id="o-diff">${opt([...D.difficulty.values()], 'prince')}</select></label>
      <label>Pace<select id="o-pace">${opt([...D.pace.values()], 'standard')}</select></label>
      <label>Seed<input id="o-seed" placeholder="random"></label>
      <label class="check"><input type="checkbox" id="o-barb" checked> Barbarians</label>
      <label class="check"><input type="checkbox" id="o-ruins" checked> Ancient ruins</label>
      <label>Turn limit<input id="o-maxturns" type="number" min="50" max="1500" placeholder="by pace"></label>
    </div>
    <div class="row">Victories: ${['domination', 'science', 'culture', 'diplomatic', 'time'].map((v) => `<label class="check"><input type="checkbox" id="o-v-${v}" checked> ${v}</label>`).join(' ')}</div>
    <div id="faction-info" class="sub"></div>
    <button class="primary" data-a="start">Start game</button></details>
    <details><summary>Hall of Fame</summary>${hallOfFameHtml()}</details>
    ${saves.length ? `<details><summary>Load a saved game</summary><table>${saves.map((v) => `<tr><td>${esc(v.name)} <span class="sub">${esc(v.faction)}, turn ${v.turn}</span></td><td><button data-a="load" data-n="${esc(v.name)}">Load</button></td></tr>`).join('')}</table></details>` : ''}
  </div>`;
  const el = $('setup');
  if (el.dataset.h !== html) {
    // Keep the player's choices when the setup screen re-renders.
    const keep: Record<string, string | boolean> = {};
    el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('select, input').forEach((i) => (keep[i.id] = i instanceof HTMLInputElement && i.type === 'checkbox' ? i.checked : i.value));
    setHtml(el, html);
    for (const [k, v] of Object.entries(keep)) {
      const i = document.getElementById(k) as HTMLInputElement | null;
      if (!i) continue;
      if (typeof v === 'boolean') i.checked = v;
      else i.value = v;
    }
    updateFactionInfo();
  }
}

function updateFactionInfo(): void {
  const sel = document.getElementById('o-faction') as HTMLSelectElement | null;
  const info = document.getElementById('faction-info');
  if (!sel || !info) return;
  const f = D.factions.get(sel.value);
  if (!f) {
    info.textContent = 'A random civilization.';
    return;
  }
  const uniques = [...D.units.values(), ...D.buildings.values()].filter((x) => x.faction === f.id).map((x) => x.name);
  info.innerHTML = `<b>${esc(f.leader.title)} ${esc(f.leader.name)}</b> — ${esc(f.ability.name)}: ${esc(f.ability.description)} Uniques: ${esc(uniques.join(', '))}.<br><i>"${esc(f.lines.greeting)}"</i>`;
}

function readSetup() {
  const v = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';
  const c = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.checked ?? true;
  return {
    faction: v('o-faction') || 'random',
    mapType: (v('o-map') || 'continents') as 'continents' | 'pangaea',
    mapSize: v('o-size') || 'tiny',
    difficulty: v('o-diff') || 'prince',
    pace: v('o-pace') || 'standard',
    seed: v('o-seed') || undefined,
    barbarians: c('o-barb'),
    ruins: c('o-ruins'),
    maxTurns: Number(v('o-maxturns')) || undefined,
    victories: { domination: c('o-v-domination'), science: c('o-v-science'), culture: c('o-v-culture'), diplomatic: c('o-v-diplomatic'), time: c('o-v-time') },
  };
}

// ---- Tooltip ----

export function tileTooltip(s: GameState, i: number): string {
  const p = s.human;
  const pl = s.players[p];
  if (!pl.explored[i]) return 'Unexplored';
  const t = s.map.tiles[i];
  const parts: string[] = [];
  const ter = get(D.terrains, t.terrain);
  parts.push(`<b>${t.hills ? `${esc(ter.name)} hills` : esc(ter.name)}</b>${t.feature ? `, ${esc(get(D.features, t.feature).name)}` : ''}${t.river ? ', river' : ''}`);
  if (t.resource && resourceVisible(s, p, i)) parts.push(`${esc(get(D.resources, t.resource).name)} (${get(D.resources, t.resource).kind}${t.resourceQty ? ` ×${t.resourceQty}` : ''})`);
  if (t.improvement) parts.push(`${esc(get(D.improvements, t.improvement).name)}${t.pillaged ? ' (pillaged)' : ''}`);
  if (t.road) parts.push('Road');
  if (t.ruin) parts.push('Ancient ruins');
  if (t.camp) parts.push('<span class="bad">Barbarian camp</span>');
  if (!ter.impassable && t.feature !== 'ice') {
    const y = tileYields(s, i, t.owner >= 0 ? t.owner : p);
    parts.push(YIELD_KEYS.filter((k) => y[k]).map((k) => `${ICON[k]}${fmt(y[k])}`).join(' ') || 'no yields');
  }
  if (t.owner >= 0) {
    const c = s.cities[t.cityId];
    parts.push(`<span style="color:${s.players[t.owner].color}">■</span> ${esc(s.players[t.owner].name)}${c ? ` (${esc(c.name)})` : ''}`);
  }
  const defense = (t.hills ? D.rules.hills.defense : 0) + (t.feature ? D.features.get(t.feature)!.defense : 0);
  if (!ter.water && !ter.impassable) parts.push(`Move ${Math.max(ter.move, t.hills ? D.rules.hills.move : 1, t.feature ? D.features.get(t.feature)!.move : 1)}${defense ? ` · defence ${defense > 0 ? '+' : ''}${defense}%` : ''}`);
  if (ter.impassable) parts.push('Impassable');
  if (pl.visible[i]) {
    for (const u of Object.values(s.units).filter((x) => x.tile === i))
      parts.push(`${esc(s.players[u.owner].isBarbarian ? 'Barbarian' : s.players[u.owner].name)} ${esc(unitDef(u).name)} (${u.hp} HP)`);
  }
  const c = cityAt(s, i);
  if (c) parts.push(`City: <b>${esc(c.name)}</b> size ${c.pop}, ⛨ ${fmt(cityStrength(s, c).value)}, HP ${c.hp}`);
  // Combat / move preview for the selected unit.
  const sel = ui().selUnit;
  const u = sel !== null ? s.units[sel] : undefined;
  if (u && u.owner === p) {
    const pv = previewAttack(s, u, i);
    if (pv) {
      parts.push(`<hr><b>Attack:</b> ${fmt(pv.attacker.value)} vs ${fmt(pv.defender.value)}<br>
        Enemy loses ${pv.toDefender[0]}–${pv.toDefender[1]} of ${pv.defenderHp} HP${pv.ranged ? '' : `<br>You lose ${pv.toAttacker[0]}–${pv.toAttacker[1]} of ${pv.attackerHp} HP`}
        <div class="mods">${[...pv.attacker.mods.map((m) => `You: ${esc(m.label)} ${sign(m.pct)}%`), ...pv.defender.mods.map((m) => `Them: ${esc(m.label)} ${sign(m.pct)}%`)].join('<br>')}</div>`);
    } else if (distance(s.map, u.tile, i) === 1) {
      const cost = stepCost(s, u, u.tile, i);
      if (cost !== Infinity) parts.push(`Step cost: ${cost < 0 ? 'all moves (river)' : fmt(cost / D.rules.moveScale)}`);
    }
  }
  const city = ui().selCity !== null ? s.cities[ui().selCity!] : undefined;
  if (city && city.owner === p) {
    if (claimableTiles(s, city).includes(i)) parts.push(`<hr>Buy this tile for ${tileBuyCost(s, city, i)}●`);
    if (ui().cityAttack) {
      const pv = previewCityAttack(s, city, i);
      if (pv) parts.push(`<hr><b>City attack:</b> enemy loses ${pv.toDefender[0]}–${pv.toDefender[1]} HP`);
    }
  }
  return parts.join('<br>');
}

// ---- Events ----

export function installHudEvents(centerOn: (tile: number) => void): void {
  document.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
    if (!target || target.tagName === 'SELECT' || (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'checkbox')) return;
    const a = target.dataset.a!;
    const st = ui();
    const s = st.game;
    const unit = st.selUnit;
    const city = st.selCity;
    switch (a) {
      case 'play-now':
        startGame({});
        return;
      case 'start':
        startGame(readSetup());
        return;
      case 'load':
        load(target.dataset.n!).then(() => {
          const g = ui().game;
          if (g && g.human >= 0) {
            const cap = playerCities(g, g.human)[0] ?? undefined;
            const u = playerUnits(g, g.human)[0];
            centerOn(cap ? cap.tile : u ? u.tile : 0);
          }
        });
        return;
      case 'delete-save':
        if (confirm(`Delete save “${target.dataset.n}”?`)) deleteSave(target.dataset.n!).then(refreshSaves);
        return;
      case 'avoid-growth':
        if (s && city !== null) act({ type: 'focus', city, focus: s.cities[city].focus, avoidGrowth: (target as HTMLInputElement).checked });
        return;
    }
    if (!s) return;
    switch (a) {
      case 'panel': {
        const p = target.dataset.p as 'tech' | 'relations' | 'menu' | 'help' | 'none';
        set({ panel: st.panel === p ? 'none' : p });
        if (p === 'menu') refreshSaves();
        break;
      }
      case 'lens':
        set({ lens: !st.lens });
        break;
      case 'deselect':
        selectUnit(null);
        break;
      case 'close-city':
        selectCity(null);
        break;
      case 'found':
        if (unit !== null) act({ type: 'found', unit });
        break;
      case 'build':
        if (unit !== null && act({ type: 'build', unit, job: target.dataset.job! })) nextUnit();
        break;
      case 'order':
        if (unit !== null) {
          const o = target.dataset.o as 'fortify' | 'sleep' | 'skip' | 'wake' | 'explore';
          if (act({ type: 'order', unit, order: o }) && o !== 'wake') {
            if (o === 'explore') {
              // Start exploring right away.
              const u = s.units[unit];
              if (u && u.moves > 0) autoExplore(s, u);
              set({ rev: ui().rev + 1 });
            }
            nextUnit();
          }
        }
        break;
      case 'pillage':
        if (unit !== null) act({ type: 'pillage', unit });
        break;
      case 'upgrade':
        if (unit !== null) act({ type: 'upgrade', unit });
        break;
      case 'delete':
        if (unit !== null && confirm('Disband this unit?')) act({ type: 'delete', unit });
        break;
      case 'promote':
        if (unit !== null) act({ type: 'promote', unit, promotion: target.dataset.p! });
        break;
      case 'next-unit':
        if (!nextUnit()) toast('No units need orders.');
        break;
      case 'produce':
      case 'queue':
        if (city !== null) act({ type: 'produce', city, item: { kind: target.dataset.k as 'unit' | 'building', id: target.dataset.id! }, append: a === 'queue' });
        break;
      case 'buy':
        if (city !== null) act({ type: 'buy', city, item: { kind: target.dataset.k as 'unit' | 'building', id: target.dataset.id! } });
        break;
      case 'dequeue':
        if (city !== null) act({ type: 'dequeue', city, index: Number(target.dataset.i) });
        break;
      case 'city-attack':
        set({ cityAttack: !st.cityAttack });
        break;
      case 'annex':
        act({ type: 'annexPuppet', city: Number(target.dataset.c) });
        break;
      case 'capture':
        act({ type: 'capture', city: Number(target.dataset.c), choice: target.dataset.choice as 'annex' | 'puppet' | 'raze' });
        break;
      case 'research':
        if (act({ type: 'research', tech: target.dataset.t! })) {
          /* stay open so the player sees the path */
        }
        break;
      case 'war':
        if (confirm(`Declare war on the ${s.players[Number(target.dataset.p)].name}?`)) act({ type: 'declareWar', target: Number(target.dataset.p) });
        break;
      case 'peace':
        if (act({ type: 'makePeace', target: Number(target.dataset.p) })) toast('Peace!');
        break;
      case 'save': {
        const name = (document.getElementById('save-name') as HTMLInputElement).value.trim() || `Turn ${s.turn}`;
        quickSave(name).then(refreshSaves);
        break;
      }
      case 'quick-save':
        quickSave().then(refreshSaves);
        break;
      case 'quick-load':
        load('Quicksave');
        break;
      case 'new-game':
        set({ setup: true, panel: 'none' });
        refreshSaves();
        break;
      case 'note':
        if (target.dataset.t) centerOn(Number(target.dataset.t));
        break;
      case 'end-turn':
        endTurn();
        break;
      case 'vote-adj': {
        const c = s.congress!;
        const draft = [...(st.votes ?? c.votes[s.human] ?? c.proposals.map((x) => (x.leader ? -1 : 0)))];
        const i = Number(target.dataset.i);
        draft[i] = (draft[i] ?? 0) + Number(target.dataset.d);
        set({ votes: draft });
        break;
      }
      case 'vote-cast': {
        const c = s.congress!;
        if (act({ type: 'vote', votes: st.votes ?? c.votes[s.human] ?? c.proposals.map((x) => (x.leader ? -1 : 0)) })) {
          toast('Votes cast.');
          set({ votes: null });
        }
        break;
      }
      case 'propose': {
        const res = (document.getElementById('prop-res') as HTMLSelectElement).value;
        const tv = (document.getElementById('prop-target') as HTMLSelectElement).value;
        const kind = D.resolutions.get(res)?.target;
        let targetVal: string | number | undefined;
        if (kind && tv) {
          const [k, ...rest] = tv.split(':');
          if (k !== kind) {
            toast(`That resolution needs a ${kind} as its target.`);
            break;
          }
          targetVal = k === 'player' ? Number(rest[0]) : rest.join(':');
        }
        if (act({ type: 'propose', resolution: res, target: targetVal })) toast('Proposal submitted.');
        break;
      }
      case 'spy-diplomat':
        act({ type: 'moveSpy', spy: Number(target.dataset.s), to: Number(target.dataset.c), diplomat: true });
        break;
      case 'spy-coup':
        if (confirm('Attempt a coup? If it fails, your spy dies.')) act({ type: 'coup', spy: Number(target.dataset.s) });
        break;
      case 'choose-ideology':
        act({ type: 'chooseIdeology', ideology: target.dataset.id! });
        break;
      case 'switch-ideology':
        if (confirm('Switch ideology? Your tenets are lost and anarchy follows.')) act({ type: 'switchIdeology', ideology: target.dataset.id! });
        break;
      case 'dig':
        if (unit !== null) act({ type: 'dig', unit, choice: target.dataset.k as 'artifact' | 'landmark' });
        break;
      case 'pantheon':
        act({ type: 'pantheon', belief: target.dataset.id! });
        break;
      case 'reform':
        act({ type: 'reform', belief: target.dataset.id! });
        break;
      case 'prophet':
        if (unit !== null) set({ panel: 'prophet', panelUnit: unit, prophetMode: target.dataset.m as 'found' | 'enhance' });
        break;
      case 'do-found': {
        const v = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLSelectElement).value;
        if (act({ type: 'foundReligion', unit: Number(target.dataset.u), name: v('rel-name'), founder: v('bel-founder'), follower: v('bel-follower') })) set({ panel: 'religion' });
        break;
      }
      case 'do-enhance': {
        const v = (id: string) => (document.getElementById(id) as HTMLSelectElement).value;
        if (act({ type: 'enhanceReligion', unit: Number(target.dataset.u), follower: v('bel-follower'), enhancer: v('bel-enhancer') })) set({ panel: 'religion' });
        break;
      }
      case 'spread':
        if (unit !== null) act({ type: 'spreadReligion', unit });
        break;
      case 'heresy':
        if (unit !== null) act({ type: 'removeHeresy', unit });
        break;
      case 'routes':
        if (unit !== null) set({ panel: 'routes', panelUnit: unit });
        break;
      case 'do-route':
        if (act({ type: 'tradeRoute', unit: Number(target.dataset.u), to: Number(target.dataset.c), carries: target.dataset.k as 'gold' })) set({ panel: 'none' });
        break;
      case 'plunder':
        if (unit !== null) act({ type: 'plunder', unit });
        break;
      case 'admiral':
        if (unit !== null) act({ type: 'admiralHeal', unit });
        break;
      case 'target':
        if (unit !== null) {
          set({ targeting: { kind: target.dataset.k as 'strike', unit } });
          toast('Click a target on the map (Esc to cancel).');
        }
        break;
      case 'buy-faith':
        if (city !== null) act({ type: 'buyFaith', city, item: { kind: target.dataset.k as 'unit', id: target.dataset.id! } });
        break;
      case 'leader':
        set({ panel: 'leader', diploWith: Number(target.dataset.p) });
        break;
      case 'citystate':
        set({ panel: 'citystate', diploWith: Number(target.dataset.p), selCity: null });
        break;
      case 'open-trade': {
        const q = Number(target.dataset.p);
        const items = s.diplomacy.war[s.human][q] ? [{ kind: 'peace' as const, from: s.human }, { kind: 'peace' as const, from: q }] : [];
        set({ panel: 'trade', diploWith: q, tradeDeal: { a: s.human, b: q, items } });
        break;
      }
      case 'demand':
        set({ panel: 'trade', diploWith: Number(target.dataset.p), tradeDeal: { a: s.human, b: Number(target.dataset.p), items: [] } });
        toast('Add what you want from them, and nothing from you.');
        break;
      case 'trade-add': {
        const deal = st.tradeDeal!;
        set({ tradeDeal: { ...deal, items: [...deal.items, JSON.parse(target.dataset.i!)] } });
        break;
      }
      case 'trade-remove': {
        const deal = st.tradeDeal!;
        set({ tradeDeal: { ...deal, items: deal.items.filter((_, k) => k !== Number(target.dataset.k)) } });
        break;
      }
      case 'trade-clear':
        set({ tradeDeal: { ...st.tradeDeal!, items: [] } });
        break;
      case 'trade-balance':
        set({ tradeDeal: balanceDeal(s, st.tradeDeal!) });
        break;
      case 'trade-propose':
        if (act({ type: 'trade', deal: st.tradeDeal! })) {
          toast(s.players[st.tradeDeal!.b].isHuman ? 'Proposal sent.' : 'Deal!');
          set({ panel: 'leader', tradeDeal: null });
        }
        break;
      case 'close-trade':
        set({ panel: 'leader', tradeDeal: null });
        break;
      case 'friendship':
        if (act({ type: 'friendship', target: Number(target.dataset.p) })) toast('Friendship declared.');
        break;
      case 'denounce':
        if (confirm('Denounce them publicly?')) act({ type: 'denounce', target: Number(target.dataset.p) });
        break;
      case 'respond':
        act({ type: 'respond', index: Number(target.dataset.k), accept: target.dataset.accept === '1' });
        break;
      case 'cs-gift':
        act({ type: 'giftGold', minor: Number(target.dataset.m), amount: Number(target.dataset.g) });
        break;
      case 'cs-pledge':
        act({ type: 'pledge', minor: Number(target.dataset.m) });
        break;
      case 'cs-bully':
        act({ type: 'bully', minor: Number(target.dataset.m), kind: target.dataset.k as 'gold' | 'worker' });
        break;
      case 'gift-unit':
        if (unit !== null && confirm('Give this unit away?')) act({ type: 'giftUnit', unit, minor: Number(target.dataset.m) });
        break;
      case 'adopt':
        act({ type: 'adoptPolicy', policy: target.dataset.id! });
        break;
      case 'spec':
        if (city !== null) act({ type: 'specialist', city, specialist: target.dataset.k!, delta: Number(target.dataset.d) as 1 | -1 });
        break;
      case 'gp-use':
        if (unit !== null) act({ type: 'greatPerson', unit, use: target.dataset.u as 'discover' });
        break;
      case 'end-tab':
        set({ endTab: target.dataset.t!, replayTurn: target.dataset.t === 'replay' ? 0 : st.replayTurn });
        break;
      case 'end-stat':
        set({ endStat: target.dataset.t! });
        break;
      case 'end-close':
        set({ endClosed: true });
        break;
      case 'summary':
        set({ endClosed: false, panel: 'none' });
        break;
      case 'replay-play': {
        const last = s.replay.length ? s.replay[s.replay.length - 1].turn : 0;
        let t = st.replayTurn >= last ? 0 : st.replayTurn;
        const timer = setInterval(() => {
          t = Math.min(last, t + Math.max(1, Math.round(last / 120)));
          set({ replayTurn: t });
          if (t >= last || ui().endTab !== 'replay' || ui().endClosed) clearInterval(timer);
        }, 60);
        break;
      }
    }
  });
  document.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'replay-turn') set({ replayTurn: Number(t.value) });
  });
  document.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.a === 'trade-amount') {
      const deal = ui().tradeDeal;
      if (deal) {
        const k = Number(t.dataset.k);
        const items = deal.items.map((x, i) => (i === k ? { ...x, amount: Math.max(1, Math.floor(Number(t.value) || 1)) } : x));
        store.setState({ tradeDeal: { ...deal, items } });
      }
    }

    if (t.id === 'o-faction') updateFactionInfo();
    if (t.dataset.a === 'spy-move') act({ type: 'moveSpy', spy: Number(t.dataset.s), to: Number(t.value) });
    if (t.dataset.a === 'leader-vote') {
      const st = ui();
      const c = st.game?.congress;
      if (c && st.game) {
        const draft = [...(st.votes ?? c.votes[st.game.human] ?? c.proposals.map((x) => (x.leader ? -1 : 0)))];
        draft[Number(t.dataset.i)] = Number(t.value);
        set({ votes: draft });
      }
    }
    if (t.dataset.a === 'focus') {
      const city = ui().selCity;
      if (city !== null) act({ type: 'focus', city, focus: t.value as 'default' });
    }
  });
}

