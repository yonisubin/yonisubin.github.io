// Puzzle maker: build a chamber with the mouse and the API (brushes, face tags, entities, wires,
// triggers, checkpoints, hooks), undo / redo, export → import round trip, loader errors, drafts in
// IndexedDB, test-play and back (Esc), share link round trip (opening the link plays it).
const { run, openGame } = require('./harness.cjs');

run(
  'editor',
  async ({ page }, t) => {
    t.ok('?editor opens the puzzle maker', await page.evaluate(() => window.twinfoldShell.app.state === 'editor' && getComputedStyle(document.getElementById('editor')).display === 'grid'));
    const n0 = await page.evaluate(() => window.twinfoldShell.app.editor.level.brushes.length);

    // Draw a brush with the mouse: Brush tool, drag on the grid.
    await page.click('#editor [data-id=tool-brush]');
    const pts = await page.evaluate(() => {
      // A fixed top-down view so nothing (walls) hides what the mouse draws; drag from the screen
      // point of (-2, 0, -2) to that of (2, 0, 2).
      const v = window.twinfoldShell.app.editor.view;
      v.resize();
      v.controls.target.set(0, 0, 0);
      v.camera.position.set(0, 30, 0.01);
      v.controls.update();
      v.camera.updateMatrixWorld();
      const r = v.canvas.getBoundingClientRect();
      const scr = (x, z) => {
        const p = new window.twinfold.THREE.Vector3(x, 0, z).project(v.camera);
        return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
      };
      return { a: scr(-2, -2), b: scr(2, 2) };
    });
    await page.mouse.move(pts.a.x, pts.a.y);
    await page.mouse.down();
    await page.mouse.move(pts.b.x, pts.b.y, { steps: 5 });
    await page.mouse.up();
    const drawn = await page.evaluate(() => {
      const l = window.twinfoldShell.app.editor.level;
      return { n: l.brushes.length, b: l.brushes[l.brushes.length - 1] };
    });
    t.ok('dragging with the Brush tool draws a brush', drawn.n === n0 + 1, JSON.stringify(drawn.b));
    t.ok('… snapped to the 0.5 m grid, 3 m tall', [...drawn.b.min, ...drawn.b.max].every((v) => Math.abs(v * 2 - Math.round(v * 2)) < 1e-9) && drawn.b.max[1] - drawn.b.min[1] === 3);
    await page.keyboard.press('Control+z');
    t.ok('Ctrl+Z undoes it', (await page.evaluate(() => window.twinfoldShell.app.editor.level.brushes.length)) === n0);
    await page.keyboard.press('Control+y');
    t.ok('Ctrl+Y redoes it', (await page.evaluate(() => window.twinfoldShell.app.editor.level.brushes.length)) === n0 + 1);
    // Keyboard nudging and resizing of the selection (select it with the Select tool).
    await page.click('#editor [data-id=tool-select]');
    // Click the screen point of the new brush's top centre.
    const top = await page.evaluate(() => {
      const ed = window.twinfoldShell.app.editor, b = ed.level.brushes.at(-1), v = ed.view;
      const p = new window.twinfold.THREE.Vector3((b.min[0] + b.max[0]) / 2, b.max[1], (b.min[2] + b.max[2]) / 2).project(v.camera);
      const r = v.canvas.getBoundingClientRect();
      return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
    });
    await page.mouse.click(top.x, top.y);
    t.ok('clicking with the Select tool selects the brush', await page.evaluate((n) => JSON.stringify(window.twinfoldShell.app.editor.doc.selection) === JSON.stringify({ kind: 'brush', index: n }), n0), await page.evaluate(() => JSON.stringify(window.twinfoldShell.app.editor.doc.selection)));
    await page.evaluate((n) => window.twinfoldShell.app.editor.doc.select({ kind: 'brush', index: n }), n0);
    const moved = await page.evaluate(() => JSON.parse(JSON.stringify(window.twinfoldShell.app.editor.level.brushes.at(-1))));
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+PageUp');
    const nudged = await page.evaluate(() => window.twinfoldShell.app.editor.level.brushes.at(-1));
    t.ok('arrows move, Shift+PgUp grows', nudged.min[0] === moved.min[0] + 0.5 && nudged.max[1] === moved.max[1] + 0.5, JSON.stringify([moved, nudged]));
    // Inspector: set one face to glass.
    await page.selectOption('#editor [data-field="face+z"]', 'glass');
    t.ok('inspector sets a face tag', await page.evaluate(() => window.twinfoldShell.app.editor.level.brushes.at(-1).faces['+z'] === 'glass'));
    await page.keyboard.press('Delete');
    t.ok('Delete removes the selection', (await page.evaluate(() => window.twinfoldShell.app.editor.level.brushes.length)) === n0);

    // Build the rest through the editor's own operations.
    const built = await page.evaluate(() => {
      const ed = window.twinfoldShell.app.editor, doc = ed.doc;
      doc.setInfo({ name: 'Button and door', id: 'buttondoor' });
      const wall = doc.addBrush([-8, 0, -2], [8, 4, -1.5], 'metal');
      doc.setFaceTag(wall, '+z', 'portalable');
      const btn = doc.addEntity('floorButton', [3, 0, 3]);
      const door = doc.addEntity('door', [0, 0, -1.75]);
      const cube = doc.addEntity('cube', [-3, 0, 3]);
      ed.setTool('wire');
      ed.wireClick(btn);
      const midWire = ed.wireFrom;
      ed.wireClick(door);
      const trig = doc.addTrigger([-2, 0, -6], [2, 2.5, -4], 'nearExit');
      doc.addCheckpoint([-2, 0, 0], [2, 2.5, 1]);
      doc.setInfo({ dialogue: [{ event: 'nearExit', lines: ['exitReached.helpful.1'] }] });
      doc.updateEntity(cube, { position: [-3.2, 0, 3.3], yaw: Math.PI / 2 });
      return { btn, door, cube, trig, midWire, level: JSON.parse(JSON.stringify(doc.level)) };
    });
    t.ok('entities get unique ids', built.btn === 'floorButton1' && built.door === 'door1' && built.cube === 'cube1');
    t.ok('wire tool: output → input', built.midWire === 'floorButton1' && built.level.wiring.some((w) => w.from === 'floorButton1.pressed' && w.to === 'door1.open'), JSON.stringify(built.level.wiring));
    t.ok('positions snap to the grid', JSON.stringify(built.level.entities.find((e) => e.id === 'cube1').position) === '[-3,0,3.5]');
    t.ok('trigger, checkpoint and dialogue hook stored', built.level.triggers[0].event === 'nearExit' && built.level.checkpoints.length === 1 && built.level.dialogue[0].event === 'nearExit');
    // Renaming an entity keeps its wires.
    await page.evaluate(() => window.twinfoldShell.app.editor.doc.updateEntity('door1', { id: 'exitDoor' }));
    t.ok('renaming an entity rewires it', await page.evaluate(() => window.twinfoldShell.app.editor.level.wiring[0].to === 'exitDoor.open'));

    // Export → import round trip.
    const rt = await page.evaluate(() => {
      const ed = window.twinfoldShell.app.editor;
      const json = ed.exportJSON();
      const before = JSON.stringify(JSON.parse(json));
      ed.doc.load({ ...ed.level, name: 'scratch', brushes: ed.level.brushes.slice(0, 1) });
      const problems = ed.importJSON(json);
      return { problems, same: JSON.stringify(JSON.parse(ed.exportJSON())) === before, name: ed.level.name, json };
    });
    t.ok('export → import gives the same chamber', rt.problems.length === 0 && rt.same && rt.name === 'Button and door');
    const bad = await page.evaluate(() => {
      const ed = window.twinfoldShell.app.editor;
      return {
        syntax: ed.importJSON('{ not json'),
        semantic: ed.importJSON(JSON.stringify({ name: 'x', spawn: { position: [0, 0] }, brushes: [{ min: [0, 0, 0], max: [1, 0, 1] }], entities: [{ id: 'a', type: 'cube', position: [0, 0, 0] }, { id: 'a', type: 'lamp', position: [0, 0, 0] }], wiring: [{ from: 'ghost.out', to: 'a.in' }] })),
        stillLoaded: ed.level.name,
      };
    });
    t.ok('bad JSON gives a readable error', bad.syntax.length === 1 && bad.syntax[0].startsWith('Not valid JSON'), bad.syntax[0]);
    t.ok('the loader lists every problem', bad.semantic.length >= 4 && bad.semantic.some((e) => e.includes('spawn.position')) && bad.semantic.some((e) => e.includes('zero thickness')) && bad.semantic.some((e) => e.includes('duplicate entity id')) && bad.semantic.some((e) => e.includes('no entity "ghost"')), bad.semantic.join(' | '));
    t.ok('a failed import keeps the chamber', bad.stillLoaded === 'Button and door');

    // Drafts (IndexedDB).
    const drafts = await page.evaluate(async () => {
      const ed = window.twinfoldShell.app.editor;
      await ed.saveDraftNow(false);
      const req = indexedDB.open('twinfold');
      const db = await new Promise((res) => (req.onsuccess = () => res(req.result)));
      const all = await new Promise((res) => {
        const g = db.transaction('drafts').objectStore('drafts').getAll();
        g.onsuccess = () => res(g.result);
      });
      return all.map((d) => d.name);
    });
    t.ok('drafts save to IndexedDB', drafts.includes('Button and door'), drafts.join(','));
    await page.click('#editor [data-id=drafts]');
    await page.waitForSelector('#editor .edModal .draft');
    t.ok('the Drafts dialog lists them', await page.evaluate(() => document.querySelector('#editor .edModal').textContent.includes('Button and door')));
    await page.click('#editor [data-id=closeModal]');

    // Test-play and back.
    await page.click('#editor [data-id=testPlay]');
    await page.waitForFunction(() => window.twinfoldShell.app.state === 'testplay');
    const tp = await page.evaluate(() => {
      const s = window.twinfoldShell;
      return { current: s.session.current().name, wires: s.session.current().wiring.length, editor: getComputedStyle(document.getElementById('editor')).display, log: s.app.log.slice(-2), paused: s.session.paused };
    });
    t.ok('Test play hands the chamber to the session', tp.current === 'Button and door' && tp.wires === 1 && tp.editor === 'none' && !tp.paused && tp.log.some((l) => l.startsWith('chamberStart buttondoor')), JSON.stringify(tp));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.twinfoldShell.app.state === 'editor');
    t.ok('Esc returns to the puzzle maker', await page.evaluate(() => getComputedStyle(document.getElementById('editor')).display === 'grid' && window.twinfoldShell.session.paused && window.twinfoldShell.app.editor.level.name === 'Button and door'));

    // Share link round trip.
    const share = await page.evaluate(async () => {
      const s = window.twinfoldShell, ed = s.app.editor;
      const url = await ed.shareLink();
      const back = await s.decodeLevel(url.split('#play=')[1]);
      return { url, same: JSON.stringify(back) === JSON.stringify(s.validateLevel(ed.level).level) };
    });
    t.ok('share link carries the chamber (deflate + base64url)', share.url.includes('#play=') && /^[A-Za-z0-9_-]+$/.test(share.url.split('#play=')[1]) && share.same, `${share.url.length} chars`);
    // Open the link in a fresh browser: it shows the shared card, then plays the chamber.
    const other = await openGame({ query: '#play=' + share.url.split('#play=')[1] });
    try {
      const p2 = other.page;
      await p2.waitForSelector('#overlay [data-screen=shared]');
      t.ok('opening the link shows the shared chamber', await p2.evaluate(() => document.querySelector('#overlay h2').textContent === 'Button and door'));
      await p2.click('#overlay [data-id=playShared]');
      await p2.waitForFunction(() => window.twinfoldShell.app.state === 'game');
      t.ok('… and Play loads it', await p2.evaluate(() => window.twinfoldShell.session.current().name === 'Button and door' && window.twinfoldShell.session.current().wiring[0].to === 'exitDoor.open'));
      // A damaged link explains itself.
      await p2.goto(p2.url().split('#')[0] + '#play=AAAAbroken');
      await p2.reload();
      await p2.waitForSelector('#overlay [data-screen=shared] .error');
      t.ok('a damaged link shows an error, not a crash', await p2.evaluate(() => document.querySelector('#overlay .error').textContent.includes('damaged')));
      t.ok('no page errors in the second browser', other.errors.length === 0, other.errors.join(' | '));
    } finally {
      await other.browser.close();
    }

    // Exit returns to the main menu.
    await page.click('#editor [data-id=exitEditor]');
    t.ok('Exit goes back to the main menu', (await page.evaluate(() => window.twinfoldShell.app.menu.screen)) === 'main');
  },
  { query: '?editor', viewport: { width: 1100, height: 700 } },
);
