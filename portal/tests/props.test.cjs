// Physics props: resting, pushing, standing on them, props through portal pairs at many angles and
// speeds (velocity rotated by M, speed kept, floor-exit boost), the clone while straddling, the
// infinite fall for props, carrying (hold point, yaw lock, through portals, forced drop, no
// self-lifting).
const { run } = require('./harness.cjs');

run('props', async ({ page }, t) => {
  const r = await page.evaluate(() => {
    const tf = window.twinfold, THREE = tf.THREE, out = {};
    const S = tf.session;
    // Test room with one cube added (the room itself stays the phase 1–4 room).
    const room = JSON.parse(JSON.stringify(tf.levels.testroom));
    room.entities = [{ id: 'c', type: 'cube', position: [8, 0.33, 4] }];
    S.loadChamber(room);
    const cube = () => tf.element('c');
    tf.place([10, 0, 12]);
    tf.simulate(1.5);
    out.restY = cube().position().y;
    out.asleepSpeed = cube().velocity().length();

    // --- Through portal pairs: A on the east floor (y = 0), B on several surfaces. -------------
    const exits = [
      { name: 'north wall', origin: [0, 3, 0], dir: [0, 0, -1] },
      { name: 'west wall', origin: [0, 3, 0], dir: [-1, 0, 0] },
      { name: 'ceiling', origin: [0, 5, 0], dir: [0, 1, 0.0001] },
      { name: 'pit floor', origin: [-8, 0, 0], dir: [0, -1, 0.0001] },
      { name: 'launch face', origin: [-2.5, 4, 6], dir: [-1, 0, 0] },
    ];
    const speeds = [1, 6, 15];
    out.drops = [];
    for (const ex of exits) {
      for (const sp of speeds) {
        S.restartChamber();
        tf.place([10, 0, 12]);
        const a = tf.fire('a', [6, 3, -6], [0, -1, 0.0001]);
        const b = tf.fire('b', ex.origin, ex.dir);
        const c = cube();
        // Above portal A, moving down (and a little sideways) at `sp`.
        c.body.setTranslation({ x: 6.1, y: 1.2, z: -6.05 }, true);
        c.body.setLinvel({ x: 0.3, y: -sp, z: 0.2 }, true);
        c.body.setAngvel({ x: 0, y: 1.5, z: 0 }, true);
        let v0 = null, v1 = null, w0 = null, w1 = null, steps = 0, inFront = null;
        for (let i = 0; i < 120 && c.teleports === 0; i++) {
          v0 = c.velocity().clone();
          const aw = c.body.angvel();
          w0 = new THREE.Vector3(aw.x, aw.y, aw.z);
          tf.simulate(1 / 60);
          steps++;
        }
        if (c.teleports > 0) {
          v1 = c.velocity().clone();
          const av = c.body.angvel();
          w1 = new THREE.Vector3(av.x, av.y, av.z);
          const pa = tf.portals.a, pb = tf.portals.b;
          const R = tf.teleportRotation(pa, pb);
          // Expected: the entry velocity (plus one step of gravity) rotated by R.
          const vin = v0.clone().add(new THREE.Vector3(0, -11.5 / 60, 0));
          const want = vin.clone().applyQuaternion(R);
          const floorExit = pb.normal.y > 0.7;
          if (floorExit) {
            const vn = want.dot(pb.normal);
            if (vn < tf.config.props.floorExitMinSpeed) want.addScaledVector(pb.normal, tf.config.props.floorExitMinSpeed - vn);
          }
          const wantW = w0.clone().applyQuaternion(R);
          inFront = pb.normal.dot(c.position().clone().sub(pb.position));
          tf.simulate(0.4);
          const after = pb.normal.dot(c.position().clone().sub(pb.position));
          out.drops.push({
            exit: ex.name, sp, ok: a.ok && b.ok, steps,
            err: v1.distanceTo(want), speedIn: vin.length(), speedOut: v1.length(), floorExit,
            wErr: w1.distanceTo(wantW), inFront, after, teleports: c.teleports,
          });
        } else out.drops.push({ exit: ex.name, sp, ok: a.ok && b.ok, steps, failed: true, pos: c.position().toArray() });
      }
    }

    // --- A thrown cube through a wall pair, horizontally, and its clone while straddling. -------
    S.restartChamber();
    tf.place([10, 0, 12]);
    tf.fire('a', [0, 1, -6], [1, 0, 0]); // east wall x = 12
    tf.fire('b', [0, 1, -6], [-1, 0, 0]); // west wall x = -12
    {
      const c = cube();
      const pa = tf.portals.a;
      c.body.setTranslation({ x: 10.8, y: 0.33, z: pa.position.z }, true);
      c.body.setLinvel({ x: 6, y: 0, z: 0 }, true);
      let clone = false;
      for (let i = 0; i < 90 && c.teleports === 0; i++) {
        tf.simulate(1 / 60);
        clone = clone || c.hasClone();
      }
      const vx = c.velocity().x, x = c.position().x;
      for (let i = 0; i < 30; i++) {
        tf.simulate(1 / 60);
        clone = clone || c.hasClone();
      }
      out.wall = { teleports: c.teleports, clone, x, vx, later: c.position().x };
    }

    // --- Infinite fall for a prop: pit floor + ceiling above it. --------------------------------
    S.restartChamber();
    tf.place([10, 0, 12]);
    tf.fire('a', [-8, 0, 0], [0, -1, 0.0001]);
    tf.fire('b', [-8, 0, 0], [0, 1, 0.0001]);
    {
      const c = cube();
      c.body.setTranslation({ x: -8, y: -5, z: 0 }, true);
      c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      let maxSpeed = 0;
      for (let i = 0; i < 6 * 60; i++) {
        tf.simulate(1 / 60);
        maxSpeed = Math.max(maxSpeed, c.velocity().length());
      }
      const p = c.position();
      out.fall = { teleports: c.teleports, maxSpeed, inside: p.y > -11 && p.y < 11 && Math.abs(p.x + 8) < 3 };
    }

    // --- Player and props: standing on a cube, pushing one. -------------------------------------
    S.restartChamber();
    tf.simulate(1);
    tf.place([8, 1.5, 4]);
    tf.simulate(1);
    out.standFeet = tf.player.feetY();
    out.standGrounded = tf.player.grounded;
    tf.place([6.5, 0, 4], -Math.PI / 2);
    const x0 = cube().position().x;
    tf.hold('forward', true);
    tf.simulate(1.2);
    tf.hold('forward', false);
    out.pushed = cube().position().x - x0;

    // --- Carrying. -------------------------------------------------------------------------------
    S.restartChamber();
    tf.simulate(0.5);
    tf.place([8, 0, 6]);
    tf.aim(0, -0.55); // facing -Z, looking down at the cube 2 m ahead
    tf.simulate(0.1);
    out.prompt = tf.log.filter((e) => e[0] === 'prompt').map((e) => e[1].text).pop();
    tf.use();
    out.held = tf.chamber.heldId();
    tf.aim(0, 0);
    tf.simulate(0.6);
    const eye = tf.player.eye(), fwd = tf.player.rig.forward();
    out.holdGap = cube().position().distanceTo(eye.clone().addScaledVector(fwd, tf.config.carry.holdDistance).add(new THREE.Vector3(0, -tf.config.carry.holdDrop, 0)));
    // Turn: the cube follows the view and its yaw locks to it.
    tf.player.rig.yaw = 1.0;
    tf.simulate(0.8);
    const q = cube().quaternion();
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const cubeYaw = Math.atan2(f.x, f.z);
    out.yawDiff = Math.abs(Math.atan2(Math.sin(cubeYaw - 1.0 - (out.yaw0 || 0)), Math.cos(cubeYaw - 1.0)));
    out.upright = new THREE.Vector3(0, 1, 0).applyQuaternion(q).y;
    out.followGap = tf.chamber.carry.gap;
    // Walk into a wall portal carrying it: the cube goes through first, then the player; still held.
    tf.fire('a', [0, 1, 4], [1, 0, 0]); // east wall
    tf.fire('b', [0, 1, 4], [-1, 0, 0]); // west wall
    const pa = tf.portals.a;
    tf.place([8, 0, pa.position.z], -Math.PI / 2); // face east (+X)
    cube().body.setTranslation(tf.chamber.carry.target(), true); // bring the held cube along
    tf.simulate(0.5);
    tf.hold('forward', true);
    let cubeFirst = false;
    for (let i = 0; i < 150 && tf.player.teleports === 0; i++) {
      tf.simulate(1 / 60);
      if (cube().teleports > 0 && tf.player.teleports === 0) cubeFirst = true;
    }
    tf.hold('forward', false);
    tf.simulate(0.5);
    out.carryPortal = { cubeFirst, cubeTp: cube().teleports, playerTp: tf.player.teleports, held: tf.chamber.heldId(), gap: tf.chamber.carry.gap, identity: tf.chamber.carry.holdM.equals(new THREE.Matrix4()) };
    // Forced too far away: it drops.
    tf.place([-8, 0, 12]);
    tf.simulate(0.1);
    out.forcedDrop = tf.chamber.heldId();
    out.dropEvents = tf.log.filter((e) => e[0] === 'drop').length;

    // Can't stand on the cube you're holding: stand on it, pick it up, you fall.
    S.restartChamber();
    tf.simulate(1);
    tf.place([8, 0.7, 4]);
    tf.simulate(0.5);
    const feetOn = tf.player.feetY();
    tf.aim(0, -1.5);
    tf.use();
    const pickedWhileOn = tf.chamber.heldId();
    tf.simulate(0.6);
    out.selfLift = { feetOn, pickedWhileOn, feetAfter: tf.player.feetY(), cubeY: cube().position().y };
    return out;
  });

  t.near('cube rests on the floor', r.restY, 0.325, 0.03);
  t.ok('cube comes to rest', r.asleepSpeed < 0.05, r.asleepSpeed.toFixed(3));
  for (const d of r.drops) {
    const label = `${d.exit} at ${d.sp} m/s`;
    if (d.failed) {
      t.ok(`${label}: passes through`, false, JSON.stringify(d));
      continue;
    }
    t.ok(`${label}: passes through`, d.ok && d.teleports >= 1);
    t.ok(`${label}: velocity rotated by M`, d.err < 0.25, `error ${d.err.toFixed(3)} m/s`);
    if (!d.floorExit) t.near(`${label}: speed kept`, d.speedOut, d.speedIn, 0.25);
    t.ok(`${label}: angular velocity rotated`, d.wErr < 0.6, d.wErr.toFixed(3));
    t.ok(`${label}: comes out in front of the exit`, d.inFront > -0.6 && d.after > 0, `${d.inFront.toFixed(2)} → ${d.after.toFixed(2)}`);
  }
  t.ok('thrown through a wall pair', r.wall.teleports === 1 && r.wall.x > -12 && r.wall.x < -11, JSON.stringify(r.wall));
  t.ok('keeps moving out of the exit', r.wall.vx > 3 && r.wall.later > r.wall.x + 0.5, JSON.stringify(r.wall));
  t.ok('a clone exists while straddling', r.wall.clone);
  t.ok('prop infinite fall loops', r.fall.teleports >= 5, JSON.stringify(r.fall));
  t.ok('prop speed capped at terminal velocity', r.fall.maxSpeed <= 38.5 && r.fall.maxSpeed > 30, r.fall.maxSpeed.toFixed(2));
  t.ok('prop stays inside the room', r.fall.inside);
  t.near('player stands on a cube', r.standFeet, 0.65, 0.06);
  t.ok('grounded on the cube', r.standGrounded);
  t.ok('walking into a cube pushes it', r.pushed > 0.5, r.pushed.toFixed(2));
  t.ok('use prompt on a cube', r.prompt === 'E  pick up', String(r.prompt));
  t.ok('Use picks the cube up', r.held === 'c');
  t.ok('held ~1 m in front of the camera', r.holdGap < 0.15, r.holdGap.toFixed(3));
  t.ok('follows the view when turning', r.followGap < 0.2, r.followGap.toFixed(3));
  t.ok('held yaw locked to the view', r.yawDiff < 0.1, r.yawDiff.toFixed(3));
  t.ok('held cube stays upright', r.upright > 0.99, r.upright.toFixed(3));
  t.ok('carried cube goes through the portal first', r.carryPortal.cubeFirst && r.carryPortal.cubeTp === 1, JSON.stringify(r.carryPortal));
  t.ok('player follows; still carrying it', r.carryPortal.playerTp === 1 && r.carryPortal.held === 'c', JSON.stringify(r.carryPortal));
  t.ok('hold point back on the same side', r.carryPortal.identity && r.carryPortal.gap < 0.3);
  t.ok('forced too far: it drops', r.forcedDrop === null && r.dropEvents >= 1);
  t.ok('can pick up the cube you stand on', r.selfLift.pickedWhileOn === 'c' && Math.abs(r.selfLift.feetOn - 0.65) < 0.06, JSON.stringify(r.selfLift));
  t.ok("…but can't stand on it while holding it", r.selfLift.feetAfter < 0.1, JSON.stringify(r.selfLift));
});
