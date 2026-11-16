// Phase 9: city-states (influence, friend/ally bonuses, quests, bullying), trade deals with AI
// players (embassies, open borders, luxuries, research agreements), defensive pacts,
// denouncements and opinion, proposals to the human, and the diplomacy screens.
const { run } = require('./harness.cjs');

run('diplomacy and city-states', async ({ page }, t) => {
  const r = await page.evaluate(() => {
    const h = window.hexborne;
    const C = h.core;
    const out = {};
    const s = h.start({ seed: 'diplo', mapSize: 'small', barbarians: false });
    const majors = s.players.filter((p) => !p.isMinor && !p.isBarbarian);
    const minors = s.players.filter((p) => p.isMinor);
    out.minors = minors.length;
    out.minorCities = minors.every((m) => Object.values(s.cities).some((c) => c.owner === m.id));
    // Everyone meets everyone.
    for (const a of s.players) for (const b of s.players) if (a !== b && !a.isBarbarian && !b.isBarbarian && !a.met.includes(b.id)) a.met.push(b.id);
    const me = s.players[0];
    const settler = Object.values(s.units).find((u) => u.owner === 0 && u.type === 'settler');
    h.act({ type: 'found', unit: settler.id });
    const cap = Object.values(s.cities).find((c) => c.owner === 0);

    // --- City-states ---
    const cult = minors.find((m) => m.minor.type === 'cultured') ?? minors[0];
    me.gold = 2000;
    out.gift = h.act({ type: 'giftGold', minor: cult.id, amount: 500 }).ok;
    out.influence = cult.minor.influence[0];
    cult.minor.influence[0] = 35;
    s.modGen++;
    out.friendBonus = C.cityStateEffects(s, 0).length > 0;
    cult.minor.influence[0] = 70;
    h.endTurnSync();
    out.ally = cult.minor.ally === 0;
    // Quest: a camp near them, cleared by us.
    const ccity = Object.values(s.cities).find((c) => c.owner === cult.id);
    const campTile = [0, 1, 2, 3, 4, 5].map((d) => C.neighbor(s.map, C.neighbor(s.map, ccity.tile, d), d)).find((t) => t >= 0 && !h.D.terrains.get(s.map.tiles[t].terrain).water && s.map.tiles[t].terrain !== 'mountain' && !Object.values(s.units).some((u) => u.tile === t));
    s.map.tiles[campTile].camp = true;
    s.camps[campTile] = s.turn;
    cult.minor.quests = [{ kind: 'camp', target: campTile, start: s.turn, until: s.turn + 30, done: [] }];
    const before = cult.minor.influence[0];
    const w = C.createUnit(s, 'warrior', 0, C.neighbor(s.map, campTile, 0) >= 0 ? campTile : campTile);
    w.tile = campTile;
    s.map.tiles[campTile].camp = true;
    // Step off and back on to trigger clearing.
    const off = [0, 1, 2, 3, 4, 5].map((d) => C.neighbor(s.map, campTile, d)).find((t) => t >= 0 && !h.D.terrains.get(s.map.tiles[t].terrain).water && s.map.tiles[t].terrain !== 'mountain' && !Object.values(s.units).some((u) => u.tile === t));
    w.tile = off;
    C.recomputeAllVisibility(s);
    h.act({ type: 'move', unit: w.id, to: campTile });
    out.quest = cult.minor.influence[0] >= before + 30;
    // Bullying needs force nearby.
    const target = minors.find((m) => m !== cult) ?? cult;
    const tcity = Object.values(s.cities).find((c) => c.owner === target.id);
    const weak = h.act({ type: 'bully', minor: target.id, kind: 'gold' });
    out.bullyRefused = !weak.ok;
    for (let k = 0; k < 4; k++) {
      const spot = [0, 1, 2, 3, 4, 5].map((d) => C.neighbor(s.map, C.neighbor(s.map, tcity.tile, d), (d + k) % 6)).find((t) => t >= 0 && !h.D.terrains.get(s.map.tiles[t].terrain).water && !Object.values(s.units).some((u) => u.tile === t));
      if (spot !== undefined) C.createUnit(s, 'tank', 0, spot);
    }
    const g0 = me.gold;
    out.bully = h.act({ type: 'bully', minor: target.id, kind: 'gold' }).ok && me.gold > g0 && target.minor.influence[0] < 0;

    // --- Deals with an AI ---
    const ai = majors[1];
    out.embassies = h.act({ type: 'trade', deal: { a: 0, b: ai.id, items: [{ kind: 'embassy', from: 0 }, { kind: 'embassy', from: ai.id }] } }).ok;
    out.hasEmbassy = s.diplomacy.embassy[0][ai.id] && s.diplomacy.embassy[ai.id][0];
    // Open borders: their land opens to our units.
    const aiTile = s.map.tiles.findIndex((tl) => tl.owner === ai.id && !h.D.terrains.get(tl.terrain).water && tl.terrain !== 'mountain' && !Object.values(s.cities).some((c) => c.tile === s.map.tiles.indexOf(tl)));
    const scout = Object.values(s.units).find((u) => u.owner === 0 && u.type === 'scout');
    me.explored[aiTile] = 1;
    out.closedBefore = !C.canEnter(s, scout, aiTile, false);
    ai.gold = 1000;
    h.act({ type: 'trade', deal: { a: 0, b: ai.id, items: [{ kind: 'gold', from: 0, amount: 600 }, { kind: 'openBorders', from: ai.id }] } });
    out.openAfter = C.canEnter(s, scout, aiTile, false);
    // Research agreement pays after 20 turns of peace.
    me.gold = 5000;
    ai.gold = 5000;
    const ra = h.act({ type: 'trade', deal: { a: 0, b: ai.id, items: [{ kind: 'researchAgreement', from: 0 }, { kind: 'researchAgreement', from: ai.id }, { kind: 'gold', from: 0, amount: 300 }] } });
    out.ra = ra.ok || ra.error;
    out.raActive = s.diplomacy.researchAgreements.length === 1;

    // --- Denounce and opinion ---
    const third = majors[2];
    const op0 = C.opinion(s, third.id, 0).total;
    s.diplomacy.denounce[third.id][0] = 0;
    h.act({ type: 'denounce', target: third.id });
    out.denounceOpinion = C.opinion(s, third.id, 0).parts.some((x) => x.label === 'Denounced us') && C.opinion(s, third.id, 0).total < op0;

    // --- Defensive pact pulls allies into wars ---
    const d4 = majors[3] ?? majors[2];
    s.diplomacy.pact[ai.id][d4.id] = s.diplomacy.pact[d4.id][ai.id] = s.turn + 30;
    s.diplomacy.changed[0][ai.id] = s.diplomacy.changed[ai.id][0] = -99;
    h.act({ type: 'declareWar', target: ai.id });
    out.pact = s.diplomacy.war[0][ai.id] && s.diplomacy.war[0][d4.id];
    out.raCancelled = s.diplomacy.researchAgreements.length === 0;

    // --- A proposal waiting for the human ---
    s.diplomacy.proposals.push({ deal: { a: third.id, b: 0, items: [{ kind: 'gold', from: third.id, amount: 50 }] }, from: third.id, turn: s.turn, kind: 'deal', text: 'A gift.' });
    third.gold = 500;
    const g1 = me.gold;
    out.accept = h.act({ type: 'respond', index: 0, accept: true }).ok && me.gold === g1 + 50;
    h.set({ rev: 9999 });
    return out;
  });
  t.ok('city-states are placed, each with its city', r.minors >= 6 && r.minorCities, r.minors);
  t.ok('gifting gold raises influence', r.gift && r.influence > 0, r.influence);
  t.ok('friends get a bonus', r.friendBonus);
  t.ok('60+ influence makes you the ally', r.ally);
  t.ok('clearing the camp they asked about completes the quest', r.quest);
  t.ok('bullying needs a threatening force', r.bullyRefused);
  t.ok('with tanks nearby, tribute is paid (and influence drops)', r.bully);
  t.ok('embassies can be swapped with an AI', r.embassies && r.hasEmbassy);
  t.ok('foreign land is closed without open borders', r.closedBefore);
  t.ok('buying open borders opens it', r.openAfter);
  t.ok('research agreements can be signed', r.ra === true && r.raActive, r.ra);
  t.ok('denouncing shows in their opinion', r.denounceOpinion);
  t.ok('a defensive pact drags the partner into the war', r.pact);
  t.ok('war cancels research agreements', r.raCancelled);
  t.ok('accepting a proposal carries it out', r.accept);
  await page.waitForTimeout(300);
  await page.evaluate(() => window.hexborne.set({ panel: 'relations' }));
  await page.waitForSelector('[data-a="leader"]');
  t.ok('relations list city-states', (await page.locator('[data-a="citystate"]').count()) >= 6);
  await page.click('[data-a="leader"]');
  await page.waitForSelector('.portrait');
  t.ok('the leader screen shows a portrait and mood', /Mood/.test(await page.textContent('#modal')));
  await page.click('[data-a="open-trade"]');
  await page.waitForSelector('.trade-cols');
  t.ok('the trade screen opens', true);
});
