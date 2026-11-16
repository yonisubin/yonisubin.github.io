// Computer players: a headless AI-only game runs without errors, everyone expands, the same
// seed plays out identically, and barbarians and wars happen.
const { run } = require('./harness.cjs');

run('ai', async ({ page }, t) => {
  const r = await page.evaluate(() => {
    const h = window.hexborne;
    const t0 = performance.now();
    const s = h.simulate(150, { seed: 'ai-test', mapSize: 'small' });
    const ms = performance.now() - t0;
    const majors = s.players.filter((p) => !p.isBarbarian);
    const cities = majors.map((p) => Object.values(s.cities).filter((c) => c.owner === p.id).length);
    const techs = majors.map((p) => p.techs.length);
    const improved = s.map.tiles.filter((tl) => tl.improvement).length;
    const wars = majors.some((p) => majors.some((q) => s.diplomacy.war[p.id][q.id] || s.diplomacy.changed[p.id][q.id] > 0));
    const a = JSON.stringify(h.simulate(40, { seed: 'det', mapSize: 'duel' }));
    const b = JSON.stringify(h.simulate(40, { seed: 'det', mapSize: 'duel' }));
    const c = JSON.stringify(h.simulate(40, { seed: 'det2', mapSize: 'duel' }));
    return { turn: s.turn, ms, alive: majors.filter((p) => p.alive).length, cities, techs, improved, wars, same: a === b, differs: a !== c };
  });
  t.ok('150 AI turns finish', r.turn >= 150, `turn ${r.turn}, ${Math.round(r.ms)} ms`);
  t.ok('every surviving AI founded at least 2 cities', r.cities.filter((n) => n > 0).every((n) => n >= 2), r.cities);
  t.ok('AIs research', Math.min(...r.techs) >= 10, r.techs);
  t.ok('AI workers improve land', r.improved >= 15, r.improved);
  t.ok('AIs declare war at some point', r.wars);
  t.ok('same seed → same game', r.same);
  t.ok('different seed → different game', r.differs);
});
