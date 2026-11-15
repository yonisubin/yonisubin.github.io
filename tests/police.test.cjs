// Police and the wanted level: patrols, pursuit, arrest on foot, busted in a stopped car
// (without being smashed), never busted while hovering, the chase thinning out when stars
// drop, and busted-then-killed paying only the death penalty.
const { run } = require('./harness.cjs');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

run('police: patrols, pursuit, busted, hovering, thinning, busted while dying', async ({ page }, t) => {
  const roles = () => page.evaluate(() => window.game.police.units.map((u) => u.role));
  const count = (rs, role) => rs.filter((r) => r === role).length;

  await page.evaluate(() => {
    window.game.renderer.setAnimationLoop(null);
    window.game.simulate(2);
  });
  t.ok('two patrol cars with no stars', count(await roles(), 'patrol') === 2, (await roles()).join(','));

  // --- 2 stars on foot: pursuit, officers, arrest, fine, police station.
  const onFoot = await page.evaluate(() => {
    const g = window.game;
    // Set the heat directly: a patrol car that happens to see crimes counts them double.
    g.wanted.heat = 2.2;
    const stars = g.wanted.stars;
    let busted = false;
    for (let s = 0; s < 45 && !busted; s++) {
      g.simulate(1);
      busted = g.input.isBlocked;
    }
    return { stars, pursuers: g.police.units.filter((u) => u.role === 'pursuit').length, dropped: g.police.stats.dropped, busted, money: g.stats.money };
  });
  t.ok('heat 2.2 is 2 stars', onFoot.stars === 2, `${onFoot.stars}`);
  t.ok('2 stars: 4 pursuit cars', onFoot.pursuers === 4, `${onFoot.pursuers}`);
  t.ok('officers get out next to a player on foot', onFoot.dropped >= 1, `${onFoot.dropped}`);
  t.ok('officers arrest the player (busted)', onFoot.busted);
  await wait(3200); // the busted fade
  const after = await page.evaluate(() => {
    const g = window.game;
    const f = g.onFoot.focus();
    const station = g.places.police.map((s) => Math.hypot(s.spawn.x - f.x, s.spawn.z - f.z)).sort((a, b) => a - b)[0];
    return { money: g.stats.money, stars: g.wanted.stars, station, blocked: g.input.isBlocked };
  });
  t.ok('busted: fined $100 per star', after.money === onFoot.money - 200, `${onFoot.money} → ${after.money}`);
  t.ok('busted: wake up at a police station, stars cleared, controls back', after.station < 3 && after.stars === 0 && !after.blocked, `${after.station.toFixed(1)} m from the station`);

  // --- In a parked car at 3 stars: boxed in and busted, not smashed.
  const car = await page.evaluate(() => {
    const g = window.game;
    const car = g.cars[0];
    g.city.streamer.loadAround(car.interp.currPos, 450);
    g.simulate(0.1);
    g.player.setMode(car.mode);
    g.stats.health = 100;
    g.wanted.heat = 3.2;
    const c0 = car.body.translation();
    let shove = 0;
    let busted = false;
    for (let s = 0; s < 60 && !busted; s++) {
      g.simulate(1);
      const c = car.body.translation();
      shove = Math.max(shove, Math.hypot(c.x - c0.x, c.z - c0.z));
      busted = g.input.isBlocked;
    }
    return { shove, busted, health: g.stats.health };
  });
  t.ok('stopped in a car at 3★: busted', car.busted);
  t.ok('…without being rammed around', car.shove < 2 && car.health > 80, `shoved ${car.shove.toFixed(1)} m, health ${Math.round(car.health)}`);
  await wait(3200);

  // --- Hovering 30 m up over the police: never busted.
  const hover = await page.evaluate(() => {
    const g = window.game;
    const h = g.heli;
    g.player.setMode(h.mode);
    const p = h.body.translation();
    h.body.setTranslation({ x: p.x, y: p.y + 30, z: p.z }, true);
    h.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    h.rotor = 1;
    g.wanted.heat = 1.5;
    let busted = false;
    let closest = Infinity;
    for (let s = 0; s < 40 && !busted; s++) {
      // Hold it still in the air (as a hovering pilot would).
      const q = h.body.translation();
      h.body.setTranslation({ x: p.x, y: p.y + 30, z: p.z }, true);
      h.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      g.simulate(1);
      for (const u of g.police.units) if (u.role === 'pursuit') closest = Math.min(closest, Math.hypot(u.pos.x - q.x, u.pos.z - q.z));
      busted = g.input.isBlocked;
    }
    return { busted, closest };
  });
  t.ok('hovering 30 m above the police: not busted (with a car right below)', !hover.busted && hover.closest < 10, `closest car ${hover.closest.toFixed(1)} m away horizontally`);

  // --- Losing stars thins the chase (extra cars out of view go back to patrolling).
  const thin = await page.evaluate(() => {
    const g = window.game;
    g.player.setMode(g.onFoot);
    g.wanted.clear();
    g.police.reset();
    g.wanted.heat = 3.5;
    g.simulate(6);
    const before = g.police.units.filter((u) => u.role === 'pursuit').length;
    g.wanted.heat = 1.2;
    // Look at the sky so no car counts as "in view" (the camera stays put while the render
    // loop is stopped), then let them re-task.
    g.camera.lookAt(g.camera.position.x, g.camera.position.y + 100, g.camera.position.z);
    g.simulate(3);
    return { before, after: g.police.units.filter((u) => u.role === 'pursuit').length };
  });
  t.ok('3★ → 1★: the chase thins to ≤ 2 pursuers', thin.before === 6 && thin.after <= 2, `${thin.before} → ${thin.after}`);

  // --- Busted, then shot dead during the fade: only the death penalty, at a hospital.
  const dying = await page.evaluate(() => {
    const g = window.game;
    g.wanted.clear();
    g.police.reset();
    g.stats.money = 1000;
    g.stats.health = 100;
    g.wanted.heat = 3.2;
    g.police.hooks.busted();
    g.stats.damage(1000); // killed during the fade
    return { money: g.stats.money };
  });
  await wait(3500);
  const dead = await page.evaluate(() => {
    const g = window.game;
    const f = g.onFoot.focus();
    const near = (list) => list.map((s) => Math.hypot(s.spawn.x - f.x, s.spawn.z - f.z)).sort((a, b) => a - b)[0];
    return { money: g.stats.money, hospital: near(g.places.hospitals), station: near(g.places.police), blocked: g.input.isBlocked };
  });
  t.ok('busted then killed: only the 20% death loss, no fine', dead.money === 800, `$${dying.money} → $${dead.money}`);
  t.ok('…and you wake at a hospital with controls back', dead.hospital < 3 && !dead.blocked, `${dead.hospital.toFixed(1)} m from a hospital`);
}, { people: true });
