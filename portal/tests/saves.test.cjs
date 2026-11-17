// Saves in IndexedDB `twinfold`: slots, autosave on `autosave` events, quicksave / quickload (F5 / F9),
// Continue after a reload; save → load gives an identical snapshot.
const { run } = require('./harness.cjs');

run('saves', async ({ page }, t) => {
  // Set up a distinctive state: moved, looking somewhere, two portals, some steps.
  const r = await page.evaluate(async () => {
    const s = window.twinfoldShell, tf = window.twinfold, app = s.app;
    const out = {};
    out.auto = !!(await app.saves.read('auto'));
    tf.fire('a', [-8, 0.6, 12], [-1, 0, 0]);
    tf.fire('b', [8, 0.6, 12], [1, 0, 0]);
    tf.place([8, 0, 6], 0.7);
    tf.aim(0.7, -0.2);
    tf.hold('forward', true);
    tf.simulate(0.5);
    tf.hold('forward', false);
    tf.simulate(0.4);
    const before = s.session.snapshot();
    const saving = app.saveTo('slot2');
    // Snapshot is taken when saving starts; now mess everything up.
    await saving;
    tf.portals.clear();
    tf.place([-9, 0, -5], 2);
    tf.simulate(0.2);
    const rec = await app.saves.read('slot2');
    await app.loadSave(rec);
    const after = s.session.snapshot();
    out.before = before;
    out.after = after;
    out.rec = { kind: rec.kind, chamberId: rec.chamberId, name: rec.chamberName, hasProgress: !!rec.progress, ts: rec.timestamp > 0 };
    return out;
  });
  t.ok('the chamber start autosaved (autosave event)', r.auto);
  t.ok('snapshot had portals and steps', !!r.before.portals.a && !!r.before.portals.b && r.before.counters.steps > 0, JSON.stringify(r.before.counters));
  t.ok('save record holds chamber, timestamp and progress', r.rec.kind === 'manual' && r.rec.chamberId === 'testroom' && r.rec.hasProgress && r.rec.ts, JSON.stringify(r.rec));
  t.ok('save → load gives an identical snapshot', JSON.stringify(r.before) === JSON.stringify(r.after), JSON.stringify(r.after).slice(0, 200));

  // Autosave on a checkpoint event overwrites the auto slot.
  const auto = await page.evaluate(async () => {
    const s = window.twinfoldShell;
    const t0 = (await s.app.saves.read('auto')).timestamp;
    await new Promise((res) => setTimeout(res, 20));
    s.session.events.emit('autosave', { reason: 'checkpoint' });
    await new Promise((res) => setTimeout(res, 300));
    return (await s.app.saves.read('auto')).timestamp > t0;
  });
  t.ok('autosave events write the autosave slot', auto);

  // Quicksave / quickload with F5 / F9.
  await page.evaluate(() => window.twinfold.place([4, 0, 2], 1.1));
  await page.keyboard.press('F5');
  await page.waitForFunction(async () => !!(await window.twinfoldShell.app.saves.read('quick')));
  const qs = await page.evaluate(async () => (await window.twinfoldShell.app.saves.read('quick')).snapshot.player.position);
  await page.evaluate(() => window.twinfold.place([-6, 0, -10], 0));
  await page.keyboard.press('F9');
  await page.waitForFunction(() => window.twinfoldShell.app.log.some((l) => l === 'load quick'));
  const ql = await page.evaluate(() => {
    const p = window.twinfold.player;
    return [p.position.x, p.feetY(), p.position.z];
  });
  t.ok('F5 quicksaves where you stand', Math.abs(qs[0] - 4) < 0.05 && Math.abs(qs[2] - 2) < 0.05, JSON.stringify(qs));
  t.ok('F9 quickloads back there', Math.abs(ql[0] - 4) < 0.05 && Math.abs(ql[2] - 2) < 0.05, JSON.stringify(ql));
  t.ok('toast confirms', await page.evaluate(() => document.getElementById('toast').textContent.startsWith('Quick')));

  const list = await page.evaluate(async () => (await window.twinfoldShell.app.saves.list()).map((x) => x.key));
  t.ok('three slots in the list (newest first)', list.length === 3 && list[0] === 'quick' && list.includes('auto') && list.includes('slot2'), list.join(','));

  // Save from the pause menu into slot 1 through the UI.
  await page.evaluate(() => window.twinfoldShell.app.pause());
  await page.click('#overlay [data-id=save]');
  await page.click('#overlay [data-id=slot-slot1]');
  await page.waitForFunction(() => document.querySelector('#overlay [data-id=slot-slot1]') && document.querySelector('#overlay [data-id=slot-slot1]').textContent.includes('Slot 1 —'));
  t.ok('pause menu → Save writes a slot', await page.evaluate(async () => !!(await window.twinfoldShell.app.saves.read('slot1'))));

  // Reload: the main menu's Continue resumes the newest save.
  const newest = await page.evaluate(async () => (await window.twinfoldShell.app.saves.latest()).snapshot);
  await page.goto(page.url().split('?')[0]);
  await page.waitForFunction(() => window.twinfoldShell && window.twinfoldShell.ready, null, { timeout: 120000 });
  await page.waitForSelector('#overlay [data-id=continue]:not([disabled])');
  await page.click('#overlay [data-id=continue]');
  await page.waitForFunction(() => window.twinfoldShell.app.state === 'game');
  const cont = await page.evaluate(() => window.twinfoldShell.session.snapshot());
  t.ok('Continue after a reload restores the newest save', Math.abs(cont.player.position[0] - newest.player.position[0]) < 0.05 && Math.abs(cont.player.position[2] - newest.player.position[2]) < 0.05, JSON.stringify([cont.player.position, newest.player.position]));
  // Load Game screen lists every save.
  await page.evaluate(() => window.twinfoldShell.app.quitToMenu());
  await page.click('#overlay [data-id=loadGame]');
  await page.waitForSelector('#overlay [data-screen=load]');
  const rows = await page.evaluate(() => document.querySelectorAll('#overlay [data-screen=load] .slot').length);
  t.ok('Load Game lists all four saves', rows === 4, String(rows));
  const progress = await page.evaluate(() => window.twinfoldShell.app.saves.progress);
  t.ok('campaign progress remembers reached chambers', progress.reached.includes('testroom'), JSON.stringify(progress));
});
