// Phase 12: the World Congress (founding, delegates, proposals, voting, resolutions in force,
// the United Nations and the World Leader vote) and espionage (spies, stealing technology,
// diplomats, rigging elections).
const { run } = require('./harness.cjs');

run('congress and espionage', async ({ page }, t) => {
  const r = await page.evaluate(() => {
    const h = window.hexborne;
    const C = h.core;
    const out = {};
    const s = h.start({ seed: 'phase12', mapSize: 'small', barbarians: false });
    const pl = s.players[0];
    for (const a of s.players) for (const b of s.players) if (a !== b && !a.isBarbarian && !b.isBarbarian && !a.met.includes(b.id)) a.met.push(b.id);
    const settler = Object.values(s.units).find((u) => u.owner === 0 && u.type === 'settler');
    h.act({ type: 'found', unit: settler.id });
    h.act({ type: 'research', tech: 'pottery' });
    const cap = Object.values(s.cities).find((c) => c.owner === 0);
    h.act({ type: 'produce', city: cap.id, item: { kind: 'unit', id: 'warrior' } });
    // Into the Renaissance.
    for (const tech of h.D.techs.keys()) if (h.D.techs.get(tech).era <= 3 && !pl.techs.includes(tech)) pl.techs.push(tech);
    h.endTurnSync();
    out.founded = !!s.congress && s.congress.host === 0;
    out.spy = pl.spies.length >= 1;
    // --- Delegates ---
    const base = C.delegates(s, 0).total;
    const cs = s.players.find((p) => p.isMinor);
    cs.minor.influence[0] = 100;
    h.endTurnSync();
    out.allyDelegate = C.delegates(s, 0).total === base + 1;
    // --- Propose and vote ---
    out.propose = h.act({ type: 'propose', resolution: 'arts_funding' }).ok;
    const i = s.congress.proposals.findIndex((x) => x.resolution === 'arts_funding');
    const votes = s.congress.proposals.map((x, k) => (k === i ? C.delegates(s, 0).total : 0));
    out.vote = h.act({ type: 'vote', votes }).ok;
    out.tooMany = !h.act({ type: 'vote', votes: votes.map((v) => v * 100 + 100) }).ok;
    // Everyone else (AI) votes against... make it pass by giving us a big bloc.
    for (const m of s.players.filter((p) => p.isMinor)) m.minor.influence[0] = 100;
    h.endTurnSync();
    h.act({ type: 'vote', votes: s.congress.proposals.map((x, k) => (x.resolution === 'arts_funding' ? C.delegates(s, 0).total : 0)) });
    s.congress.nextSession = s.turn;
    h.endTurnSync();
    out.passed = s.congress.active.some((x) => x.resolution === 'arts_funding');
    // --- Resolutions with direct rules ---
    s.congress.active.push({ resolution: 'nuclear_ban', turn: s.turn });
    pl.techs.push('nuclear_fission');
    s.worldProjects.manhattan_project = 0;
    out.nukeBanned = !h.act({ type: 'produce', city: cap.id, item: { kind: 'unit', id: 'atomic_bomb' } }).ok;
    const ai = s.players.find((p) => !p.isMinor && !p.isBarbarian && p.id !== 0);
    s.congress.active.push({ resolution: 'embargo', target: ai.id, turn: s.turn });
    out.embargo = /embargo/.test(C.dealProblem(s, { a: 0, b: ai.id, items: [{ kind: 'embassy', from: 0 }] }) ?? '');
    // --- Espionage ---
    const spy = pl.spies[0];
    const aiCity = Object.values(s.cities).find((c) => c.owner === ai.id);
    for (const t2 of h.D.techs.keys()) if (h.D.techs.get(t2).era === 4 && !ai.techs.includes(t2)) ai.techs.push(t2);
    pl.explored[aiCity.tile] = 1;
    const mv = h.act({ type: 'moveSpy', spy: spy.id, to: aiCity.id });
    out.move = mv.ok || mv.error;
    spy.progress = C.stealTarget(s, ai.id);
    const known = pl.techs.length;
    h.endTurnSync();
    out.stole = pl.techs.length > known && spy.rank >= 1;
    // --- United Nations and the World Leader ---
    pl.techs.push('globalization');
    h.endTurnSync();
    out.un = s.congress.un && s.congress.proposals.some((x) => x.leader);
    const li = s.congress.proposals.findIndex((x) => x.leader);
    h.act({ type: 'vote', votes: s.congress.proposals.map((x, k) => (k === li ? 0 : 0)) });
    s.congress.nextSession = s.turn;
    h.endTurnSync();
    out.winner = s.winner;
    return out;
  });
  t.ok('the World Congress is founded by the first civilization to meet everyone in the Renaissance', r.founded);
  t.ok('the Renaissance brings a spy', r.spy);
  t.ok('an allied city-state adds a delegate', r.allyDelegate);
  t.ok('the host can propose a resolution', r.propose);
  t.ok('votes are cast within your delegates', r.vote && r.tooMany);
  t.ok('a resolution with more votes for than against passes', r.passed);
  t.ok('the Atomic Accord forbids building nukes', r.nukeBanned);
  t.ok('an embargo blocks deals', r.embargo);
  t.ok('Globalization makes it the United Nations with a World Leader vote', r.un);
  t.ok('our bloc of city-state delegates elects us World Leader (diplomatic victory)', r.winner && r.winner.kind === 'diplomatic' && r.winner.player === 0, r.winner);
  t.ok('a spy can be stationed in a rival city', r.move === true, r.move);
  t.ok('a spy steals a technology (and is promoted)', r.stole);
  await page.evaluate(() => window.hexborne.set({ panel: 'congress', endClosed: true }));
  await page.waitForTimeout(300);
  t.ok('the congress panel opens', /World Leader|United Nations/.test(await page.textContent('#modal')));
});
