// Test elements in the sandbox chamber: floor-button variants, gate truth tables (and/or/not/timer),
// doors, pedestal buttons (toggle, countdown with ticks), indicators, platforms (riding, moving
// surfaces refuse portals), panels closing portals, lifts, triggers and checkpoints, the entry and
// exit elevators, and fixed portals with a one-colour device.
const { run } = require('./harness.cjs');

run('elements', async ({ page }, t) => {
  const r = await page.evaluate(() => {
    const tf = window.twinfold, S = tf.session, out = {};
    const el = (id) => tf.element(id);
    const ev = (name) => tf.log.filter((e) => e[0] === name).map((e) => e[1]);
    S.loadChamber(tf.levels.sandbox);
    out.loaded = S.current().id;
    out.entityCount = tf.chamber.elements.size;
    out.entryClosed = el('entry').doorOpen();
    tf.simulate(1.5);
    out.entryOpen = el('entry').doorOpen();
    tf.place([-17, 0, -12]); // a quiet corner

    // --- Floor buttons and gates: every combination of the three buttons. ----------------------
    const spots = { cube1: [-12, 0.5, 4], cube2: [-8, 0.5, 4], ball1: [-4, 0.5, 4] };
    const homes = { cube1: [-12, 0.5, 10], cube2: [-10, 0.5, 10], ball1: [-8, 0.5, 10] };
    const put = (id, at) => {
      const b = el(id).body;
      b.setTranslation({ x: at[0], y: at[1], z: at[2] }, true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    };
    out.table = [];
    for (let m = 0; m < 8; m++) {
      const any = !!(m & 1), cube = !!(m & 2), sphere = !!(m & 4);
      put('cube1', any ? spots.cube1 : homes.cube1);
      put('cube2', cube ? spots.cube2 : homes.cube2);
      put('ball1', sphere ? spots.ball1 : homes.ball1);
      tf.simulate(1.0);
      out.table.push({
        any, cube, sphere,
        pressed: [el('btnAny').outputs.pressed, el('btnCube').outputs.pressed, el('btnSphere').outputs.pressed],
        and: el('gAnd').outputs.out, or: el('gOr').outputs.out, not: el('gNot').outputs.out,
        door: el('door1').isOpen(), ind: el('ind1').outputs.on,
      });
    }
    // Variants: the wrong object doesn't press a cube-only / sphere-only plate.
    put('cube1', homes.cube1);
    put('cube2', homes.cube2);
    put('ball1', spots.cube2); // sphere on the cube plate
    put('cube1', spots.ball1); // cube on the sphere plate
    tf.simulate(1);
    out.wrongObjects = [el('btnCube').outputs.pressed, el('btnSphere').outputs.pressed];
    put('ball1', homes.ball1);
    put('cube1', homes.cube1);
    // The player weighs down an "any" plate but not a cube-only one.
    tf.place([-12, 0.15, 4]);
    tf.simulate(0.5);
    out.playerOnAny = el('btnAny').outputs.pressed;
    tf.place([-8, 0.15, 4]);
    tf.simulate(0.5);
    out.playerOnCube = el('btnCube').outputs.pressed;
    // Timer gate: holds for 2 s after the plate is released.
    tf.place([-12, 0.15, 4]);
    tf.simulate(0.3);
    tf.place([-17, 0, -12]);
    tf.simulate(0.3);
    out.timerHeld = [el('btnAny').outputs.pressed, el('gTimer').outputs.out];
    tf.simulate(2.0);
    out.timerAfter = el('gTimer').outputs.out;
    // The door closes again when the AND gate drops.
    tf.simulate(1);
    out.doorClosed = el('door1').openness();

    // --- Pedestal buttons: prompt, countdown with ticks, toggle opening the exit door. ---------
    tf.place([-14, 0, 7.2]);
    tf.aim(0, -0.5);
    tf.simulate(0.1);
    out.pedPrompt = ev('prompt').pop()?.text;
    const ticks0 = ev('sfx').filter((s) => s.name === 'tick').length;
    tf.use();
    out.pedOn = el('pedTimer').outputs.pressed;
    tf.simulate(2);
    out.pedMid = [el('pedTimer').outputs.pressed, el('ind2').outputs.on];
    tf.simulate(2.2);
    out.pedOff = el('pedTimer').outputs.pressed;
    out.ticks = ev('sfx').filter((s) => s.name === 'tick').length - ticks0;
    tf.place([-15.5, 0, 7.2]);
    tf.aim(0, -0.5);
    tf.simulate(0.1);
    tf.use();
    tf.simulate(1);
    out.exitDoor = [el('pedToggle').outputs.pressed, el('doorExit').isOpen()];

    // --- Platform: moving surfaces refuse portals; you ride it. --------------------------------
    const plat = el('plat1');
    tf.place([10, 0, 0]);
    out.platShot = tf.fire('a', [8, 4, plat.current().z], [0, -1, 0.0001]);
    const p0 = plat.current();
    tf.place([p0.x, 1.2, p0.z]);
    tf.simulate(0.2);
    const z0 = tf.player.position.z, pz0 = plat.current().z;
    tf.simulate(1);
    out.ride = { player: tf.player.position.z - z0, platform: plat.current().z - pz0, feet: tf.player.feetY(), grounded: tf.player.grounded };

    // --- Panel: a portal on it closes when it moves. --------------------------------------------
    tf.place([14, 0, 11]);
    out.panelShot = tf.fire('a', [14, 2.5, 11], [1, 0, 0]);
    const closes0 = ev('sfx').filter((s) => s.name === 'portalClose').length;
    put('ball1', spots.ball1);
    tf.simulate(1.5);
    out.panelMoved = el('panel1').outputs.moved;
    out.portalAfterPanel = !!tf.portals.a;
    out.closeSfx = ev('sfx').filter((s) => s.name === 'portalClose').length - closes0;
    put('ball1', homes.ball1);

    // --- Lift: rises while you stand on it. ----------------------------------------------------
    tf.place([8, 0.2, 12]);
    tf.simulate(3);
    out.lift = { top: el('lift1').outputs.top, feet: tf.player.feetY() };
    tf.place([-17, 0, -12]);
    tf.simulate(2.5);
    out.liftDown = el('lift1').outputs.top;

    // --- Trigger volume (once) and checkpoint. --------------------------------------------------
    tf.place([-3.2, 0, 8]);
    tf.simulate(0.2);
    tf.place([-17, 0, -12]);
    tf.simulate(0.2);
    tf.place([-3.2, 0, 8]);
    tf.simulate(0.2);
    out.triggers = ev('trigger').filter((x) => x.name === 'sandboxGrill').length;
    tf.place([0, 0, 13]);
    tf.simulate(0.2);
    out.checkpoint = ev('checkpoint').map((c) => c.id);
    out.autosaves = ev('autosave').map((a) => a.reason);

    // --- Exit elevator: exitReached with counters, then elevatorDone after the ride. -----------
    const portalsPlaced = S.counters().portals;
    tf.place([17, 0, -8]);
    tf.aim(0, 0);
    tf.hold('forward', true);
    tf.simulate(1.5);
    tf.hold('forward', false);
    out.exitReached = ev('exitReached');
    out.portalsCounted = portalsPlaced;
    const done0 = ev('elevatorDone').length;
    tf.simulate(1.5);
    out.doneEarly = ev('elevatorDone').length - done0;
    tf.simulate(2);
    out.elevatorDone = ev('elevatorDone');
    out.timeFrozen = S.counters().time === out.exitReached[0]?.time;

    // --- Fixed portals and a one-colour device. ------------------------------------------------
    S.loadChamber(tf.levels.fixedroom);
    tf.simulate(0.1);
    out.fixedB = tf.portals.b && { x: tf.portals.b.position.x, fixed: tf.portals.b.fixed };
    out.fireB = tf.fire('b', [0, 1.6, 0], [0, 0, -1]);
    out.fireA = tf.fire('a', [0, 1.0, 0], [0, 0, -1]);
    tf.simulate(3.1);
    out.flipped = tf.portals.b && tf.portals.b.position.x;
    // Walk into A (north wall), come out of B (now on the west wall).
    tf.place([0, 0, -5]);
    tf.aim(0, 0);
    tf.hold('forward', true);
    const tp0 = tf.player.teleports;
    for (let i = 0; i < 120 && tf.player.teleports === tp0; i++) tf.simulate(1 / 60);
    tf.hold('forward', false);
    out.fixedPass = { teleports: tf.player.teleports - tp0, x: tf.player.position.x };
    const noDevice = JSON.parse(JSON.stringify(tf.levels.fixedroom));
    noDevice.device = 'none';
    noDevice.id = 'nodevice';
    S.loadChamber(noDevice);
    out.noDevice = tf.fire('a', [0, 1.6, 0], [0, 0, -1]);
    return out;
  });

  t.ok('sandbox loads', r.loaded === 'sandbox' && r.entityCount >= 40, `${r.entityCount} elements`);
  t.ok('entry elevator door opens after the start', r.entryClosed < 0.01 && r.entryOpen > 0.99, `${r.entryClosed} → ${r.entryOpen}`);
  let tableOk = true;
  for (const row of r.table) {
    const ok =
      row.pressed[0] === row.any && row.pressed[1] === row.cube && row.pressed[2] === row.sphere &&
      row.and === (row.any && row.cube) && row.or === (row.cube || row.sphere) && row.not === !row.sphere &&
      row.door === row.and && row.ind === row.any;
    if (!ok) tableOk = false;
    t.ok(`buttons ${+row.any}${+row.cube}${+row.sphere}: and/or/not, door, indicator`, ok, JSON.stringify(row));
  }
  t.ok('all eight combinations right', tableOk);
  t.ok("cube-only plate ignores a sphere, sphere plate ignores a cube", !r.wrongObjects[0] && !r.wrongObjects[1], JSON.stringify(r.wrongObjects));
  t.ok('player presses an "any" plate', r.playerOnAny);
  t.ok("player doesn't press a cube-only plate", !r.playerOnCube);
  t.ok('timer gate holds after release', !r.timerHeld[0] && r.timerHeld[1], JSON.stringify(r.timerHeld));
  t.ok('timer gate drops after its time', !r.timerAfter);
  t.ok('door closes again', r.doorClosed === 0, String(r.doorClosed));
  t.ok('pedestal use prompt', r.pedPrompt === 'E  press', String(r.pedPrompt));
  t.ok('pedestal countdown: on, still on mid-way, lights its indicator', r.pedOn && r.pedMid[0] && r.pedMid[1]);
  t.ok('pedestal countdown ends', !r.pedOff);
  t.ok('countdown ticks every second', r.ticks >= 3 && r.ticks <= 4, String(r.ticks));
  t.ok('toggle pedestal opens the exit door', r.exitDoor[0] && r.exitDoor[1], JSON.stringify(r.exitDoor));
  t.ok('moving platform refuses portals', !r.platShot.ok, JSON.stringify(r.platShot));
  t.ok('riding the platform carries you', Math.abs(r.ride.player - r.ride.platform) < 0.1 && Math.abs(r.ride.platform) > 1.5, JSON.stringify(r.ride));
  t.ok('portal placed on the resting panel', r.panelShot.ok, JSON.stringify(r.panelShot));
  t.ok('panel moves on its input', r.panelMoved);
  t.ok('a portal on a moving panel closes', !r.portalAfterPanel && r.closeSfx >= 1);
  t.ok('lift rises with you on it', r.lift.top && Math.abs(r.lift.feet - 4.15) < 0.1, JSON.stringify(r.lift));
  t.ok('lift comes back down', !r.liftDown);
  t.ok('once-trigger fires once', r.triggers === 1, String(r.triggers));
  t.ok('checkpoint reached and autosaved', r.checkpoint.includes('mid') && r.autosaves[0] === 'chamberStart' && r.autosaves.includes('checkpoint'), JSON.stringify([r.checkpoint, r.autosaves]));
  const ex = r.exitReached[0];
  t.ok('exit elevator: exitReached with counters', r.exitReached.length === 1 && ex.chamberId === 'sandbox' && ex.steps > 0 && ex.time > 10 && ex.portals === r.portalsCounted, JSON.stringify(ex));
  t.ok('no elevatorDone before the ride ends', r.doneEarly === 0);
  t.ok('elevatorDone after the ride, with next', r.elevatorDone.length === 1 && r.elevatorDone[0].next === 'testroom', JSON.stringify(r.elevatorDone));
  t.ok('timer stops at the exit', r.timeFrozen);
  t.ok('fixed portal placed', r.fixedB && r.fixedB.fixed && Math.abs(r.fixedB.x - 8) < 1e-6, JSON.stringify(r.fixedB));
  t.ok("one-colour device can't fire the second colour", !r.fireB.ok && r.fireB.reason === 'device');
  t.ok('…but fires the first', r.fireA.ok);
  t.ok('cycling fixed portal flipped walls', Math.abs(r.flipped + 8) < 1e-6, String(r.flipped));
  t.ok('walk through the device portal into the fixed one', r.fixedPass.teleports === 1 && r.fixedPass.x > -8 && r.fixedPass.x < -6, JSON.stringify(r.fixedPass));
  t.ok('no device: nothing fires', !r.noDevice.ok && r.noDevice.reason === 'device');
});
