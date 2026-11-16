// The encyclopedia: every rule table described from the data itself (so it can never go out of
// date), plus a few short articles on how the game works. All text here is original.
import { D, ERA_NAMES } from '../data';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
type Fx = (e: { type: string; [k: string]: unknown }) => string;

const name = <T extends { name: string }>(m: Map<string, T>, id?: string) => (id ? m.get(id)?.name ?? id : '');
const yields = (y: Record<string, number | undefined> | undefined) =>
  Object.entries(y ?? {})
    .filter(([, v]) => v)
    .map(([k, v]) => `${v! > 0 ? '+' : ''}${v} ${k}`)
    .join(', ');
const line = (label: string, v: string | number | undefined | false) => (v || v === 0 ? `<tr><td>${label}</td><td>${typeof v === 'string' ? v : v}</td></tr>` : '');
const unlockedBy = (tech?: string) => (tech ? `<a data-a="pedia" data-c="techs" data-i="${tech}">${esc(name(D.techs, tech))}</a>` : 'available from the start');

/** Short original articles on the game's systems. */
const CONCEPTS: Record<string, { name: string; text: string }> = {
  start: {
    name: 'Getting started',
    text: 'Found your capital at once (select the Settler, press B). Pick something to research and something to build, explore with your Scout and Warrior, and press End Turn (Enter). The End Turn button always names the next thing that needs your attention.',
  },
  cities: {
    name: 'Cities and growth',
    text: 'Each citizen works one tile within three rings of its city and eats 2 food. Surplus food fills the growth bucket; when it is full the city gains a citizen. Culture slowly pushes borders outward, and gold can buy tiles at once. Cities build one thing at a time from their queue; leftover production carries over. Choose a focus to steer which tiles citizens work.',
  },
  happiness: {
    name: 'Happiness',
    text: 'Happiness is one number for the whole empire. Every city and every citizen cost some; each different luxury you connect, and buildings such as shrines and colosseums, add some. Below zero cities grow slowly; at −10 they stop growing and armies fight worse; at −20 rebels appear. Positive happiness fills the golden age meter.',
  },
  golden: {
    name: 'Golden ages',
    text: 'When the golden age meter fills (or a Great Artist starts one) your empire enters a golden age: tiles that make production or gold make one more, and culture rises by a fifth. Each golden age needs more happiness than the last.',
  },
  combat: {
    name: 'Combat',
    text: 'Attacker and defender compare their strength after every modifier (terrain, rivers, fortification, flanking, promotions, generals). The stronger side deals more damage; wounded units fight weaker. Ranged units take no damage back. Only melee units can take a city, and only once its defences are down. Hover over an enemy with a unit selected to see the expected result.',
  },
  movement: {
    name: 'Movement and zones of control',
    text: 'Open land costs 1 move, forests, jungles, hills and marshes 2; crossing a river uses all remaining moves until you have bridges. A unit that steps from one tile next to an enemy to another tile next to that enemy must stop. Only one military and one civilian unit may share a tile.',
  },
  science: {
    name: 'Science',
    text: 'Citizens, libraries and other buildings make science, which flows into the technology you are researching. Each extra city makes every technology a little dearer, and knowing civilizations who already have it makes it cheaper.',
  },
  culture: {
    name: 'Culture, policies and ideologies',
    text: 'Culture buys social policies from nine trees; finishing a tree gives a large bonus. In the industrial era you adopt an ideology, whose tenets take the place of policies. Rival ideologies with more influence over you make your people restless.',
  },
  religion: {
    name: 'Faith and religion',
    text: 'Faith first buys a pantheon belief. Great Prophets found and later enhance a religion, adding beliefs. Religions spread by pressure from nearby cities, trade routes, missionaries and prophets; the majority religion of a city decides which follower beliefs apply there.',
  },
  diplomacy: {
    name: 'Diplomacy and city-states',
    text: 'Leaders remember how you treat them: shared wars, denouncements, broken promises, land grabs and conquest all shape their mood. Trade luxuries, gold and treaties on the trade screen. City-states reward friends and allies; gain influence with gifts, quests and protection.',
  },
  trade: {
    name: 'Trade routes',
    text: 'Caravans and Cargo Ships open routes from one of your cities. Routes to other civilizations bring gold (and science to the side behind in technology); routes between your own cities carry food or production. Enemies can plunder a caravan on its way.',
  },
  tourism: {
    name: 'Tourism and great works',
    text: 'Great works in building slots make culture and tourism. Your total tourism against another civilization’s lifetime culture sets your influence over it, from Exotic to Dominant. Being Influential over everyone wins a culture victory.',
  },
  congress: {
    name: 'World Congress and espionage',
    text: 'Once enough of the world has met, a congress meets regularly to vote on proposals with delegates from your size, allies and wonders; later it can elect a world leader. Spies steal technology, rig city-state elections, act as diplomats and catch other spies.',
  },
  victory: {
    name: 'Victory',
    text: 'Domination: hold every original capital. Science: research the space technologies, complete the Apollo Program and deliver every spaceship part to your capital. Culture: be Influential over every civilization. Diplomacy: win the world leader vote. Time: have the best score when the last turn ends.',
  },
  multiplayer: {
    name: 'Hotseat and online play',
    text: 'In a hotseat game several people share one device and pass it between turns. Online games run through a small relay server: one player hosts, the others join with the room code, and the host’s browser runs the world.',
  },
};

const CATS: { id: string; name: string; list: () => { id: string; name: string }[] }[] = [
  { id: 'concepts', name: 'How to play', list: () => Object.entries(CONCEPTS).map(([id, c]) => ({ id, name: c.name })) },
  { id: 'units', name: 'Units', list: () => [...D.units.values()] },
  { id: 'buildings', name: 'Buildings', list: () => [...D.buildings.values()].filter((b) => !b.wonder) },
  { id: 'wonders', name: 'Wonders', list: () => [...D.buildings.values()].filter((b) => b.wonder) },
  { id: 'techs', name: 'Technologies', list: () => [...D.techs.values()] },
  { id: 'policies', name: 'Policies', list: () => [...D.policyTrees.values()] },
  { id: 'beliefs', name: 'Beliefs', list: () => [...D.beliefs.values()] },
  { id: 'ideologies', name: 'Ideologies', list: () => [...D.ideologies.values()] },
  { id: 'terrain', name: 'Terrain', list: () => [...D.terrains.values(), ...D.features.values()] },
  { id: 'resources', name: 'Resources', list: () => [...D.resources.values()] },
  { id: 'improvements', name: 'Improvements', list: () => [...D.improvements.values()] },
  { id: 'promotions', name: 'Promotions', list: () => [...D.promotions.values()] },
  { id: 'factions', name: 'Civilizations', list: () => [...D.factions.values()] },
  { id: 'citystates', name: 'City-states', list: () => [...D.cityStates.values()] },
];

function article(cat: string, id: string, fx: Fx): string {
  switch (cat) {
    case 'concepts': {
      const c = CONCEPTS[id];
      return c ? `<h3>${esc(c.name)}</h3><p>${esc(c.text)}</p>` : '';
    }
    case 'units': {
      const u = D.units.get(id);
      if (!u) return '';
      const builds = [...D.units.values()].filter((x) => x.upgradesTo === id).map((x) => x.name);
      return `<h3>${esc(u.glyph)} ${esc(u.name)}</h3><table>
        ${line('Class', u.class.replace('_', ' '))}${line('Strength', u.strength)}${u.ranged ? line('Ranged strength', `${u.ranged} (range ${u.range})`) : ''}
        ${line('Moves', u.moves)}${line('Cost', u.faithCost ? `${u.cost} production or ${u.faithCost} faith` : u.cost)}${line('Needs', unlockedBy(u.tech))}
        ${u.resource ? line('Resource', esc(name(D.resources, u.resource))) : ''}${u.upgradesTo ? line('Upgrades to', `<a data-a="pedia" data-c="units" data-i="${u.upgradesTo}">${esc(name(D.units, u.upgradesTo))}</a>`) : ''}
        ${builds.length ? line('Upgraded from', esc(builds.join(', '))) : ''}${u.faction ? line('Unique to', esc(name(D.factions, u.faction)) + (u.replaces ? ` (replaces ${esc(name(D.units, u.replaces))})` : '')) : ''}
        ${u.bonuses.length ? line('Bonuses', esc(u.bonuses.map((b) => `${b.percent > 0 ? '+' : ''}${b.percent}% vs ${b.vs}`).join(', '))) : ''}
        ${line('Abilities', esc([u.canFound && 'founds cities', u.canBuild && 'builds improvements', u.ignoresTerrainCost && 'ignores terrain', u.moveAfterAttack && 'moves after attacking', u.mustSetUp && 'sets up before firing', u.stealth && 'hidden unless adjacent', u.trade && 'opens trade routes', u.religious && 'spreads religion'].filter(Boolean).join(', ')))}
      </table>`;
    }
    case 'buildings':
    case 'wonders': {
      const b = D.buildings.get(id);
      if (!b) return '';
      const req = b.requires;
      const needs = [req.river && 'a river', req.mountain && 'a mountain nearby', req.coast && 'the coast', req.building && name(D.buildings, req.building), req.resource && name(D.resources, req.resource), req.allCities && `a ${name(D.buildings, req.allCities)} in every city`].filter(Boolean) as string[];
      const fxs = [...b.effects, ...b.cityEffects].map((e) => fx(e as unknown as { type: string })).join('; ');
      return `<h3>${esc(b.name)}</h3><table>
        ${line('Kind', b.wonder ? `${b.wonder} wonder` : 'building')}${line('Cost', b.faithCost ? `${b.faithCost} faith` : b.cost)}${line('Maintenance', b.maintenance ? `${b.maintenance} gold` : '')}
        ${line('Needs', unlockedBy(b.tech) + (needs.length ? ` · ${esc(needs.join(', '))}` : ''))}
        ${line('Yields', esc(yields(b.yields)))}${line('Per citizen', esc(yields(b.perPop)))}${line('Bonus', esc(Object.entries(b.percent).filter(([, v]) => v).map(([k, v]) => `+${v}% ${k}`).join(', ')))}
        ${line('Happiness', b.happiness ? `+${b.happiness}` : '')}${line('Defense', b.defense ? `+${b.defense}` : '')}${line('Experience', b.xp ? `+${b.xp} for new units` : '')}
        ${line('Specialists', esc(Object.entries(b.specialists).map(([k, v]) => `${v} ${k}`).join(', ')))}${line('Great work slots', esc(Object.entries(b.greatWorkSlots).map(([k, v]) => `${v} ${k}`).join(', ')))}
        ${line('Effects', esc(fxs))}${b.faction ? line('Unique to', esc(name(D.factions, b.faction))) : ''}
      </table>`;
    }
    case 'techs': {
      const t = D.techs.get(id);
      if (!t) return '';
      const link = (c: string, x: { id: string; name: string }) => `<a data-a="pedia" data-c="${c}" data-i="${x.id}">${esc(x.name)}</a>`;
      const units = [...D.units.values()].filter((u) => u.tech === id).map((u) => link('units', u));
      const blds = [...D.buildings.values()].filter((b) => b.tech === id).map((b) => link(b.wonder ? 'wonders' : 'buildings', b));
      const imps = [...D.improvements.values()].filter((x) => x.tech === id).map((x) => link('improvements', x));
      const res = [...D.resources.values()].filter((x) => x.revealTech === id).map((x) => link('resources', x));
      const leads = [...D.techs.values()].filter((x) => x.prereqs.includes(id)).map((x) => link('techs', x));
      return `<h3>${esc(t.name)}</h3><table>
        ${line('Era', ERA_NAMES[t.era])}${line('Cost', `${t.cost} science (before pace and city count)`)}
        ${line('Needs', t.prereqs.map((p) => link('techs', D.techs.get(p)!)).join(', ') || 'nothing')}${line('Leads to', leads.join(', '))}
        ${line('Units', units.join(', '))}${line('Buildings', blds.join(', '))}${line('Improvements', imps.join(', '))}${line('Reveals', res.join(', '))}
        ${line('Also', esc([t.bridges && 'bridges over rivers', t.embark && `embarking (${t.embark})`, t.tradeRoutes && `+${t.tradeRoutes} trade route`, t.revealsMap && 'reveals the map', t.repeatable && 'can be researched again for score'].filter(Boolean).join(', ')))}
      </table>`;
    }
    case 'policies': {
      const t = D.policyTrees.get(id);
      if (!t) return '';
      return `<h3>${esc(t.name)}</h3><p>${esc(t.description)}</p><p class="sub">Opens in the ${ERA_NAMES[t.era]} era${t.excludes ? ` · excludes ${esc(name(D.policyTrees, t.excludes))}` : ''}. Opener: ${esc(t.opener.map((e) => fx(e as unknown as { type: string })).join('; '))}. Finisher: ${esc(t.finisher.map((e) => fx(e as unknown as { type: string })).join('; '))}.</p>
        <table>${t.policies.map((p) => line(esc(p.name), esc(p.description))).join('')}</table>`;
    }
    case 'beliefs': {
      const b = D.beliefs.get(id);
      return b ? `<h3>${esc(b.name)}</h3><p class="sub">${b.kind} belief</p><p>${esc(b.description)}</p>` : '';
    }
    case 'ideologies': {
      const i = D.ideologies.get(id);
      if (!i) return '';
      return `<h3>${esc(i.name)}</h3><p>${esc(i.description)}</p><table>${i.tenets.map((t) => line(`${esc(t.name)} <span class="sub">tier ${t.tier}</span>`, esc(t.description))).join('')}</table>`;
    }
    case 'terrain': {
      const t = D.terrains.get(id);
      if (t) return `<h3>${esc(t.name)}</h3><table>${line('Yields', esc(yields(t.yields)) || 'nothing')}${line('Movement', t.impassable ? 'impassable' : t.move)}${line('Defense', `${t.defense > 0 ? '+' : ''}${t.defense}%`)}${line('Fresh water', t.freshWater ? 'yes' : '')}${line('Water', t.water ? 'yes' : '')}</table>`;
      const f = D.features.get(id);
      if (!f) return '';
      return `<h3>${esc(f.name)}</h3><table>${line('Yields', esc(yields(f.replace ?? f.add)) || 'nothing')}${line('Movement', f.impassable ? 'impassable' : f.move)}${line('Defense', `${f.defense > 0 ? '+' : ''}${f.defense}%`)}${line('Blocks sight', f.blocksSight ? 'yes' : '')}${line('Clearing it', f.chopProduction ? `gives ${f.chopProduction} production` : '')}</table>`;
    }
    case 'resources': {
      const r = D.resources.get(id);
      if (!r) return '';
      return `<h3>${esc(r.name)}</h3><table>${line('Kind', r.kind)}${line('Yields', esc(yields(r.yields)))}${line('Improved by', `<a data-a="pedia" data-c="improvements" data-i="${r.improvement}">${esc(name(D.improvements, r.improvement))}</a> (${esc(yields(r.improvedYields))})`)}${line('Seen after', unlockedBy(r.revealTech))}${line('Found on', esc([...r.terrains.map((x) => name(D.terrains, x)), ...r.features.map((x) => name(D.features, x))].join(', ')))}${r.kind === 'luxury' ? line('Happiness', '+4 for the first copy you connect (see Happiness)') : ''}</table>`;
    }
    case 'improvements': {
      const x = D.improvements.get(id);
      if (!x) return '';
      return `<h3>${esc(x.name)}</h3><table>${line('Yields', esc(yields(x.yields)))}${line('Build time', x.greatPerson ? 'built by a great person' : `${x.buildTurns} turns`)}${line('Needs', unlockedBy(x.tech))}${line('Fresh water bonus', x.freshWaterFood ? `+${x.freshWaterFood} food` : '')}${line('Where', esc(x.resourceOnly ? 'on a matching resource' : x.water ? 'water' : x.hills === 'only' ? 'hills' : [...x.terrains.map((t) => name(D.terrains, t)), ...x.features.map((t) => name(D.features, t))].join(', ')))}</table>`;
    }
    case 'promotions': {
      const p = D.promotions.get(id);
      return p ? `<h3>${esc(p.name)}</h3><p>${esc(p.description)}</p><p class="sub">For ${esc(p.classes.join(', ').replace(/_/g, ' '))}${p.requires.length ? ` · needs ${esc(p.requires.map((r) => name(D.promotions, r)).join(' or '))}` : ''}</p>` : '';
    }
    case 'factions': {
      const f = D.factions.get(id);
      if (!f) return '';
      const uniques = [...D.units.values(), ...D.buildings.values()].filter((x) => x.faction === id).map((x) => x.name);
      return `<h3>${esc(f.name)}</h3><p><b>${esc(f.leader.title)} ${esc(f.leader.name)}</b> — ${esc(f.ability.name)}: ${esc(f.ability.description)}</p><p>Uniques: ${esc(uniques.join(', '))}</p><p class="quote">“${esc(f.lines.greeting)}”</p>`;
    }
    case 'citystates': {
      const c = D.cityStates.get(id);
      return c ? `<h3>${esc(c.name)}</h3><p>A ${c.personality} ${c.type} city-state${c.luxury ? ` with its own luxury, ${esc(name(D.resources, c.luxury))}` : ''}.</p>` : '';
    }
  }
  return '';
}

export function pediaHtml(cat: string, id: string, query: string, fx: Fx): string {
  const c = CATS.find((x) => x.id === cat) ?? CATS[0];
  const q = query.trim().toLowerCase();
  // A search looks through every category.
  const items = q ? CATS.flatMap((k) => k.list().filter((x) => x.name.toLowerCase().includes(q)).map((x) => ({ ...x, cat: k.id }))) : c.list().map((x) => ({ ...x, cat: c.id }));
  const sel = id && items.some((x) => x.id === id && x.cat === cat) ? id : !q && !id ? items[0]?.id : id;
  const list = items.map((x) => `<button class="link ${x.id === sel && x.cat === cat ? 'on' : ''}" data-a="pedia" data-c="${x.cat}" data-i="${x.id}">${esc(x.name)}</button>`).join('');
  const tabs = CATS.map((k) => `<button class="tab ${k.id === c.id && !q ? 'on' : ''}" data-a="pedia" data-c="${k.id}" data-i="">${esc(k.name)}</button>`).join('');
  return `<div class="dialog wide pedia"><div class="row head"><h2>Encyclopedia</h2><input id="pedia-q" placeholder="Search…" value="${esc(query)}"><button class="x" data-a="panel" data-p="none">✕</button></div>
    <div class="row tabs">${tabs}</div>
    <div class="pedia-body"><div class="pedia-list">${list || '<span class="sub">Nothing found.</span>'}</div><div class="pedia-article">${sel ? article(cat, sel, fx) : ''}</div></div></div>`;
}
