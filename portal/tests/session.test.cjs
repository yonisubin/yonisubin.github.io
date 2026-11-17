// The GameSession contract: chamber start events and autosave, snapshot → restore identity (and
// identical futures after two restores), loading a chamber disposes the previous one, counters,
// pause, settings taking effect, idle / out-of-bounds / footstep events.
const { run } = require('./harness.cjs');

run('session', async ({ page }, t) => {
  const r = await page.evaluate(() => {
    const tf = window.twinfold, S = tf.session, THREE = tf.THREE, out = {};
    const ev = (name) => tf.log.filter((e) => e[0] === name).map((e) => e[1]);
    const el = (id) => tf.element(id);
    const sandbox = tf.levels.sandbox;
    const counts = () => ({ colliders: tf.physics.world.colliders.len(), bodies: tf.physics.world.bodies.len(), objects: (() => { let n = 0; tf.scene.traverse(() => n++); return n; })() });

    // --- Loading: events, autosave, and full disposal of the previous chamber. ------------------
    const starts0 = ev('chamberStart').length;
    S.loadChamber(sandbox);
    out.started = ev('chamberStart').slice(starts0).map((e) => e.chamberId);
    out.autosave = ev('autosave').slice(-1)[0];
    out.current = S.current().id;
    tf.simulate(0.5);
    const c1 = counts();
    S.loadChamber(tf.levels.testroom);
    S.loadChamber(sandbox);
    tf.simulate(0.5);
    out.counts = [c1, counts()];

    // --- A busy moment: portals, a carried cube, a pellet in flight, a running pedestal timer. --
    tf.place([-12, 0, 11.5]);
    tf.fire('a', [-12, 1.5, 0], [0, 0, -1]);
    tf.fire('b', [-12, 1.5, 0], [-1, 0, 0]);
    tf.aim(0, -0.7);
    tf.simulate(0.2);
    tf.use();
    out.held = tf.chamber.heldId();
    tf.hold('forward', true);
    tf.simulate(1.2);
    tf.hold('forward', false);
    el('pedTimer').use();
    tf.simulate(0.7);
    out.counters = S.counters();
    const s1 = S.snapshot();
    out.snapshotKeys = Object.keys(s1);
    out.snapshotJson = JSON.stringify(s1) === JSON.stringify(JSON.parse(JSON.stringify(s1)));
    S.restore(s1, sandbox);
    const s2 = S.snapshot();
    out.identical = JSON.stringify(s1) === JSON.stringify(s2);
    if (!out.identical) {
      const diff = [];
      const walk = (a, b, path) => {
        if (diff.length > 5) return;
        if (typeof a !== 'object' || a === null) {
          if (a !== b) diff.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
          return;
        }
        for (const k of new Set([...Object.keys(a), ...Object.keys(b || {})])) walk(a[k], b ? b[k] : undefined, `${path}.${k}`);
      };
      walk(s1, s2, '');
      out.diff = diff;
    }
    out.heldAfterRestore = tf.chamber.heldId();
    // Same future after two restores.
    tf.simulate(1);
    const f1 = JSON.stringify(S.snapshot());
    S.restore(s1, sandbox);
    tf.simulate(1);
    const f2 = JSON.stringify(S.snapshot());
    out.sameFuture = f1 === f2;
    // Restoring doesn't announce a new chamber.
    out.startsAfterRestore = ev('chamberStart').length - starts0;

    // --- Counters: portals placed, steps, time (only device shots that worked count). ----------
    S.loadChamber(sandbox);
    tf.fire('a', [-12, 1.5, 0], [0, 0, -1]);
    tf.fire('a', [-12, 1.5, 0], [0, 0, 1]); // south wall
    tf.fire('b', [-12, 1.5, 0], [0, 1, 0.0001]); // ceiling
    tf.fire('b', [16, 1, 5], [1, 0, 0]); // metal gallery wall... (fails)
    tf.place([-10, 0, 0], Math.PI / 2);
    tf.hold('forward', true);
    tf.simulate(2);
    tf.hold('forward', false);
    out.counters2 = S.counters();
    out.footsteps = ev('footstep').slice(-3);

    // --- Pause: no simulation while paused. ----------------------------------------------------
    const t0 = S.counters().time;
    S.setPaused(true);
    tf.simulate(1);
    const t1 = S.counters().time;
    S.setPaused(false);
    tf.simulate(1);
    out.pause = [t1 - t0, S.counters().time - t1];

    // --- Settings. ------------------------------------------------------------------------------
    S.applySettings({ fov: 100, mouseSensitivity: 2, invertY: true, recursionDepth: 3, portalColors: { a: 0x00ff00, b: 0xff00ff }, reduceRoll: true, assist: true, toggleCrouch: true, renderScale: 0.5 });
    out.settings = {
      fov: tf.camera.fov,
      sens: tf.player.rig.sensitivity / tf.config.camera.mouseSensitivity,
      invert: tf.player.rig.invertY,
      depth: tf.renderer.recursionDepth,
      colors: tf.renderer.colors,
      roll: tf.player.rig.reduceRoll,
      nudge: tf.portals.nudgeMax,
      toggle: tf.player.toggleCrouch,
    };
    const pitch0 = tf.player.rig.pitch;
    tf.player.rig.look(0, 10);
    out.invertedLook = tf.player.rig.pitch > pitch0;
    // Toggle crouch: tap once → stays crouched; tap again → stands.
    tf.place([-10, 0, 0]);
    tf.simulate(0.2);
    tf.hold('crouch', true);
    tf.simulate(0.1);
    tf.hold('crouch', false);
    tf.simulate(0.3);
    const c1c = tf.player.crouched;
    tf.hold('crouch', true);
    tf.simulate(0.1);
    tf.hold('crouch', false);
    tf.simulate(0.3);
    out.toggleCrouch = [c1c, tf.player.crouched];
    // Recursion depth 3: facing portals render 3 levels deep at most.
    tf.renderNow();
    out.maxLevel = tf.renderer.stats.maxLevel;
    S.applySettings({ fov: 90, mouseSensitivity: 1, invertY: false, recursionDepth: 9, portalColors: { ...tf.config.portal.colors }, reduceRoll: false, assist: false, toggleCrouch: false, renderScale: 1 });

    // --- Idle, out of bounds. -----------------------------------------------------------------
    S.loadChamber(sandbox);
    const idle0 = ev('idle').length;
    tf.simulate(21);
    out.idle = ev('idle').slice(idle0);
    const oob0 = ev('outOfBounds').length;
    tf.player.noclip = true;
    tf.place([0, 2, 25]);
    tf.simulate(0.1);
    tf.player.noclip = false;
    out.oob = ev('outOfBounds').length - oob0;

    // --- respawn(): back to the last autosave. --------------------------------------------------
    S.loadChamber(sandbox);
    tf.place([5, 0, 5]);
    tf.simulate(0.2);
    S.respawn();
    out.respawn = { pos: tf.player.position.toArray(), events: ev('respawn').length };
    // restartChamber(): a fresh start (and a chamberStart).
    const st0 = ev('chamberStart').length;
    S.restartChamber();
    out.restartEvents = ev('chamberStart').length - st0;
    return out;
  });

  t.ok('chamberStart on load', r.started[0] === 'sandbox', JSON.stringify(r.started));
  t.ok('autosave at chamber start', r.autosave && r.autosave.reason === 'chamberStart');
  t.ok('current() is the loaded level', r.current === 'sandbox');
  t.ok('reloading leaves nothing behind (colliders, bodies, scene objects)', JSON.stringify(r.counts[0]) === JSON.stringify(r.counts[1]), JSON.stringify(r.counts));
  t.ok('carrying a cube for the snapshot', r.held === 'cube1');
  t.ok('snapshot has the contract fields', ['version', 'chamberId', 'checkpoint', 'counters', 'player', 'portals', 'entities'].every((k) => r.snapshotKeys.includes(k)));
  t.ok('snapshot is plain JSON', r.snapshotJson);
  t.ok('snapshot → restore → snapshot is identical', r.identical, JSON.stringify(r.diff || []));
  t.ok('restore keeps the carried prop', r.heldAfterRestore === 'cube1');
  t.ok('two restores have the same future', r.sameFuture);
  t.ok("restore doesn't emit chamberStart", r.startsAfterRestore === 3, String(r.startsAfterRestore));
  t.ok('portal counter counts placed portals only', r.counters2.portals === 3, JSON.stringify(r.counters2));
  t.ok('step counter counts footsteps', r.counters2.steps >= 4, JSON.stringify(r.counters2));
  t.ok('footstep events carry the surface', r.footsteps.length && r.footsteps.every((f) => f.surface === 'panel'), JSON.stringify(r.footsteps));
  t.ok('paused: no time passes', r.pause[0] === 0 && Math.abs(r.pause[1] - 1) < 0.02, JSON.stringify(r.pause));
  const s = r.settings;
  t.ok('fov applied', s.fov === 100);
  t.near('sensitivity multiplier applied', s.sens, 2, 1e-9);
  t.ok('invert Y applied', s.invert && r.invertedLook);
  t.ok('recursion depth applied', s.depth === 3);
  t.ok('portal colours applied', s.colors.a === 0x00ff00 && s.colors.b === 0xff00ff);
  t.ok('reduce roll applied', s.roll);
  t.ok('assist widens placement tolerance', s.nudge === 1.8);
  t.ok('toggle crouch: tap to crouch, tap to stand', r.toggleCrouch[0] === true && r.toggleCrouch[1] === false, JSON.stringify(r.toggleCrouch));
  t.ok('idle after ~20 s without input', r.idle.length === 1 && r.idle[0].seconds === 20, JSON.stringify(r.idle));
  t.ok('outOfBounds when outside the chamber', r.oob === 1, String(r.oob));
  t.ok('respawn() goes back to the autosave', Math.abs(r.respawn.pos[0] + 17) < 0.01 && r.respawn.events >= 1, JSON.stringify(r.respawn));
  t.ok('restartChamber() starts the chamber again', r.restartEvents === 1);
});
