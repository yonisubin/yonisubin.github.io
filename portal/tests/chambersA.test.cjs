// Workstream A's chambers (c01–c10, adv1–adv6): every chamber loads through the loader with no
// errors, its `next` exists (or is c11, B's first chamber), its dialogue lines exist, and a scripted
// solution replay per chamber drives the player through window.twinfold (held actions, aim, fire,
// use, fixed-step simulate) until the exit elevator reports `exitReached`.
//   npm run test:portal -- chambersA          every chamber
//   CHAMBERS=c03,c05 npm run test:portal -- chambersA   only some replays
const { run } = require('./harness.cjs');

const A_IDS = ['c01', 'c02', 'c03', 'c04', 'c05', 'c06', 'c07', 'c08', 'c09', 'c10', 'adv1', 'adv2', 'adv3', 'adv4', 'adv5', 'adv6'];

// In-page helpers: installed once as window.__A.
function installHelpers() {
  const tf = window.twinfold, P = tf.player, sh = window.twinfoldShell;
  const H = {};
  const STEP = 1 / 60;
  H.tf = tf;
  H.P = P;
  H.log = [];
  H.say = (s) => H.log.push(s);
  H.load = (id) => {
    tf.session.loadChamber(sh.chambers.getChamber(id));
    tf.simulate(1.0); // the entry booth opens
  };
  H.el = (id) => tf.element(id);
  H.events = (name) => tf.log.filter((e) => e[0] === name).map((e) => e[1]);
  H.at = () => [P.position.x, P.feetY(), P.position.z];
  H.fmt = (v) => v.map((x) => x.toFixed(2)).join(' ');
  /** Point the view at a world point. */
  H.look = (t) => {
    const e = P.eye();
    const dx = t[0] - e.x, dy = t[1] - e.y, dz = t[2] - e.z;
    P.rig.yaw = Math.atan2(-dx, -dz);
    P.rig.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  };
  H.release = () => ['forward', 'back', 'left', 'right', 'jump', 'crouch'].forEach((a) => tf.hold(a, false));
  /** Walk (steering every step) until the feet are within tol of (x, z). opts.until(): stop early. */
  H.walkTo = (x, z, opts = {}) => {
    const tol = opts.tol ?? 0.25;
    const max = (opts.max ?? 25) * 60;
    for (let i = 0; i < max; i++) {
      const dx = x - P.position.x, dz = z - P.position.z;
      if (Math.hypot(dx, dz) < tol) break;
      if (opts.until && opts.until()) break;
      P.rig.yaw = Math.atan2(-dx, -dz);
      if (opts.pitch !== undefined) P.rig.pitch = opts.pitch;
      tf.hold('forward', true);
      if (opts.jumpAt && Math.hypot(dx, dz) < opts.jumpAt && P.grounded) {
        tf.hold('jump', true);
        tf.simulate(STEP);
        tf.hold('jump', false);
        continue;
      }
      tf.simulate(STEP);
    }
    tf.hold('forward', false);
    tf.simulate(opts.settle ?? 0.2);
    return Math.hypot(x - P.position.x, z - P.position.z);
  };
  /** Walk straight ahead (current yaw) for some seconds. */
  H.forward = (seconds, yaw) => {
    if (yaw !== undefined) P.rig.yaw = yaw;
    tf.hold('forward', true);
    tf.simulate(seconds);
    tf.hold('forward', false);
  };
  H.jump = () => {
    tf.hold('jump', true);
    tf.simulate(STEP * 2);
    tf.hold('jump', false);
  };
  /** Wait (simulate) until cond() or the time runs out; returns whether cond() held. */
  H.waitFor = (cond, seconds = 20) => {
    for (let i = 0; i < seconds * 60; i++) {
      if (cond()) return true;
      tf.simulate(STEP);
    }
    return cond();
  };
  /** Aim at a point and fire a portal from the eye. */
  H.shoot = (id, target) => {
    H.look(target);
    const r = tf.fire(id);
    H.say(`fire ${id} at ${H.fmt(target)} → ${r.ok ? 'ok ' + H.fmt(r.position) : r.reason}`);
    return r;
  };
  H.held = () => tf.chamber.heldId();
  /** Look at a prop and press Use to pick it up. */
  H.grab = (id) => {
    const p = H.el(id).position();
    H.look([p.x, p.y, p.z]);
    tf.use();
    tf.simulate(0.3);
    H.say(`grab ${id}: ${H.held()}`);
    return H.held() === id;
  };
  H.drop = () => {
    if (H.held()) tf.use();
    tf.simulate(1.0);
  };
  /** Carrying a prop, walk until the prop is over (x, z), then drop it. */
  H.carryTo = (x, z, opts = {}) => {
    const id = H.held();
    if (!id) return false;
    const pr = H.el(id);
    for (let i = 0; i < (opts.max ?? 20) * 60; i++) {
      const c = pr.position();
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < (opts.tol ?? 0.3)) break;
      const dx = x - P.position.x, dz = z - P.position.z;
      P.rig.yaw = Math.atan2(-dx, -dz);
      P.rig.pitch = opts.pitch ?? 0;
      tf.hold('forward', d > 0.6 || Math.hypot(dx, dz) > 1.6);
      tf.simulate(STEP);
    }
    tf.hold('forward', false);
    tf.simulate(0.4);
    if (opts.keep) return true;
    H.drop();
    const c = pr.position();
    H.say(`dropped ${id} at ${H.fmt([c.x, c.y, c.z])}`);
    return true;
  };
  /** Walk into a portal (or through anything) heading at (x, z) until a teleport happens. */
  H.through = (x, z, max = 6) => {
    const n = P.teleports;
    H.walkTo(x, z, { tol: 0.05, max, until: () => P.teleports > n, settle: 0 });
    tf.hold('forward', false);
    tf.simulate(0.3);
    return P.teleports > n;
  };
  H.exited = () => H.events('exitReached').some((e) => e.chamberId === tf.session.current().id);
  /** Walk into the exit booth and wait for exitReached. */
  H.toExit = () => {
    const ex = H.el('exit').entity.position;
    const door = H.el('exitDoor').entity.position;
    H.walkTo(door[0], door[2] + 1.2, { tol: 0.3 });
    H.walkTo(door[0], door[2] - 1.0, { tol: 0.3 });
    H.walkTo(ex[0], ex[2], { tol: 0.3 });
    return H.waitFor(H.exited, 2);
  };
  H.result = () => ({ exited: H.exited(), counters: tf.session.counters(), at: H.at(), log: H.log, dead: tf.chamber.health <= 0 });
  window.__A = H;
}

// One scripted solution per chamber: (H) => void, run inside the page.
const SOLUTIONS = {
  c01: (H) => {
    const { tf, P } = H;
    H.walkTo(0, -3);
    H.walkTo(-1.8, -10);
    // Run west and jump onto the shelf.
    P.rig.yaw = Math.PI / 2;
    tf.hold('forward', true);
    tf.simulate(0.1);
    H.jump();
    tf.simulate(0.35);
    tf.hold('forward', false);
    tf.simulate(0.5);
    H.grab('cube1');
    H.walkTo(-1, -10, { tol: 0.3 });
    H.carryTo(2, -10);
    H.say(`plate ${H.el('plate').outputs.pressed}`);
    H.toExit();
  },
};

run('chambersA', async ({ page }, t) => {
  await page.evaluate(installHelpers);
  // --- Every chamber: loader, next, dialogue lines. --------------------------------------------
  const meta = await page.evaluate((ids) => {
    const sh = window.twinfoldShell;
    return ids.map((id) => {
      const lvl = sh.chambers.getChamber(id);
      if (!lvl) return { id, missing: true };
      const v = sh.validateLevel(JSON.parse(JSON.stringify(lvl)));
      const lines = (lvl.dialogue ?? []).flatMap((d) => d.lines);
      return {
        id,
        errors: v.errors,
        warnings: v.warnings,
        next: lvl.next ?? null,
        nextOk: !!lvl.next && (lvl.next === 'c11' || !!sh.chambers.getChamber(lvl.next)),
        missingLines: lines.filter((l) => !(l in sh.LINES)),
        hasAnatomy: ['entry', 'sign', 'exit', 'exitDoor'].every((e) => (lvl.entities ?? []).some((x) => x.id === e)),
        info: lvl.info,
      };
    });
  }, A_IDS);
  for (const m of meta) {
    if (m.missing) {
      t.ok(`${m.id} is registered`, false);
      continue;
    }
    t.ok(`${m.id} loads with no loader errors`, m.errors.length === 0, m.errors.slice(0, 2).join('; '));
    t.ok(`${m.id} has no loader warnings`, m.warnings.length === 0, m.warnings.slice(0, 2).join('; '));
    t.ok(`${m.id} → next ${m.next} exists (or is c11)`, m.nextOk);
    t.ok(`${m.id} dialogue lines exist`, m.missingLines.length === 0, m.missingLines.join(', '));
    t.ok(`${m.id} has the anatomy (entry, sign, exit door, exit booth) and an info sign number`, m.hasAnatomy && typeof m.info?.number === 'number');
  }

  // --- Solution replays. ------------------------------------------------------------------------
  const only = (process.env.CHAMBERS || '').split(',').filter(Boolean);
  for (const id of A_IDS) {
    if (only.length && !only.includes(id)) continue;
    const sol = SOLUTIONS[id];
    if (!sol) {
      t.ok(`${id}: has a solution replay`, false);
      continue;
    }
    const r = await page.evaluate(
      ({ id, src }) => {
        const H = window.__A;
        H.log = [];
        H.load(id);
        const body = new Function('H', `return (${src})(H);`);
        try {
          body(H);
        } catch (e) {
          H.say(`threw ${e && e.stack ? e.stack.split('\n')[0] : e}`);
        }
        H.release();
        const out = H.result();
        // Ride the elevator out so a later chamber starts clean.
        H.tf.simulate(0.1);
        return out;
      },
      { id, src: sol.toString() },
    );
    const c = r.counters;
    t.ok(`${id}: scripted solution reaches the exit`, r.exited, `${r.exited ? '' : 'at ' + r.at.map((x) => x.toFixed(2)).join(' ') + ' · ' + r.log.slice(-6).join(' | ')}`);
    if (r.exited) console.log(`    ${id}: ${c.portals} portals, ${c.steps} steps, ${c.time.toFixed(1)} s`);
    if (process.env.VERBOSE) console.log(r.log.join('\n'));
  }
});
