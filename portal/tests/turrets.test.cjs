// Turrets and the rocket turret in the sandbox: idle → active (cone, line of sight, wind-up,
// bursts of 4–10 % damage) → searching → idle; knocked over (tipped: wild fire, then shut down);
// carried from behind (no fire) vs from the front; dissolved by a grill; destroyed by a fall;
// original barks as captions; rockets that hurt, and a rocket redirected through portals into the
// boss core (hit → part detaches → disposal → ... → defeated).
const { run } = require('./harness.cjs');

run('turrets', async ({ page }, t) => {
  const r = await page.evaluate(() => {
    const tf = window.twinfold, S = tf.session, THREE = tf.THREE, out = {};
    const el = (id) => tf.element(id);
    const ev = (name) => tf.log.filter((e) => e[0] === name).map((e) => e[1]);
    S.loadChamber(tf.levels.sandbox);
    tf.place([-17, 0, -12]);
    tf.simulate(1);
    const T = el('tur1');
    out.idle = T.state;

    // In front of it, inside the gallery: spots you, winds up, fires bursts.
    const dmg0 = ev('damage').length;
    tf.place([14, 0, 5], -Math.PI / 2);
    tf.simulate(0.2);
    out.spotted = T.state;
    out.firedDuringWindup = T.fired;
    tf.simulate(1.0);
    out.fired = T.fired;
    const dmg = ev('damage').slice(dmg0);
    out.damages = dmg.map((d) => d.amount);
    out.health = tf.chamber.health;
    // Behind the gallery wall: lost; searching, then idle.
    tf.place([10, 0, 5]);
    tf.simulate(0.2);
    out.lost = T.state;
    tf.simulate(3.2);
    out.backIdle = T.state;
    out.barks = ev('sfx').filter((s) => s.name.startsWith('turret_')).map((s) => s.caption);

    // Knocked over: tipped, fires wildly, then shuts down.
    S.restartChamber();
    tf.place([-17, 0, -12]);
    const T1 = el('tur1');
    T1.body.setAngvel({ x: 0, y: 0, z: 7 }, true);
    T1.body.setLinvel({ x: -1, y: 2, z: 0 }, true);
    let tipped = false;
    for (let i = 0; i < 60; i++) {
      tf.simulate(1 / 60);
      tipped = tipped || T1.state === 'tipped';
    }
    const wild0 = T1.fired;
    tf.simulate(0.5);
    out.tipped = { tipped, state: T1.state, wildShots: T1.fired - wild0 };
    tf.simulate(2);
    const f0 = T1.fired;
    tf.simulate(1);
    out.tippedOff = { disabled: T1.disabled(), firedAfter: T1.fired - f0 };

    // Carried from behind: no fire. From the front: it still shoots.
    S.restartChamber();
    const T2 = el('tur2');
    tf.simulate(0.5);
    tf.place([19.3, 0, 3.5], Math.PI / 2); // behind it, facing west like it
    tf.aim(Math.PI / 2, -0.35);
    tf.simulate(0.1);
    out.turretPrompt = ev('prompt').slice(-1)[0]?.text;
    tf.use();
    out.heldTurret = tf.chamber.heldId();
    const fb = T2.fired;
    tf.simulate(1.5);
    out.behind = { state: T2.state, fired: T2.fired - fb };
    tf.use(); // put it down
    tf.simulate(0.5);
    S.restartChamber();
    const T3 = el('tur2');
    tf.place([16.6, 0, 3.5], -Math.PI / 2); // in front of it, facing it
    tf.aim(-Math.PI / 2, -0.35);
    tf.simulate(0.1);
    tf.use();
    const ff = T3.fired;
    tf.simulate(1.2);
    out.front = { held: tf.chamber.heldId(), state: T3.state, fired: T3.fired - ff };

    // Dissolved by a grill; destroyed by a fall.
    S.restartChamber();
    tf.place([-17, 0, -12]);
    const T4 = el('tur1');
    T4.body.setTranslation({ x: -2, y: 1, z: 8 }, true);
    tf.simulate(0.2);
    out.dissolved = { state: T4.state, alive: T4.alive };
    const T5 = el('tur2');
    T5.body.setTranslation({ x: 0, y: 9, z: 2 }, true);
    T5.body.setLinvel({ x: 0, y: -3, z: 0 }, true);
    tf.simulate(2);
    out.fell = T5.state;

    // Rocket turret: switched on with its pedestal, it fires at you and the blast hurts.
    S.restartChamber();
    const RT = el('rockets');
    tf.place([8, 0, -4], -Math.PI / 2);
    tf.simulate(1.5);
    out.rocketsWhileOff = RT.fired;
    el('pedRocket').use();
    const h0 = tf.chamber.health;
    const dm0 = ev('damage').length;
    for (let i = 0; i < 5 * 60 && RT.explosions === 0; i++) tf.simulate(1 / 60);
    out.rocket = { fired: RT.fired, explosions: RT.explosions, damage: ev('damage').length - dm0, health: tf.chamber.health, before: h0, deaths: ev('death').slice(-1)[0] };

    // A rocket redirected through portals into the boss core.
    S.restartChamber();
    tf.place([4, 0, 5]);
    const pa = tf.fire('a', [-14, 3, -2], [0, -1, 0.0001]); // floor
    const pb = tf.fire('b', [4, 6, -6], [0, 0, -1]); // north wall, level with the core
    const RT2 = el('rockets');
    RT2.fire();
    const rk = RT2.rockets[0];
    rk.p.set(-14, 1.2, -2);
    rk.v.set(0, -6, 0);
    rk.straight = 3; // no homing on this test shot: straight into the floor portal
    const boss0 = ev('boss').length;
    for (let i = 0; i < 6 * 60 && ev('boss').length === boss0; i++) tf.simulate(1 / 60);
    out.redirect = { pa: pa.ok, pb: pb.ok, boss: ev('boss').slice(boss0), core: { hits: el('core').hits, pending: el('core').pending } };
    // Dispose of the part: componentDisposed; two more rounds → defeated.
    const core = el('core');
    for (let round = 0; round < 3; round++) {
      if (round > 0) core.rocketHit();
      const part = el(core.pending);
      if (!part) break;
      tf.simulate(0.5);
      part.body.setTranslation({ x: 10, y: 1.2, z: 12.5 }, true);
      tf.simulate(0.3);
    }
    out.bossEvents = ev('boss').slice(boss0).map((b) => `${b.event}@${b.stage}`);
    out.defeated = core.outputs.defeated;
    return out;
  });

  t.ok('turret starts idle', r.idle === 'idle');
  t.ok('spots you in its cone', r.spotted === 'active', r.spotted);
  t.ok('winds up before the first shot', r.firedDuringWindup === 0);
  t.ok('fires bursts', r.fired >= 6, String(r.fired));
  t.ok('each bullet does 4–10 damage', r.damages.length >= 6 && r.damages.every((d) => d >= 4 && d <= 10), JSON.stringify(r.damages.slice(0, 8)));
  t.ok('health went down', r.health < 70, r.health.toFixed(1));
  t.ok('loses you behind a wall: searching', r.lost === 'searching', r.lost);
  t.ok('then back to idle', r.backIdle === 'idle', r.backIdle);
  t.ok('original barks captioned', r.barks.length >= 3 && r.barks.every((b) => typeof b === 'string' && b.length > 3), JSON.stringify(r.barks));
  t.ok('knocked over → tipped', r.tipped.tipped, JSON.stringify(r.tipped));
  t.ok('tipped turret fires wildly for a moment', r.tipped.wildShots > 0, JSON.stringify(r.tipped));
  t.ok('then shuts down for good', r.tippedOff.disabled && r.tippedOff.firedAfter === 0, JSON.stringify(r.tippedOff));
  t.ok('turret use prompt', r.turretPrompt === 'E  pick up', String(r.turretPrompt));
  t.ok('carried from behind', r.heldTurret === 'tur2');
  t.ok("carried from behind it doesn't fire", r.behind.fired === 0 && r.behind.state === 'searching', JSON.stringify(r.behind));
  t.ok('carried from the front it still fires', r.front.held === 'tur2' && r.front.fired > 0, JSON.stringify(r.front));
  t.ok('a grill dissolves a turret', r.dissolved.state === 'dissolved' && !r.dissolved.alive, JSON.stringify(r.dissolved));
  t.ok('a fall destroys a turret', r.fell === 'destroyed', r.fell);
  t.ok('rocket turret off until switched on', r.rocketsWhileOff === 0);
  t.ok('rocket fired and exploded on you', r.rocket.fired >= 1 && r.rocket.explosions >= 1 && r.rocket.damage >= 1, JSON.stringify(r.rocket));
  t.ok('redirect portals placed', r.redirect.pa && r.redirect.pb);
  t.ok('rocket through portals hits the boss core', r.redirect.boss.length >= 2 && r.redirect.boss[0].event === 'hit' && r.redirect.boss[1].event === 'componentDetached', JSON.stringify(r.redirect));
  t.ok('a part detached', r.redirect.core.pending === 'core-part1');
  t.ok('boss sequence: hit, detach, dispose ×3, defeated', JSON.stringify(r.bossEvents) === JSON.stringify(['hit@0', 'componentDetached@0', 'componentDisposed@0', 'hit@1', 'componentDetached@1', 'componentDisposed@1', 'hit@2', 'componentDetached@2', 'componentDisposed@2', 'defeated@3']), JSON.stringify(r.bossEvents));
  t.ok('core defeated output', r.defeated);
});
