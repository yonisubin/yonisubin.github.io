// The streamed world: no tree without its mesh (forest pool big enough), every pool and
// collider returned when chunks unload, the same seed gives the same world, and how long
// building one far chunk takes.
const { run } = require('./harness.cjs');

run('world: pools, unloading, determinism, chunk build time', async ({ page }, t) => {
  const r = await page.evaluate(() => {
    const g = window.game;
    g.renderer.setAnimationLoop(null);
    const s = g.city.streamer;
    const pools = s.pools;
    const chunks = s.chunks;
    // Baseline: nothing loaded at all.
    for (const c of chunks) {
      if (c.near) s.unload(c, 'near');
      if (c.far) s.unload(c, 'far');
    }
    const baseline = g.world.colliders.len();
    // Worst case for the forest: every chunk within the near tier's unload distance (520 m)
    // of the densest spot in the northern forest is built.
    const fx = 1240;
    const fz = -1240;
    const near = chunks.filter((c) => s.distance(c, fx, fz) < 520);
    const t0 = performance.now();
    let farBuilt = 0;
    for (const c of near) {
      if (!c.far) {
        s.buildFar(c);
        farBuilt++;
      }
    }
    const farMs = farBuilt ? (performance.now() - t0) / farBuilt : 0;
    for (const c of near) if (!c.near) s.buildNear(c);
    s.flushPools();
    const trees = near.reduce((n, c) => n + (c.rural?.trees.length ?? 0), 0);
    const forest = { used: pools.forest.used, capacity: pools.forest.capacity, trees };
    // Unload everything again: every pool slot and every chunk collider comes back.
    const collidersBefore = g.world.colliders.len();
    for (const c of chunks) {
      if (c.near) s.unload(c, 'near');
      if (c.far) s.unload(c, 'far');
    }
    const leftover = Object.entries(pools).filter(([, p]) => p.used > 0).map(([k, p]) => `${k}:${p.used}`);
    const collidersAfter = g.world.colliders.len();
    // A fingerprint of the generated world (for the determinism check after a reload).
    const L = g.city.layout;
    let h = 0;
    const mix = (v) => (h = (Math.imul(h ^ Math.round(v * 100), 2654435761) >>> 0));
    for (const b of L.blocks) for (const bl of b.buildings) mix(bl.x + bl.z * 3 + bl.height * 7);
    for (const hs of L.streets.houses) mix(hs.x + hs.z * 5);
    for (const e of L.streets.net.edges) mix(e.length);
    return { forest, farMs, leftover, baseline, collidersBefore, collidersAfter, hash: h };
  });
  t.ok('forest pool holds the densest forest', r.forest.trees <= r.forest.capacity, `${r.forest.trees} trees, capacity ${r.forest.capacity}`);
  t.ok('every loaded forest tree has its mesh (no invisible colliders)', r.forest.used === r.forest.trees, `${r.forest.used} slots for ${r.forest.trees} trees`);
  t.ok('unloading every chunk frees every pool slot', r.leftover.length === 0, r.leftover.join(', ') || 'all 0');
  t.ok('unloading frees every chunk collider', r.collidersAfter === r.baseline && r.collidersBefore > r.baseline, `${r.baseline} → ${r.collidersBefore} → ${r.collidersAfter}`);
  // Timing depends on the machine: reported, not checked.
  console.log(`  · a far chunk builds in ${r.farMs.toFixed(0)} ms on average here`);
  await page.reload();
  await page.waitForFunction(() => window.game, null, { timeout: 180000 });
  const again = await page.evaluate(() => {
    const L = window.game.city.layout;
    let h = 0;
    const mix = (v) => (h = (Math.imul(h ^ Math.round(v * 100), 2654435761) >>> 0));
    for (const b of L.blocks) for (const bl of b.buildings) mix(bl.x + bl.z * 3 + bl.height * 7);
    for (const hs of L.streets.houses) mix(hs.x + hs.z * 5);
    for (const e of L.streets.net.edges) mix(e.length);
    return h;
  });
  t.ok('same seed, same world', again === r.hash, `${r.hash} / ${again}`);
});
