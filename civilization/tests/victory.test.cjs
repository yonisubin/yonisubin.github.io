// Phase 7: the full tech tree, projects and processes, spaceship parts and the science
// victory, the end-of-game screen (graphs, replay) and the Hall of Fame.
const { run } = require('./harness.cjs');

run('victory', async ({ page }, t) => {
  const r = await page.evaluate(() => {
    const h = window.hexborne;
    const C = h.core;
    const D = h.D;
    const out = {};
    const s = h.start({ seed: 'victory', mapSize: 'duel', barbarians: false });
    out.techCount = D.techs.size;
    const pl = s.players[0];
    const settler = Object.values(s.units).find((u) => u.owner === 0 && u.type === 'settler');
    h.act({ type: 'found', unit: settler.id });
    const cap = Object.values(s.cities).find((c) => c.owner === 0);
    // Process: Wealth turns production into gold.
    pl.techs.push('agriculture', 'pottery', 'mining', 'bronze_working', 'writing', 'currency');
    h.act({ type: 'research', tech: 'calendar' });
    out.wealthQueued = h.act({ type: 'produce', city: cap.id, item: { kind: 'project', id: 'wealth' } }).ok;
    const g0 = pl.gold;
    h.endTurnSync();
    out.wealthGold = pl.gold - g0;
    out.wealthStays = cap.queue[0]?.id === 'wealth';
    // Everything but Future Tech.
    for (const tech of D.techs.keys()) if (!pl.techs.includes(tech) && tech !== 'future_tech') pl.techs.push(tech);
    out.apolloBuildable = h.act({ type: 'produce', city: cap.id, item: { kind: 'project', id: 'apollo_program' } }).ok;
    out.partBlocked = !h.act({ type: 'produce', city: cap.id, item: { kind: 'unit', id: 'ss_engine' } }).ok;
    // Future Tech repeats.
    h.act({ type: 'research', tech: 'future_tech' });
    C.addScience(s, 0, 100000);
    out.futureTechs = pl.futureTechs;
    out.stillResearching = pl.research === 'future_tech';
    // Spaceship: everything delivered except the engine, which walks into the capital.
    pl.projects.push('apollo_program');
    pl.spaceship = { booster: 3, cockpit: 1, stasis: 1 };
    const next = C.neighbor(s.map, cap.tile, 0) >= 0 && !D.terrains.get(s.map.tiles[C.neighbor(s.map, cap.tile, 0)].terrain).water ? C.neighbor(s.map, cap.tile, 0) : [0, 1, 2, 3, 4, 5].map((d) => C.neighbor(s.map, cap.tile, d)).find((n) => n >= 0 && !D.terrains.get(s.map.tiles[n].terrain).water && s.map.tiles[n].terrain !== 'mountain');
    const part = C.createUnit(s, 'ss_engine', 0, next);
    C.recomputeAllVisibility(s);
    out.move = h.act({ type: 'move', unit: part.id, to: cap.tile });
    out.delivered = pl.spaceship.engine === 1 && !s.units[part.id];
    C.checkVictory(s);
    h.set({ rev: 1000 });
    out.winner = s.winner;
    out.stats = pl.stats.length;
    out.replay = s.replay.length;
    out.events = s.events.length;
    return out;
  });
  t.ok('80 techs through the Information era', r.techCount === 80, r.techCount);
  t.ok('Wealth can be queued', r.wealthQueued);
  t.ok('Wealth turns production into gold and stays queued', r.wealthGold > 0 && r.wealthStays, r.wealthGold);
  t.ok('the Apollo Program unlocks with Rocketry', r.apolloBuildable);
  t.ok('spaceship parts need the Apollo Program', r.partBlocked);
  t.ok('Future Tech can be researched again and again', r.futureTechs >= 2 && r.stillResearching, r.futureTechs);
  t.ok('a spaceship part walking into the capital is installed', r.delivered, r.move);
  t.ok('a complete spaceship wins a science victory', r.winner && r.winner.kind === 'science' && r.winner.player === 0, r.winner);
  t.ok('stats, replay and events are recorded', r.stats >= 1 && r.replay >= 1 && r.events >= 2, r);
  await page.waitForSelector('.endgame', { timeout: 5000 });
  t.ok('the end screen shows Victory', /Victory!/.test(await page.textContent('#modal')));
  await page.click('[data-a="end-tab"][data-t="graphs"]');
  await page.waitForSelector('#end-graph');
  t.ok('the graphs tab draws a chart', await page.evaluate(() => !!document.getElementById('end-graph')));
  await page.click('[data-a="end-tab"][data-t="replay"]');
  await page.waitForSelector('#end-replay');
  t.ok('the replay tab draws the map', await page.evaluate(() => !!document.getElementById('end-replay')));
  const hof = await page.evaluate(() => JSON.parse(localStorage.getItem('civ:hallOfFame') || '[]'));
  t.ok('the game is in the Hall of Fame', hof.length === 1 && hof[0].won && hof[0].kind === 'science', hof[0]);
  await page.click('[data-a="end-close"]');
  await page.waitForFunction(() => document.getElementById('modal').style.display === 'none', null, { timeout: 3000 }).catch(() => {});
  t.ok('closing keeps the map', await page.evaluate(() => document.getElementById('modal').style.display === 'none'));
});
