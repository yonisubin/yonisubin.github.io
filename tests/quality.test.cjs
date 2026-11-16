// Graphics quality (game/quality.ts): Low draws less (pixel ratio, shadows, streaming
// distances, fog, pedestrians) and unloads far chunks; the choice survives a reload; Auto
// steps down when frames are slow and back up when they're fast.
const { run } = require('./harness.cjs');

run('quality: presets, saved choice, auto', async ({ page }, t) => {
  const state = () =>
    page.evaluate(() => {
      const g = window.game;
      const peds = g.pedestrians ? g.pedestrians.peds.filter((p) => p.active && !p.cop && !p.goon).length : -1;
      return {
        label: g.quality.label,
        ratio: g.renderer.getPixelRatio(),
        shadows: g.renderer.shadowMap.enabled && g.sky.sun.castShadow,
        far: g.city.streamer.distances.farLoad,
        fog: g.scene.fog.far,
        cameraFar: g.camera.far,
        chunks: g.city.streamer.loadedCount.far,
        peds,
      };
    });

  // Let the world finish streaming in at High first.
  await page.evaluate(() => {
    const g = window.game;
    for (let k = 0; k < 400 && (k === 0 || g.city.streamer.loadedCount.queued > 0); k++) g.city.update(g.onFoot.focus());
  });
  const high = await state();
  t.ok('tests start on High', high.label === 'High' && high.shadows && high.far === 850 && high.cameraFar === 2500, JSON.stringify(high));

  await page.evaluate(() => {
    const g = window.game;
    g.quality.set('low');
    g.city.update(g.onFoot.focus());
    g.simulate(1);
  });
  const low = await state();
  t.ok('Low: lower pixel ratio, no shadows, shorter distances and fog', low.ratio <= 0.75 && !low.shadows && low.far === 480 && low.fog === 620 && low.cameraFar === 1300, JSON.stringify(low));
  t.ok('Low unloads far chunks', low.chunks < high.chunks, `${high.chunks} → ${low.chunks} far chunks`);
  t.ok('Low keeps at most 8 pedestrians out', low.peds <= 8, `${high.peds} → ${low.peds}`);

  await page.reload({ timeout: 180000 });
  await page.waitForFunction(() => window.game, null, { timeout: 180000 });
  const back = await state();
  t.ok('the choice survives a reload', back.label === 'Low' && back.far === 480, JSON.stringify(back));

  const auto = await page.evaluate(() => {
    const g = window.game;
    const q = g.quality;
    q.set('high');
    q.set('auto');
    const steps = [q.label];
    const feed = (fps, seconds) => {
      for (let t = 0; t < seconds; t += 1 / fps) q.feed(1 / fps);
    };
    feed(60, 12); // past the warm-up, steady
    steps.push(q.label);
    feed(20, 9); // slow: one step down
    steps.push(q.label);
    feed(20, 9); // still slow: another
    steps.push(q.label);
    feed(20, 30); // on Low: the pixel ratio goes down to its floor
    steps.push(`${q.label} ${g.renderer.getPixelRatio()}`);
    q.feed(5); // a 5 s frame (a hidden tab): ignored
    feed(70, 70); // fast for long enough: back up (each step needs 3 fast windows)
    steps.push(q.label);
    const saved = localStorage.getItem('opencity.quality.auto');
    q.set('high');
    return { steps, saved };
  });
  t.ok('Auto steps down on slow frames, scales pixels on Low, steps back up', auto.steps[1] === 'Auto (High)' && auto.steps[2] === 'Auto (Medium)' && auto.steps[3] === 'Auto (Low)' && auto.steps[4] === 'Auto (Low) 0.5' && auto.steps[5] !== 'Auto (Low)', JSON.stringify(auto));
  t.ok('Auto remembers the level it found', !!auto.saved, auto.saved);
});
