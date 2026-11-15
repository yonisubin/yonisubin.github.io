// Directions: A* finds the shortest route (checked against a plain Dijkstra), driving
// prefers fast roads, an off-road destination gets a final straight leg, and the navigator
// trims the route as you go, re-routes when you stray and clears it when you arrive.
const { run } = require('./harness.cjs');

run('route: A* optimality, off-road leg, re-routing, arrival', async ({ page }, t) => {
  const r = await page.evaluate(() => {
    const g = window.game;
    g.renderer.setAnimationLoop(null);
    const net = g.city.layout.streets.net;
    const R = g.navigator.router;
    const dijkstra = (s, goal) => {
      const d = new Float64Array(net.nodes.length).fill(Infinity);
      const done = new Uint8Array(net.nodes.length);
      d[s] = 0;
      for (;;) {
        let u = -1;
        let best = Infinity;
        for (let i = 0; i < d.length; i++) if (!done[i] && d[i] < best) {
          best = d[i];
          u = i;
        }
        if (u < 0 || u === goal) break;
        done[u] = 1;
        for (const e of net.nodes[u].edges) {
          const v = net.other(net.edges[e], u);
          d[v] = Math.min(d[v], d[u] + net.edges[e].length);
        }
      }
      return d[goal];
    };
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let worst = 0;
    for (let k = 0; k < 30; k++) {
      const a = net.nodes[Math.floor(rnd() * net.nodes.length)];
      const c = net.nodes[Math.floor(rnd() * net.nodes.length)];
      worst = Math.max(worst, R.find(a.x, a.z, c.x, c.z, 'walk').length - dijkstra(a.id, c.id));
    }
    const sp = g.city.spawn;
    const field = R.find(sp.x, sp.z, 900, -150, 'walk');
    const nav = g.navigator;
    nav.setWaypoint(1560, -312);
    nav.update(0.1, sp.x, sp.z, 'drive');
    const first = nav.route.length;
    const mid = Math.floor(nav.route.pts.length / 6);
    const mx = nav.route.pts[mid * 2];
    const mz = nav.route.pts[mid * 2 + 1];
    nav.update(0.6, mx, mz, 'drive');
    const along = nav.route.length;
    nav.update(2.5, mx + 80, mz + 60, 'drive');
    const rerouted = nav.route.pts[0] === mx + 80;
    nav.update(0.1, 1565, -307, 'drive');
    return { worst, offroad: field.offroad < field.pts.length / 2, first, along, rerouted, cleared: nav.waypoint === null };
  });
  t.ok('A* is never longer than Dijkstra (30 random trips)', r.worst < 1, `worst difference ${r.worst.toFixed(2)} m`);
  t.ok('an off-road destination gets a final straight leg', r.offroad);
  t.ok('the route is trimmed as you go', r.along < r.first * 0.8, `${Math.round(r.first)} → ${Math.round(r.along)} m`);
  t.ok('straying 100 m off re-routes from where you are', r.rerouted);
  t.ok('arriving clears the destination', r.cleared);
});
