// Hazards in the sandbox: energy pellets (bounce, expire and respawn, through portals into the
// catcher, kill on contact), grills (erase portals, dissolve carried and loose cubes, let shots
// through), toxic liquid, bottomless pits, crushers, health regeneration, and death → respawn at the
// last autosave in under 2 s.
const { run } = require('./harness.cjs');

run('hazards', async ({ page }, t) => {
  const r = await page.evaluate(() => {
    const tf = window.twinfold, S = tf.session, THREE = tf.THREE, out = {};
    const el = (id) => tf.element(id);
    const ev = (name) => tf.log.filter((e) => e[0] === name).map((e) => e[1]);
    const safe = () => tf.place([-17, 0, -12]);
    S.loadChamber(tf.levels.sandbox);
    safe();

    // --- Pellets: bounce off the far wall, expire, respawn. --------------------------------------
    let L = el('launcher1');
    tf.simulate(0.6);
    out.launched = L.alive;
    tf.simulate(6.5);
    out.bounced = L.bounces;
    out.headingBack = L.vel.x < 0;
    tf.simulate(6.0); // launched at 0.5 s, life 12 s
    out.expired = !L.alive;
    tf.simulate(1.6);
    out.respawned = L.alive && L.age < 1;

    // --- Pellet through a portal pair into the catcher. ----------------------------------------
    S.restartChamber();
    safe();
    out.pa = tf.fire('a', [10, 1.5, -6], [1, 0, 0]); // east wall, in the pellet's path
    out.pb = tf.fire('b', [-10, 1.5, 0], [0, 0, 1]); // south wall, lined up with the catcher
    L = el('launcher1');
    for (let i = 0; i < 14 * 60 && !el('catcher1').outputs.caught; i++) tf.simulate(1 / 60);
    out.caught = el('catcher1').outputs.caught;
    out.passes = L.passes;
    out.ind3 = el('ind3').outputs.on;
    tf.simulate(3);
    out.launcherStopped = L.done && !L.alive;

    // --- A pellet kills; death → respawn at the autosave in < 2 s. -----------------------------
    S.restartChamber();
    tf.place([-12, 0, -6]); // standing in the pellet's path
    const deaths0 = ev('death').length;
    let deathAt = null, respawnAt = null;
    for (let i = 0; i < 8 * 60; i++) {
      tf.simulate(1 / 60);
      if (deathAt === null && ev('death').length > deaths0) deathAt = i;
      if (deathAt !== null && respawnAt === null && ev('respawn').length > 0 && !tf.chamber.dead) {
        respawnAt = i;
        break;
      }
    }
    out.pelletDeath = ev('death').slice(-1)[0];
    out.respawnDelay = deathAt !== null && respawnAt !== null ? (respawnAt - deathAt) / 60 : null;
    out.respawnPos = tf.player.position.toArray();
    out.respawnHealth = tf.chamber.health;

    // --- Grill: shots pass; walking through erases the portals and dissolves the carried cube. --
    S.restartChamber();
    tf.place([-6, 0, 8]);
    out.shotThrough = tf.fire('a', [-5, 1.5, 9], [1, 0, 0]); // through the field to the east side
    tf.fire('b', [-6, 1.5, 8], [0, 0, 1]); // south wall
    // Pick up cube1 and walk east through the grill (x = -2).
    const cube1 = el('cube1');
    cube1.body.setTranslation({ x: -4.8, y: 0.4, z: 8 }, true);
    tf.place([-6, 0, 8], -Math.PI / 2);
    tf.simulate(0.5);
    tf.aim(-Math.PI / 2, -0.6);
    tf.use();
    out.carrying = tf.chamber.heldId();
    tf.aim(-Math.PI / 2, 0);
    tf.hold('forward', true);
    tf.simulate(1.5);
    tf.hold('forward', false);
    out.afterGrill = { a: !!tf.portals.a, b: !!tf.portals.b, x: tf.player.position.x, cubeAlive: cube1.alive, held: tf.chamber.heldId() };
    out.fizzled = ev('fizzled');
    // A loose cube pushed into the field dissolves too.
    const cube2 = el('cube2');
    cube2.body.setTranslation({ x: -3, y: 0.4, z: 7 }, true);
    cube2.body.setLinvel({ x: 4, y: 0, z: 0 }, true);
    tf.simulate(1);
    out.looseDissolved = !cube2.alive;
    out.dissolveFx = tf.effects.count >= 0;

    // --- Liquid, pit, crusher. ------------------------------------------------------------------
    const deathCause = (place) => {
      S.restartChamber();
      place();
      const n = ev('death').length;
      for (let i = 0; i < 6 * 60 && ev('death').length === n; i++) tf.simulate(1 / 60);
      return ev('death').length > n ? ev('death').slice(-1)[0].cause : null;
    };
    out.liquid = deathCause(() => tf.place([-4, 1, -10]));
    out.pit = deathCause(() => tf.place([4, 1, -10]));
    out.crusher = deathCause(() => tf.place([2, 0, 11]));

    // --- Health: damage, then regeneration. ----------------------------------------------------
    S.restartChamber();
    safe();
    tf.chamber.hurt(30, 'other');
    out.damage = ev('damage').slice(-1)[0];
    tf.simulate(1);
    out.healthWaiting = tf.chamber.health;
    tf.simulate(4);
    out.healthRegen = tf.chamber.health;

    // --- Respawn goes to the last checkpoint. --------------------------------------------------
    tf.place([0, 0, 13]);
    tf.simulate(0.2);
    tf.chamber.kill('other');
    tf.simulate(1.5);
    out.cpRespawn = { pos: tf.player.position.toArray(), dead: tf.chamber.dead };
    return out;
  });

  t.ok('launcher fires a pellet', r.launched);
  t.ok('pellet bounces off the far wall', r.bounced >= 1 && r.headingBack, `${r.bounced} bounces`);
  t.ok('pellet expires after its life', r.expired);
  t.ok('launcher fires a new one after it dies', r.respawned);
  t.ok('portals for the pellet placed', r.pa.ok && r.pb.ok, JSON.stringify([r.pa, r.pb]));
  t.ok('pellet goes through the portals into the catcher', r.caught && r.passes >= 1, `passes ${r.passes}`);
  t.ok('catcher output lights its indicator', r.ind3);
  t.ok('launcher stops once caught', r.launcherStopped);
  t.ok('a pellet kills the player', r.pelletDeath && r.pelletDeath.cause === 'pellet', JSON.stringify(r.pelletDeath));
  t.ok('death → respawn in under 2 s', r.respawnDelay !== null && r.respawnDelay < 2, String(r.respawnDelay));
  t.ok('respawned at the chamber start, healthy', Math.abs(r.respawnPos[0] + 17) < 0.1 && Math.abs(r.respawnPos[2] - 12.5) < 0.1 && r.respawnHealth === 100, JSON.stringify(r.respawnPos));
  t.ok('portal shots pass through a grill', r.shotThrough.ok && r.shotThrough.position[0] > 0, JSON.stringify(r.shotThrough));
  t.ok('picked up the cube', r.carrying === 'cube1');
  t.ok('walked through the grill', r.afterGrill.x > -2, JSON.stringify(r.afterGrill));
  t.ok('grill erased both portals', !r.afterGrill.a && !r.afterGrill.b);
  t.ok('grill dissolved the carried cube', !r.afterGrill.cubeAlive && r.afterGrill.held === null);
  t.ok('fizzled events for portals and the cube', r.fizzled.some((f) => f.what === 'portals') && r.fizzled.some((f) => f.what === 'object' && f.id === 'cube1'), JSON.stringify(r.fizzled));
  t.ok('a loose cube entering the field dissolves', r.looseDissolved);
  t.ok('toxic liquid kills', r.liquid === 'liquid', String(r.liquid));
  t.ok('bottomless pit kills', r.pit === 'pit', String(r.pit));
  t.ok('crusher kills', r.crusher === 'crusher', String(r.crusher));
  t.ok('damage event', r.damage && r.damage.amount === 30 && r.damage.health === 70, JSON.stringify(r.damage));
  t.near('no regeneration right away', r.healthWaiting, 70, 0.01);
  t.near('health regenerates', r.healthRegen, 100, 0.01);
  t.ok('respawn at the last checkpoint', !r.cpRespawn.dead && Math.abs(r.cpRespawn.pos[0]) < 0.1 && Math.abs(r.cpRespawn.pos[2] - 13) < 0.1, JSON.stringify(r.cpRespawn));
});
