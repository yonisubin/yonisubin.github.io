// Portal rendering: windows open only when linked, recursion depth, and no "flash" while walking
// through (the camera never sees the wall the portal sits on while crossing).
const { run } = require('./harness.cjs');

run('render', async ({ page }, t) => {
  await page.evaluate(() => (document.getElementById('overlay').style.display = 'none'));
  const r = await page.evaluate(() => {
    const tf = window.twinfold, P = tf.player, out = {};
    // One portal only: drawn as a closed swirl, no window.
    tf.fire('a', [-8, 0.6, 12], [-1, 0, 0]);
    tf.place([-9, 0, 12]);
    tf.aim(Math.PI / 2, -0.1);
    tf.renderNow();
    out.closedViews = tf.renderer.stats.views;
    out.closedPixel = tf.pixel(0.5, 0.5);
    // Facing pair (west wall ↔ east wall): window inside window, down to the recursion limit.
    tf.fire('b', [8, 0.6, 12], [1, 0, 0]);
    tf.renderNow();
    out.pairViews = tf.renderer.stats.views;
    out.pairDepth = tf.renderer.stats.maxLevel;
    tf.renderer.recursionDepth = 2;
    tf.renderNow();
    out.limitedDepth = tf.renderer.stats.maxLevel;
    tf.renderer.recursionDepth = tf.config.portal.recursionDepth;
    // Looking away (north, no portal there): no portal work at all.
    tf.aim(0, 0);
    tf.renderNow();
    out.awayViews = tf.renderer.stats.views;

    // No flash: paint the wall under A bright red. Walk into A (west wall); B is on the north wall,
    // so through A you look south and never at the red wall. If the near plane ever cut the window
    // open, the screen centre would show red.
    const red = new tf.THREE.MeshBasicMaterial({ color: 0xff0000 });
    let wallMesh = null;
    tf.scene.traverse((o) => {
      if (o.isMesh && o.geometry.parameters && o.geometry.parameters.width === 1 && o.geometry.parameters.depth === 32 && o.position.x === -12.5) wallMesh = o;
    });
    out.foundWall = !!wallMesh;
    const oldMat = wallMesh.material;
    wallMesh.material = [red, red, red, red, red, red];
    tf.fire('b', [0, 0.6, 0], [0, 0, -1]);
    tf.place([-10.5, 0, 12]);
    tf.aim(Math.PI / 2, 0);
    tf.hold('forward', true);
    const n0 = P.teleports;
    let redFrames = 0, nearFrames = 0, nearWithWindow = 0, frames = 0, after = 0;
    for (let i = 0; i < 120 && after < 8; i++) {
      tf.simulate(1 / 60);
      tf.renderNow();
      frames++;
      const px = tf.pixel(0.5, 0.5);
      if (px[0] > 200 && px[1] < 60 && px[2] < 60) redFrames++;
      const eye = P.eye();
      if (P.teleports === n0 && eye.x - -12 < 0.6) {
        nearFrames++;
        if (tf.renderer.stats.views >= 2) nearWithWindow++;
      }
      if (P.teleports > n0) after++;
    }
    tf.hold('forward', false);
    wallMesh.material = oldMat;
    red.dispose();
    out.crossed = P.teleports === n0 + 1;
    Object.assign(out, { redFrames, nearFrames, nearWithWindow, frames });
    return out;
  });
  t.ok('a lone portal draws no window', r.closedViews === 1, `views ${r.closedViews}`);
  t.ok('a lone portal shows its own colour', r.closedPixel[2] > r.closedPixel[0], JSON.stringify(r.closedPixel));
  t.ok('facing portals recurse to the depth limit', r.pairDepth === 9, `depth ${r.pairDepth}, views ${r.pairViews}`);
  t.ok('one extra view per level (no blow-up)', r.pairViews === 10, `views ${r.pairViews}`);
  t.ok('recursion depth setting is honoured', r.limitedDepth === 2, `depth ${r.limitedDepth}`);
  t.ok('portals out of view cost nothing', r.awayViews === 1, `views ${r.awayViews}`);
  t.ok('found the west wall mesh', r.foundWall);
  t.ok('walked through while rendering every step', r.crossed, `${r.frames} frames`);
  t.ok('window drawn on every frame right before crossing', r.nearFrames > 3 && r.nearWithWindow === r.nearFrames, `${r.nearWithWindow}/${r.nearFrames}`);
  t.ok('no flash of the wall behind the portal', r.redFrames === 0, `${r.redFrames} red frames`);
});
