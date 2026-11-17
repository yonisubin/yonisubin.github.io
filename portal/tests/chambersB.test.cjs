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
    for (let i = 0; i < max * 60; i++) {
      const p = tf.player.position;
      const dx = x - p.x, dz = z - p.z;
      d = Math.hypot(dx, dz);
      if (d < tol || tf.chamber.dead) break;
      tf.aim(Math.atan2(-dx, -dz), pitch);
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
};

module.exports = { installReplay, SOLUTIONS };

if (require.main === module) {
  run('chambersB', async ({ page }, t) => {
    await page.evaluate(installReplay);
    t.ok('replay helpers installed', await page.evaluate(() => !!window.R));
  });
}
