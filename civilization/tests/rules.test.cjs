// Rules in isolation: formulas, movement (costs, rivers, ZOC, one unit per tile), founding,
// growth and production, combat and previews, capturing a city, camps, ruins and research.
const { run } = require('./harness.cjs');

run('rules', async ({ page }, t) => {
  const r = await page.evaluate(() => {
    const h = window.hexborne;
    const C = h.core;
    const out = {};
    const s = h.start({ seed: 'rules', mapSize: 'duel', barbarians: false, ruins: false });
    const m = s.map;
    out.growth = [1, 2, 3].map((pop) => C.growthNeeded(s, { pop, owner: 0 }));
    out.dmg = [C.damage(1, 1), C.damage(2, 1), C.damage(0.5, 1)];

    const center = 12 * m.w + 20;
    const far = 12 * m.w + 0;
    window.flatten(s, center, 7);
    window.flatten(s, far, 3);
    C.foundCity(s, 1, far); // keeps player 1 alive (the game would otherwise end)
    const E = (i, d) => C.neighbor(m, i, d);
    const mk = (type, owner, tile) => C.createUnit(s, type, owner, tile);
    const reset = () => {
      for (const id of Object.keys(s.units)) delete s.units[id];
      for (const tl of m.tiles) {
        tl.road = false;
        tl.river = 0;
      }
    };

    // --- Movement ---
    const w = mk('warrior', 0, center);
    C.recomputeAllVisibility(s);
    const goal = E(E(E(E(center, 0), 0), 0), 0);
    const p1 = C.findPath(s, w, goal);
    out.flatPath = { len: p1.path.length, turns: p1.turns };
    for (let i = center, k = 0; k <= 4; k++, i = E(i, 0)) m.tiles[i].road = true;
    const p2 = C.findPath(s, w, goal);
    out.roadPath = { len: p2.path.length, turns: p2.turns };
    reset();

    // River: crossing takes all movement.
    const w2 = mk('warrior', 0, center);
    m.tiles[center].river |= 1 << 0;
    m.tiles[E(center, 0)].river |= 1 << 3;
    C.recomputeAllVisibility(s);
    out.river = h.act({ type: 'move', unit: w2.id, to: E(center, 0) }).ok && s.units[w2.id].moves === 0;
    reset();

    // Zone of control: stepping between two tiles next to an enemy ends the move.
    C.setWar(s, 0, 1, true);
    const A = E(center, 0);
    const z = mk('warrior', 0, A);
    mk('warrior', 1, E(A, 0));
    C.recomputeAllVisibility(s);
    h.act({ type: 'move', unit: z.id, to: E(A, 1) });
    out.zoc = { tile: s.units[z.id].tile === E(A, 1), moves: s.units[z.id].moves };
    reset();
    const z2 = mk('warrior', 0, A);
    C.recomputeAllVisibility(s);
    h.act({ type: 'move', unit: z2.id, to: E(A, 1) });
    out.noZoc = s.units[z2.id].moves;
    reset();

    // One military + one civilian per tile.
    const a = mk('warrior', 0, center);
    const b = mk('warrior', 0, E(center, 0));
    const wk = mk('worker', 0, E(center, 3));
    C.recomputeAllVisibility(s);
    out.stackMil = h.act({ type: 'move', unit: b.id, to: center }).ok;
    out.stackCiv = h.act({ type: 'move', unit: wk.id, to: center }).ok;
    reset();
    void a;

    // --- Founding ---
    const st1 = mk('settler', 0, center);
    out.found = h.act({ type: 'found', unit: st1.id }).ok;
    const city = Object.values(s.cities).find((c) => c.owner === 0);
    out.cityTiles = m.tiles.filter((tl) => tl.cityId === city.id).length;
    out.capital = city.isCapital && city.buildings.includes('palace');
    const near = E(E(E(center, 3), 3), 3);
    const st2 = mk('settler', 0, near);
    const tooClose = h.act({ type: 'found', unit: st2.id });
    out.tooClose = !tooClose.ok && /too close/.test(tooClose.error);
    s.units[st2.id].tile = E(near, 3);
    out.fourAway = h.act({ type: 'found', unit: st2.id }).ok;

    // --- Growth and production ---
    C.setWar(s, 0, 1, false);
    s.diplomacy.changed[0][1] = -99;
    h.act({ type: 'research', tech: 'pottery' });
    h.act({ type: 'produce', city: city.id, item: { kind: 'unit', id: 'warrior' } });
    const second = Object.values(s.cities).find((c) => c.owner === 0 && c.id !== city.id);
    h.act({ type: 'produce', city: second.id, item: { kind: 'building', id: 'monument' } });
    for (let k = 0; k < 15; k++) h.endTurnSync();
    out.grew = city.pop;
    out.builtWarrior = Object.values(s.units).some((u) => u.owner === 0 && u.type === 'warrior');
    out.researched = s.players[0].techs.includes('pottery');

    // --- Combat ---
    reset();
    C.setWar(s, 0, 1, true);
    const att = mk('warrior', 0, E(center, 4));
    const def = mk('warrior', 1, E(E(center, 4), 4));
    C.recomputeAllVisibility(s);
    const before = def.hp;
    const res = h.act({ type: 'attack', unit: att.id, to: def.tile });
    out.melee = { ok: res.ok, dealt: before - (s.units[def.id]?.hp ?? 0), attackerHurt: s.units[att.id] ? s.units[att.id].hp < 100 : true };
    reset();
    const archer = mk('archer', 0, E(center, 4));
    const target = mk('warrior', 1, E(E(E(center, 4), 4), 4));
    C.recomputeAllVisibility(s);
    const r2 = h.act({ type: 'attack', unit: archer.id, to: target.tile });
    out.ranged = { ok: r2.ok, err: r2.error, archerHp: s.units[archer.id].hp, targetHp: s.units[target.id]?.hp };

    // --- Capturing a city ---
    reset();
    const enemyCity = Object.values(s.cities).find((c) => c.owner === 1);
    const by = E(enemyCity.tile, 0);
    const cap = mk('swordsman', 0, by);
    m.tiles[by].owner = -1;
    C.recomputeAllVisibility(s);
    enemyCity.hp = 1;
    const r3 = h.act({ type: 'attack', unit: cap.id, to: enemyCity.tile });
    out.capture = { ok: r3.ok, err: r3.error, owner: enemyCity.owner, pending: s.players[0].pendingCaptures.includes(enemyCity.id), winner: s.winner };
    return out;
  });
  t.ok('growth formula: 15, 22, 30 food for sizes 1–3', JSON.stringify(r.growth) === '[15,22,30]', r.growth);
  t.ok('damage curve: 30 at even odds, 52 at 2:1, 17 at 1:2', JSON.stringify(r.dmg) === '[30,52,17]', r.dmg);
  t.ok('flat path: 4 tiles take 2 turns', r.flatPath.len === 4 && r.flatPath.turns === 2, r.flatPath);
  t.ok('road path: the same 4 tiles take 1 turn', r.roadPath.len === 4 && r.roadPath.turns === 1, r.roadPath);
  t.ok('crossing a river uses all movement', r.river === true);
  t.ok('zone of control ends the move', r.zoc.tile && r.zoc.moves === 0, r.zoc);
  t.ok('without an enemy the same step leaves movement', r.noZoc > 0, r.noZoc);
  t.ok('two military units cannot share a tile', r.stackMil === false);
  t.ok('a civilian can join a military unit', r.stackCiv === true);
  t.ok('a settler founds a city with 7 tiles', r.found && r.cityTiles === 7, r.cityTiles);
  t.ok('the first city is the capital with a Palace', r.capital);
  t.ok('cities must be at least 4 tiles apart', r.tooClose);
  t.ok('4 tiles away is fine', r.fourAway);
  t.ok('the capital grew', r.grew >= 2, r.grew);
  t.ok('the city trained a warrior', r.builtWarrior);
  t.ok('research finished', r.researched);
  t.ok('melee attack hurts both sides', r.melee.ok && r.melee.dealt > 0 && r.melee.attackerHurt, r.melee);
  t.ok('ranged attack takes no damage back', r.ranged.ok && r.ranged.archerHp === 100 && (r.ranged.targetHp ?? 0) < 100, r.ranged);
  t.ok('a melee unit captures a city at 0 HP', r.capture.ok && r.capture.owner === 0 && r.capture.pending, r.capture);
});
