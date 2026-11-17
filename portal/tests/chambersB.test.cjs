// Workstream B's chambers (c11–c19, escape1, escape2, finale): every chamber loads through the
// loader with no errors, `next` links chain c11 → … → finale, every dialogue hook names a real line,
// and a scripted solution replay per chamber drives the player through window.twinfold (held
// movement, aim, fire, use, simulate) to `exitReached` — or, in the finale, to the boss's `defeated`
// event and the ending + credits.
const { run } = require('./harness.cjs');

/** Replay helpers, installed in the page as window.R (a function source, so it runs there). */
function installReplay() {
  const tf = window.twinfold;
  const R = {};
  R.el = (id) => tf.element(id);
  R.ev = (n) => tf.log.filter((e) => e[0] === n).map((e) => e[1]);
  R.load = (id) => {
    tf.session.loadChamber(window.twinfoldShell.chambers.getChamber(id));
    tf.simulate(1.2);
  };
  R.dead = () => tf.chamber.dead;
  R.p = () => ({ x: tf.player.position.x, y: tf.player.feetY(), z: tf.player.position.z });
  /** Point the view at a world point. */
  R.look = (x, y, z) => {
    const e = tf.player.eye();
    const dx = x - e.x, dy = y - e.y, dz = z - e.z;
    tf.aim(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
  };
  R.face = (yaw, pitch = 0) => tf.aim(yaw, pitch);
  /** Turn the view smoothly (so a carried prop follows instead of being dropped). */
  R.turn = (yaw, pitch = 0, seconds = 0.8) => {
    const y0 = tf.player.rig.yaw, p0 = tf.player.rig.pitch;
    let dy = yaw - y0;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const n = Math.max(1, Math.round(seconds * 60));
    for (let i = 1; i <= n; i++) {
      tf.aim(y0 + (dy * i) / n, p0 + ((pitch - p0) * i) / n);
      tf.simulate(1 / 60);
    }
  };
  /** Walk (held forward) to x, z; keeps the given pitch. Returns the distance left. */
  R.walk = (x, z, o = {}) => {
    const tol = o.tol ?? 0.15, pitch = o.pitch ?? 0, max = o.max ?? 20;
    let d = Infinity;
    // Carrying something: turn toward the target first, then steer gently (a sudden turn would
    // swing the hold point too far and drop it).
    const holding = !!tf.chamber.heldId();
    if (holding) {
      const p = tf.player.position;
      const want = Math.atan2(-(x - p.x), -(z - p.z));
      const dy = Math.abs(Math.atan2(Math.sin(want - tf.player.rig.yaw), Math.cos(want - tf.player.rig.yaw)));
      if (dy > 0.1 || Math.abs(pitch - tf.player.rig.pitch) > 0.1) R.turn(want, pitch, Math.max(0.1, dy * 0.25));
    }
    for (let i = 0; i < max * 60; i++) {
      const p = tf.player.position;
      const dx = x - p.x, dz = z - p.z;
      d = Math.hypot(dx, dz);
      if (d < tol || tf.chamber.dead) break;
      let yaw = Math.atan2(-dx, -dz);
      if (holding) {
        const y0 = tf.player.rig.yaw;
        const dy = Math.atan2(Math.sin(yaw - y0), Math.cos(yaw - y0));
        yaw = y0 + Math.max(-0.05, Math.min(0.05, dy));
      }
      tf.aim(yaw, pitch);
      tf.hold('forward', true);
      if (o.jump) tf.hold('jump', true);
      tf.simulate(1 / 60);
    }
    tf.hold('forward', false);
    tf.hold('jump', false);
    if (o.settle !== false) tf.simulate(0.2);
    return d;
  };
  /** Walk toward x, z until the player passes through an opening (then stop). */
  R.through = (x, z, o = {}) => {
    const n0 = R.ev('teleport').length;
    for (let i = 0; i < (o.max ?? 6) * 60 && R.ev('teleport').length === n0; i++) {
      const p = tf.player.position;
      tf.aim(Math.atan2(-(x - p.x), -(z - p.z)), o.pitch ?? 0);
      tf.hold('forward', true);
      tf.simulate(1 / 60);
    }
    tf.hold('forward', false);
    tf.simulate(o.after ?? 0.3);
    return R.ev('teleport').length > n0;
  };
  /** Step into a drop shaft whose edge is at z = zEdge (walking -Z), crouched so the fall is nearly
   *  straight; returns the teleport the fall ends in (or null). */
  R.dropShaft = (zEdge) => {
    const n0 = R.ev('teleport').length;
    tf.aim(0, 0);
    tf.hold('crouch', true);
    for (let i = 0; i < 240 && tf.player.position.z > zEdge - 0.4; i++) {
      tf.hold('forward', true);
      tf.simulate(1 / 60);
    }
    tf.hold('forward', false);
    R.wait(() => R.ev('teleport').length > n0, 4);
    tf.hold('crouch', false);
    return R.ev('teleport').length > n0 ? R.ev('teleport').slice(-1)[0] : null;
  };
  R.path = (pts, o) => pts.map(([x, z]) => R.walk(x, z, o)).pop();
  /** Fire an end at a world point (from the eye). */
  R.fire = (id, x, y, z) => {
    if (tf.chamber.heldId()) {
      // Carrying: turn smoothly so the prop comes along.
      const e = tf.player.eye();
      const dx = x - e.x, dy = y - e.y, dz = z - e.z;
      R.turn(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)), 0.6);
    }
    R.look(x, y, z);
    return tf.fire(id);
  };
  R.grab = (id) => {
    const p = tf.element(id).position();
    R.look(p.x, p.y, p.z);
    tf.use();
    tf.simulate(0.4);
    return tf.chamber.heldId() === id;
  };
  R.drop = () => {
    // Let the carried prop catch up with the hold point first.
    if (tf.chamber.heldId()) tf.simulate(0.5);
    if (tf.chamber.heldId()) tf.use();
    tf.simulate(0.6);
  };
  R.press = (id) => {
    const e = tf.element(id).entity.position;
    R.look(e[0], e[1] + 1.1, e[2]);
    tf.use();
    tf.simulate(0.1);
  };
  R.wait = (fn, max = 10) => {
    for (let i = 0; i < max * 60 && !fn(); i++) tf.simulate(1 / 60);
    return !!fn();
  };
  /** Into the exit booth and up: true once exitReached fired for this chamber. */
  R.exited = (id) => R.ev('exitReached').some((e) => e.chamberId === id);
  window.R = R;
}

/** Each chamber's solution, run in the page with R installed; returns a summary object. */
const SOLUTIONS = {
  // Turrets: lift the hall turret from behind and turn it to the wall; carry the cube as a shield
  // down the passage and set it on the plate in front of the bunker slot.
  c11: () => {
    const tf = window.twinfold, out = {};
    R.load('c11');
    R.walk(0, -17.9);
    out.grabTurret = R.grab('tur1');
    R.turn(Math.PI / 2, -0.3);
    R.drop();
    tf.simulate(1);
    R.path([[1.2, -20], [0.9, -21.4]]);
    R.press('ped1');
    tf.simulate(1);
    out.door1 = R.el('door1').isOpen();
    R.path([[1.2, -23], [0, -24.5], [0, -25.6]]);
    out.grabCube = R.grab('cube1');
    R.turn(0, -0.45, 0.4);
    R.walk(0, -39.4, { pitch: -0.45, max: 30 });
    R.drop();
    tf.simulate(1.5);
    out.plate = R.el('plate').outputs.pressed;
    out.bunkerFired = R.el('tur2').fired;
    R.path([[-2.75, -42], [-2.75, -48.6]]);
    tf.simulate(1);
    return out;
  },
  // The plinth unit: lift it off the cradle, carry it through a pair across the pit, leave it on
  // the plate, open a pair back into room 3 from room 4, fetch it, file it in the chute.
  c12: () => {
    const tf = window.twinfold, out = {};
    R.load('c12');
    R.walk(0, -13.4);
    out.grab = R.grab('plinth');
    R.turn(0, -0.2, 0.3);
    tf.simulate(1);
    R.path([[0, -21], [-4, -23.5]], {pitch: -0.2});
    out.a = R.fire('a', -6, 1.5, -23.5).ok;
    out.b = R.fire('b', -6, 1.5, -36).ok;
    R.turn(Math.PI/2, -0.2, 0.4);
    out.tp1 = R.through(-7, -23.5, {pitch: -0.2});
    out.afterPortal = { p: R.p(), held: tf.chamber.heldId() };
    R.path([[-2, -36], [0, -40], [2.5, -46.2]], {pitch: -0.3});
    R.drop(); tf.simulate(1);
    out.leave = R.el('leave').outputs.pressed; out.d3 = R.el('d3').isOpen();
    out.a2 = R.fire('a', -6, 1.5, -46).ok;
    R.path([[0, -49], [0, -52], [-3, -54]]);
    out.b2 = R.fire('b', -6, 1.5, -55);
    out.tp2 = R.through(-7, -55);
    out.inR3 = R.p();
    R.walk(1.3, -47.5);
    out.grab2 = R.grab('plinth');
    R.turn(Math.PI/2, -0.2, 0.6);
    R.walk(-4, -46, {pitch:-0.2});
    out.tp3 = R.through(-7, -46, {pitch:-0.2});
    out.inR4 = { p: R.p(), held: tf.chamber.heldId() };
    R.walk(0, -57.4, {pitch: -0.2});
    R.turn(0, -0.1, 0.3);
    tf.simulate(1);
    out.filed = R.el('chute').outputs.filed;
    R.drop();
    R.path([[0, -63], [0, -67.4]]);
    tf.simulate(1);
    out.exited = R.exited('c12'); out.deaths = R.ev('death');
    return out;
  },
  // Timer: a pair across the pit before pressing; pellet: west wall → south wall facing the receptacle.
  c13: () => {
    const tf = window.twinfold, out = {};
    R.load('c13');
    R.walk(0, -12);
    out.a = R.fire('a', -8, 1.5, -13.5).ok;
    out.b = R.fire('b', -8, 1.5, -31).ok;
    R.walk(3.1, -13);
    R.press('ped');
    out.ped = R.el('ped').outputs.pressed;
    const t0 = tf.chamber.t;
    out.tp = R.through(-9, -13.5);
    R.path([[-1, -33], [0, -37.5]]);
    out.elapsed = tf.chamber.t - t0;
    out.inB = R.p();
    out.a2 = R.fire('a', -8, 1.5, -44).ok;
    out.b2 = R.fire('b', -4, 1.5, -36).ok;
    out.caught = R.wait(() => R.el('catcher').outputs.caught, 15);
    R.path([[4, -48], [4, -57.4]]);
    tf.simulate(1);
    out.exited = R.exited('c13'); out.deaths = R.ev('death');
    return out;
  },
  // Fling: east wall high + shaft bottom, crouch into the shaft, land behind the turret; turn it to the wall.
  c14: () => {
    const tf = window.twinfold, out = {};
    R.load('c14');
    R.walk(2, -14);
    out.b = R.fire('b', 8, 2.5, -20);
    R.path([[0, -9.8], [0, -10.7]], { tol: 0.04 });
    out.a = R.fire('a', 0, -10, -13.5);
    out.fling = R.dropShaft(-11);
    R.wait(() => tf.player.grounded, 4);
    tf.simulate(0.3);
    out.landed = R.p(); out.dead = R.dead();
    R.walk(-8, -29.9);
    out.grab = R.grab('tur');
    R.turn(-Math.PI/2, -0.3);
    R.drop(); tf.simulate(1);
    out.tur = [R.el('tur').state, R.el('tur').position()];
    R.path([[-6, -33], [-7.2, -34.3]]);
    R.press('ped'); tf.simulate(1);
    out.open = R.el('exitDoor').isOpen();
    R.path([[-8, -38], [-8, -45.4]]);
    tf.simulate(1);
    out.exited = R.exited('c14'); out.deaths = R.ev('death'); out.h = tf.chamber.health;
    return out;
  },
  // Pellet floor → west wall into the receptacle; carry the cube through near wall → pillar; plate from the side.
  c15: () => {
    const tf = window.twinfold, out = {};
    R.load('c15');
    R.walk(2, -14.5);
    out.a = R.fire('a', -5, 0, -12).ok;
    out.b = R.fire('b', -8, 1.5, -12).ok;
    out.caught = R.wait(() => R.el('catcher').outputs.caught, 15);
    tf.simulate(1.5);
    out.shutter = R.el('shutter').isOpen();
    R.walk(4, -11.3);
    out.grab = R.grab('cube1');
    R.walk(2, -16, { pitch: -0.2 });
    out.a2 = R.fire('a', -8, 1.5, -14).ok;
    out.b2 = R.fire('b', -3, 1.3, -35.5).ok;
    R.walk(-5, -14, { pitch: -0.2 });
    out.tp = R.through(-9, -14, { pitch: -0.2 });
    out.far = [R.p(), tf.chamber.heldId()];
    R.path([[-5, -34], [-5, -40.6], [-1.3, -40.6]], { pitch: -0.2 });
    R.turn(-Math.PI / 2, -0.2, 0.3);
    R.drop(); tf.simulate(1.5);
    out.plate = R.el('plate').outputs.pressed;
    out.fired = R.el('tur').fired;
    R.path([[-2.75, -42], [-2.75, -48.6]]);
    tf.simulate(1);
    out.exited = R.exited('c15'); out.deaths = R.ev('death'); out.h = tf.chamber.health;
    return out;
  },
  // Timer + fling: both ends first, press, crouch into the shaft, land on the strip, run for the door.
  c16: () => {
    const tf = window.twinfold, out = {};
    R.load('c16');
    R.walk(2, -14);
    out.b = R.fire('b', 8, 2.5, -20).ok;
    R.walk(5, -11.2);
    R.press('ped');
    const t0 = tf.chamber.t;
    R.path([[0, -9.8], [0, -10.7]], { tol: 0.04 });
    out.a = R.fire('a', 0, -10, -14).ok;
    out.fling = R.dropShaft(-11);
    R.wait(() => tf.player.grounded, 4);
    out.landed = R.p();
    R.path([[-11, -27], [-11, -34.4]]);
    out.elapsed = tf.chamber.t - t0;
    tf.simulate(1);
    out.exited = R.exited('c16'); out.deaths = R.ev('death');
    return out;
  },
  // Pellet: east wall → floor under the ceiling receptacle (panel slides out); press; shaft → panel; lift the turret; run.
  c17: () => {
    const tf = window.twinfold, out = {};
    R.load('c17');
    R.path([[0, -9.6], [2, -10.2]]);
    out.a = R.fire('a', 8, 1.5, -12).ok;
    out.b = R.fire('b', -6, 0, -12).ok;
    out.caught = R.wait(() => R.el('catcher').outputs.caught, 15);
    tf.simulate(1);
    out.panel = R.el('panel').outputs.moved;
    R.walk(2, -14);
    out.b2 = R.fire('b', 7.55, 2.5, -20).ok;
    R.walk(5, -9.4);
    R.press('ped');
    const t0 = tf.chamber.t;
    R.path([[0, -9.8], [0, -10.7]], { tol: 0.04 });
    out.a2 = R.fire('a', 0, -10, -14).ok;
    out.fling = R.dropShaft(-11);
    R.wait(() => tf.player.grounded, 4);
    out.landed = R.p();
    R.walk(-11, -23.9);
    out.grab = R.grab('tur');
    R.turn(-Math.PI / 2, -0.3, 0.6);
    R.drop();
    R.path([[-8.5, -26], [-11, -27.5], [-11, -34.4]]);
    out.elapsed = tf.chamber.t - t0;
    tf.simulate(1);
    out.exited = R.exited('c17'); out.deaths = R.ev('death'); out.h = tf.chamber.health;
    return out;
  },
  // Cube through a pair around the grill; pellet into the receptacle; stand on the dais and ride it down into the exit zone.
  c18: () => {
    const tf = window.twinfold, out = {};
    R.load('c18');
    R.path([[0, -9.6], [3, -11]]);
    out.a = R.fire('a', -8, 1.5, -13).ok;
    out.b = R.fire('b', -8, 1.5, -21).ok;
    R.walk(4, -10.8);
    out.grab = R.grab('cube1');
    R.walk(-5, -13, { pitch: -0.2 });
    out.tp = R.through(-9, -13, { pitch: -0.2 });
    out.after = tf.chamber.heldId();
    R.walk(-4, -20.8, { pitch: -0.2 });
    R.turn(0, -0.2, 0.8);
    R.drop(); tf.simulate(1);
    out.plate = R.el('plate1').outputs.pressed;
    R.path([[0, -24], [0, -28]]);
    out.a2 = R.fire('a', -8, 1.5, -34).ok;
    out.b2 = R.fire('b', -4, 1.5, -26).ok;
    out.caught = R.wait(() => R.el('catcher').outputs.caught, 15);
    R.path([[4, -40], [4, -44.5]]);
    R.walk(0, -50.8, { max: 4 });
    out.onDais = R.el('onDais').outputs.entered;
    out.exit = R.wait(() => R.exited('c18'), 12);
    out.done = R.wait(() => R.ev('elevatorDone').some((e) => e.chamberId === 'c18'), 6);
    out.deaths = R.ev('death'); out.p = R.p();
    return out;
  },
  // Escape the press: one end through the hatch onto the maintenance wall, one on the south patch, walk through, ride the service lift.
  c19: () => {
    const tf = window.twinfold, out = {};
    R.load('c19');
    out.b = R.fire('b', 0, 6.5, -32).ok;
    out.a = R.fire('a', 0, 1.5, -2).ok;
    out.tp = R.through(0, 0);
    out.after = R.p();
    R.wait(() => tf.player.grounded, 3);
    R.path([[0, -28], [3, -27], [5.5, -27]]);
    tf.simulate(1);
    out.exited = R.exited('c19'); out.deaths = R.ev('death'); out.t = tf.chamber.t;
    return out;
  },
};

module.exports = { installReplay, SOLUTIONS };

if (require.main === module) {
  run('chambersB', async ({ page }, t) => {
    await page.evaluate(installReplay);
    t.ok('replay helpers installed', await page.evaluate(() => !!window.R));
  });
}
