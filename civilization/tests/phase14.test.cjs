// Phase 14 (hotseat): several humans on one device take their turns one after another, with a
// cover screen between seats; the AI still moves; human↔human diplomacy waits for the other
// seat; saves keep the seats.
const { run } = require('./harness.cjs');

run('hotseat', async ({ page }, t) => {
  const r1 = await page.evaluate(() => {
    const h = window.hexborne;
    const s = h.start({ seed: 'hotseat', mapSize: 'tiny', cityStates: 0, humans: [{ faction: 'verdant', name: 'Ann' }, { faction: 'iron', name: 'Ben' }] });
    return {
      humans: s.players.filter((p) => p.isHuman).map((p) => [p.id, p.nick, p.faction]),
      ai: s.players.filter((p) => !p.isHuman && !p.isMinor && !p.isBarbarian).length,
      passTo: h.store.getState().passTo,
    };
  });
  t.ok('two human seats with their names and factions', JSON.stringify(r1.humans) === JSON.stringify([[0, 'Ann', 'verdant'], [1, 'Ben', 'iron']]), r1.humans);
  t.ok('the other civilizations are AI', r1.ai === 2, r1.ai);
  t.ok('the game opens on the first seat’s cover', r1.passTo === 0, r1.passTo);
  await page.waitForTimeout(100);
  t.ok('cover screen is shown, map hidden', await page.evaluate(() => document.getElementById('pass').style.display !== 'none' && document.querySelector('#map canvas').style.visibility === 'hidden'));
  t.ok('cover names the player', /Ann/.test(await page.textContent('#pass')));
  await page.click('[data-a="begin-seat"]');
  await page.waitForTimeout(100);
  t.ok('Begin turn removes the cover', await page.evaluate(() => window.hexborne.store.getState().passTo === null && document.getElementById('pass').style.display === 'none'));

  // Seat 0 founds a city and ends the turn: seat 1 is next, same turn, nothing else moved.
  const r2 = await page.evaluate(async () => {
    const h = window.hexborne;
    const s = h.state;
    const found = (p) => {
      const u = Object.values(s.units).find((x) => x.owner === p && x.type === 'settler');
      return h.act({ type: 'found', unit: u.id }).ok;
    };
    const f0 = found(0);
    const aiUnits = JSON.stringify(Object.values(s.units).filter((u) => u.owner === 2).map((u) => u.tile));
    await h.endTurn(true);
    const after1 = { human: s.human, turn: s.turn, passTo: h.store.getState().passTo, aiSame: JSON.stringify(Object.values(s.units).filter((u) => u.owner === 2).map((u) => u.tile)) === aiUnits };
    h.set({ passTo: null });
    const f1 = found(1);
    // A human can't act for the other seat.
    const theirs = Object.values(s.units).find((x) => x.owner === 0);
    const cross = h.act({ type: 'order', unit: theirs.id, order: 'fortify' }).ok;
    await h.endTurn(true);
    const g = h.state;
    return { f0, f1, after1, cross, human: g.human, turn: g.turn, passTo: h.store.getState().passTo, aiCities: Object.values(g.cities).filter((c) => c.owner === 2 || c.owner === 3).length };
  });
  t.ok('seats found their cities', r2.f0 && r2.f1);
  t.ok('ending seat 1’s turn passes to seat 2 (same turn, AI waits)', r2.after1.human === 1 && r2.after1.turn === 0 && r2.after1.passTo === 1 && r2.after1.aiSame, r2.after1);
  t.ok('a seat cannot order the other seat’s units', !r2.cross);
  t.ok('after the last seat the AI moves and a new turn starts with seat 1', r2.turn === 1 && r2.human === 0 && r2.passTo === 0, r2);
  t.ok('AI civilizations played (founded cities)', r2.aiCities >= 1, r2.aiCities);

  // Human ↔ human peace waits for the other seat's answer.
  const r3 = await page.evaluate(() => {
    const h = window.hexborne;
    const s = h.state;
    for (const [a, b] of [[0, 1], [1, 0]]) if (!s.players[a].met.includes(b)) s.players[a].met.push(b);
    h.core.setWar(s, 0, 1, true);
    s.diplomacy.changed[0][1] = s.diplomacy.changed[1][0] = -50;
    const offer = h.act({ type: 'makePeace', target: 1 }).ok;
    const stillWar = s.diplomacy.war[0][1];
    const waiting = s.diplomacy.proposals.filter((x) => x.kind === 'peace' && x.deal.b === 1).length;
    s.human = 1;
    const idx = s.diplomacy.proposals.filter((x) => x.deal.b === 1).findIndex((x) => x.kind === 'peace');
    const ok = h.act({ type: 'respond', index: idx, accept: true }).ok;
    s.human = 0;
    return { offer, stillWar, waiting, ok, peace: !s.diplomacy.war[0][1] };
  });
  t.ok('offering peace to a human makes a proposal (still at war)', r3.offer && r3.stillWar && r3.waiting === 1, r3);
  t.ok('the other seat accepts and there is peace', r3.ok && r3.peace, r3);

  // Saves keep the seats; loading a hotseat game shows the cover.
  const r4 = await page.evaluate(async () => {
    const h = window.hexborne;
    await h.save('hotseat-test');
    const g = await h.load('hotseat-test');
    return { humans: g.players.filter((p) => p.isHuman).map((p) => p.nick) };
  });
  t.ok('a saved hotseat game keeps its seats', JSON.stringify(r4.humans) === JSON.stringify(['Ann', 'Ben']), r4);

  // Single-player games are unchanged: no cover.
  const r5 = await page.evaluate(() => {
    const h = window.hexborne;
    h.start({ seed: 'solo', mapSize: 'duel' });
    return { passTo: h.store.getState().passTo, humans: h.state.players.filter((p) => p.isHuman).length };
  });
  t.ok('single-player: one human, no cover', r5.passTo === null && r5.humans === 1, r5);
});
