// Portal placement: surface tags, fizzles, fit + nudge, re-firing, overlap, floor orientation.
const { run } = require('./harness.cjs');

run('placement', async ({ page }, t) => {
  const r = await page.evaluate(() => {
    const tf = window.twinfold, out = {};
    out.white = tf.fire('a', [0, 3, 12], [0, 0, -1]); // north wall, white
    out.metal = tf.fire('a', [-3, 1.5, 12], [0, 0, 1]); // south wall, metal
    out.glass = tf.fire('b', [-8, 1.5, 12], [0, 0, -1]); // glass pane
    out.ledgeFront = tf.fire('b', [-8, 1.5, 0], [0, 0, -1]); // ledge front, metal
    out.portalsAfterFails = [!!tf.portals.a, !!tf.portals.b];
    // Aimed at the bottom of a wall: nudged up so it sits on the floor line, not under it.
    out.low = tf.fire('b', [8, 0.1, 0], [1, 0, 0]);
    // Re-firing a colour moves it (still only two portals).
    out.moved = tf.fire('a', [0, 5, 12], [0, 0, -1]);
    // The other portal is in the way: slide away from it, or fail if there's no room.
    tf.fire('a', [8, 4, 0], [1, 0, 0]);
    out.overlap = tf.fire('b', [8, 4.3, 0.2], [1, 0, 0]);
    // A face too small for a portal (the crate is 0.4 m tall).
    out.tooSmall = tf.fire('a', [-4.1, 0.2, 13], [0, 0, -1]);
    // Floor portal: "up" follows the view direction.
    tf.place([6, 0, 0]);
    out.floor = tf.fire('a', [6, 1.6, 0], [0.6, -1, 0.0]);
    out.floorUp = tf.portals.a.up.toArray();
    // A pillar standing on the floor blocks a portal right next to it: nudged clear.
    out.nearPillar = tf.fire('b', [8.5, 1.6, -7.7], [0, -1, 0.0001]);
    out.count = tf.portals.placedCount;
    return out;
  });
  t.ok('white panel takes a portal', r.white.ok, JSON.stringify(r.white));
  t.ok('metal fizzles', !r.metal.ok && r.metal.reason === 'not-portalable', r.metal.reason);
  t.ok('glass fizzles', !r.glass.ok && r.glass.reason === 'glass', r.glass.reason);
  t.ok('ledge front (metal) fizzles', !r.ledgeFront.ok, r.ledgeFront.reason);
  t.ok('failed shots leave existing portals alone', r.portalsAfterFails[0] && !r.portalsAfterFails[1]);
  t.ok('low shot is nudged up onto the floor line', r.low.ok && Math.abs(r.low.position[1] - 1.05) < 0.03, JSON.stringify(r.low));
  t.ok('re-firing moves the portal', r.moved.ok && Math.abs(r.moved.position[1] - 5) < 1e-6);
  t.ok('overlapping the other portal: slid clear or refused',
    r.overlap.ok ? Math.hypot(r.overlap.position[1] - 4, r.overlap.position[2]) >= 1.2 - 1e-3 || Math.abs(r.overlap.position[1] - 4) >= 2.1 - 1e-3 : r.overlap.reason === 'overlap',
    JSON.stringify(r.overlap));
  t.ok('face too small fails', !r.tooSmall.ok, r.tooSmall.reason);
  t.ok('floor portal placed', r.floor.ok && Math.abs(r.floor.normal[1] - 1) < 1e-6, JSON.stringify(r.floor));
  t.ok('floor portal "up" points along the view', r.floorUp[0] > 0.99, JSON.stringify(r.floorUp));
  t.ok('portal nudged clear of a pillar', r.nearPillar.ok && (r.nearPillar.position[0] <= 8 - 0.6 + 1e-3 || r.nearPillar.position[2] >= -8 + 1.05 - 1e-3 || r.nearPillar.position[0] >= 9 + 0.6 - 1e-3), JSON.stringify(r.nearPillar));
});
