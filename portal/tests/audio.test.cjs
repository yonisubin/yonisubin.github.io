// Audio: named sfx for the simulation's events (with a fallback), footsteps by surface, the carry
// hum, gain buses, adaptive music (chamber / elevator / menu modes, tension, stingers).
const { run } = require('./harness.cjs');

run('audio', async ({ page }, t) => {
  await page.waitForTimeout(500);
  const r = await page.evaluate(async () => {
    const s = window.twinfoldShell, app = s.app, ev = s.session.events, snd = app.sound, out = {};
    out.ctx = snd.ctx && snd.ctx.state;
    const names = ['buttonPress', 'button_release', 'door-open', 'doorClose', 'pickup', 'drop', 'pelletLaunch', 'pelletWhine', 'pelletCaught', 'turretFire', 'turretSpot', 'turretTip', 'elevatorChime', 'alarm', 'dissolve', 'fizzle', 'splash', 'crusher', 'timerTick', 'checkpoint', 'portalOpenA', 'portalOpenB'];
    out.unknownNames = names.filter((n) => !s.Sound.knows(n));
    const fb0 = snd.stats.fallback, n0 = snd.stats.sfx;
    for (const n of names) ev.emit('sfx', { name: n });
    out.played = snd.stats.sfx - n0;
    out.fallbacks = snd.stats.fallback - fb0;
    ev.emit('sfx', { name: 'somethingNew' });
    out.fallbackAfter = snd.stats.fallback - fb0;
    out.lastSfx = snd.stats.last;
    // Footsteps by surface.
    const f0 = { ...snd.stats.footsteps };
    ev.emit('footstep', { surface: 'metal' });
    ev.emit('footstep', { surface: 'glass' });
    ev.emit('footstep', { surface: 'panel' });
    out.steps = ['metal', 'glass', 'panel'].map((k) => (snd.stats.footsteps[k] ?? 0) - (f0[k] ?? 0));
    // The simulation's own bare footstep() is ignored once events carry surfaces (no doubles).
    const p0 = snd.stats.footsteps.panel;
    snd.footstep();
    out.bareIgnored = snd.stats.footsteps.panel === p0;
    // Carry hum follows pickup / drop.
    ev.emit('pickup', { id: 'cube1' });
    out.carrying = snd.carrying;
    ev.emit('drop', { id: 'cube1' });
    out.carryingAfter = snd.carrying;
    // Volumes reach the buses.
    app.setOption('effects', 0.3);
    out.effects = snd.volumes.effects;
    // Music: chamber mode after chamberStart; tension from damage; stingers; elevator on exit.
    ev.emit('chamberStart', { chamberId: 'testroom' });
    out.mode1 = app.music.mode;
    const notes0 = app.music.stats.notes;
    await new Promise((res) => setTimeout(res, 900));
    out.notes = app.music.stats.notes - notes0;
    ev.emit('damage', { amount: 30, health: 40 });
    await new Promise((res) => setTimeout(res, 600));
    out.tension = app.music.tension;
    ev.emit('checkpoint', { id: 'cp1' });
    out.stinger = app.music.stats.lastStinger;
    ev.emit('exitReached', { chamberId: 'testroom', portals: 0, steps: 0, time: 1 });
    out.mode2 = app.music.mode;
    out.stinger2 = app.music.stats.lastStinger;
    app.quitToMenu();
    out.mode3 = app.music.mode;
    // Dialogue ducks the music bus.
    app.dialogue.sayText('Testing the duck.', 2);
    out.ducked = snd.isDucked;
    app.dialogue.clear();
    out.unducked = !snd.isDucked;
    return out;
  });
  t.ok('audio context runs (autoplay allowed in tests)', r.ctx === 'running', r.ctx);
  t.ok('every expected sfx name has its own sound', r.unknownNames.length === 0 && r.fallbacks === 0, r.unknownNames.join(','));
  t.ok('sfx events play', r.played === 22);
  t.ok('unknown names fall back to a generic blip', r.fallbackAfter === 1 && r.lastSfx === 'somethingNew');
  t.ok('footsteps by surface', JSON.stringify(r.steps) === '[1,1,1]', JSON.stringify(r.steps));
  t.ok('no double footsteps from the simulation', r.bareIgnored);
  t.ok('carry hum on pickup, off on drop', r.carrying === true && r.carryingAfter === false);
  t.ok('effects volume applies', r.effects === 0.3);
  t.ok('chamber music after chamberStart', r.mode1 === 'chamber');
  t.ok('music notes are scheduled', r.notes > 5, String(r.notes));
  t.ok('damage raises the tension layer', r.tension > 0.2, r.tension.toFixed(2));
  t.ok('checkpoint stinger', r.stinger === 'checkpoint');
  t.ok('elevator music and the complete stinger on exit', r.mode2 === 'elevator' && r.stinger2 === 'complete');
  t.ok('menu music in the menu', r.mode3 === 'menu');
  t.ok('dialogue ducks music and effects', r.ducked && r.unducked);
});
