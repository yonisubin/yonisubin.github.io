// Level loader: validation with readable errors, defaults / fix-ups with warnings, the chamber registry.
const { run } = require('./harness.cjs');

run('loader', async ({ page }, t) => {
  const r = await page.evaluate(() => {
    const s = window.twinfoldShell, v = s.validateLevel, out = {};
    out.testRoom = v(window.twinfold.level);
    out.fixed = v({
      name: '  ',
      spawn: { position: [0, 0, 0] },
      brushes: [{ min: [2, 0, 2], max: [-2, -1, -2], tag: 'shiny', faces: { '+y': 'metal', top: 'glass', '-y': 'shiny' } }],
      entities: [{ id: 'exit', type: 'exitElevator', position: [0, 0, -1], yaw: 'north', props: [] }],
      wiring: [],
      dialogue: [{ event: 'chamberStart' }],
      device: 'some',
    });
    out.notObject = v([1, 2]);
    out.version = v({ version: 3, name: 'x', spawn: { position: [0, 0, 0], yaw: 0 }, brushes: [{ min: [0, 0, 0], max: [1, 1, 1], tag: 'metal' }] });
    out.far = v({ name: 'x', spawn: { position: [0, 0, 1e9], yaw: 0 }, brushes: [{ min: [0, 0, 0], max: [1, 1, 1], tag: 'metal' }] });
    out.badWire = v({ name: 'x', spawn: { position: [0, 0, 0], yaw: 0 }, brushes: [{ min: [0, -1, 0], max: [1, 0, 1], tag: 'metal' }], entities: [{ id: 'b', type: 'floorButton', position: [0, 0, 0] }], wiring: [{ from: 'b', to: 'door.open' }] });
    out.registry = { first: s.chambers.firstChamber(), test: !!s.chambers.getChamber('testroom'), next: s.chambers.nextChamber('testroom'), campaign: s.chambers.CAMPAIGN.length };
    out.rooms = ['sandbox', 'fixedroom'].map((id) => {
      const l = s.chambers.getChamber(id);
      return !!l && s.validateLevel(JSON.parse(JSON.stringify(l))).errors.length === 0;
    });
    // export → import is stable
    const json = s.exportLevelJSON(window.twinfold.level);
    out.stable = s.exportLevelJSON(s.importLevelJSON(json)) === json;
    return out;
  });
  t.ok('the test room is valid', !!r.testRoom.level && r.testRoom.errors.length === 0, r.testRoom.errors.join(' | '));
  t.ok('… with a warning that it has no exit', r.testRoom.warnings.some((w) => w.includes('No exit elevator')));
  const f = r.fixed;
  t.ok('fixable problems become warnings, not errors', !!f.level && f.errors.length === 0, f.errors.join(' | '));
  t.ok('defaults: version 2, name, spawn yaw', f.level.version === 2 && f.level.name === 'Untitled chamber' && f.level.spawn.yaw === 0);
  t.ok('swapped min/max fixed', JSON.stringify(f.level.brushes[0].min) === '[-2,-1,-2]' && JSON.stringify(f.level.brushes[0].max) === '[2,0,2]');
  t.ok('unknown tags fall back to portalable, bad faces dropped', f.level.brushes[0].tag === 'portalable' && JSON.stringify(f.level.brushes[0].faces) === '{"+y":"metal"}', JSON.stringify(f.level.brushes[0]));
  t.ok('bad yaw / props / hooks / device dropped with warnings', f.level.entities[0].yaw === undefined && f.level.entities[0].props === undefined && !f.level.dialogue && !f.level.device && f.warnings.length >= 6, f.warnings.join(' | '));
  t.ok('non-objects are rejected', !r.notObject.level && r.notObject.errors[0].includes('JSON object'));
  t.ok('other versions are rejected', !r.version.level && r.version.errors[0].includes('version'));
  t.ok('absurd coordinates are rejected', !r.far.level && r.far.errors[0].includes('2000 m'));
  t.ok('malformed wires explain the expected form', !r.badWire.level && r.badWire.errors.some((e) => e.includes('"entityId.port"')), r.badWire.errors.join(' | '));
  t.ok('registry: test room registered, New Game starts there until wave 2', r.registry.test && r.registry.first === 'testroom' && r.registry.next === null && r.registry.campaign === 0, JSON.stringify(r.registry));
  t.ok('export → import → export is stable', r.stable);
  t.ok('the sandbox and fixed room are registered and valid', r.rooms[0] && r.rooms[1], JSON.stringify(r.rooms));

  // ?chamber=<id> starts the shell straight in a registered chamber.
  await page.goto(page.url().split('?')[0] + '?chamber=sandbox');
  await page.waitForFunction(() => window.twinfoldShell && window.twinfoldShell.ready, null, { timeout: 120000 });
  const direct = await page.evaluate(() => ({ state: window.twinfoldShell.app.state, id: window.twinfoldShell.session.current().id, overlay: getComputedStyle(document.getElementById('overlay')).display }));
  t.ok('?chamber=sandbox plays the sandbox', direct.state === 'game' && direct.id === 'sandbox' && direct.overlay === 'none', JSON.stringify(direct));
});
