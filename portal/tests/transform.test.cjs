// The teleport transform M = T_B · R180(up) · T_A⁻¹: round trips, rigidity, front-to-front mapping.
const { run } = require('./harness.cjs');

run('teleport transform', async ({ page }, t) => {
  const r = await page.evaluate(() => {
    const { THREE, teleportMatrix, teleportRotation } = window.twinfold;
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    const frame = () => ({
      position: new THREE.Vector3(rnd() * 20, rnd() * 20, rnd() * 20),
      quaternion: new THREE.Quaternion(rnd(), rnd(), rnd(), rnd()).normalize(),
    });
    let posErr = 0, velErr = 0, quatErr = 0, speedErr = 0, frontErr = 0;
    for (let i = 0; i < 200; i++) {
      const A = frame(), B = frame();
      const mAB = teleportMatrix(A, B), mBA = teleportMatrix(B, A);
      const p = new THREE.Vector3(rnd() * 5, rnd() * 5, rnd() * 5);
      posErr = Math.max(posErr, p.clone().applyMatrix4(mAB).applyMatrix4(mBA).distanceTo(p));
      const v = new THREE.Vector3(rnd() * 30, rnd() * 30, rnd() * 30);
      const rAB = teleportRotation(A, B), rBA = teleportRotation(B, A);
      const v2 = v.clone().applyQuaternion(rAB);
      speedErr = Math.max(speedErr, Math.abs(v2.length() - v.length()));
      velErr = Math.max(velErr, v2.applyQuaternion(rBA).distanceTo(v));
      const q = new THREE.Quaternion(rnd(), rnd(), rnd(), rnd()).normalize();
      const q2 = rBA.clone().multiply(rAB.clone().multiply(q));
      quatErr = Math.max(quatErr, 1 - Math.abs(q2.dot(q)));
      // Moving into A's front (−n_A) comes out of B's front (+n_B).
      const nA = new THREE.Vector3(0, 0, 1).applyQuaternion(A.quaternion);
      const nB = new THREE.Vector3(0, 0, 1).applyQuaternion(B.quaternion);
      frontErr = Math.max(frontErr, nA.clone().negate().applyQuaternion(rAB).distanceTo(nB));
      // A point 1 m in front of A maps 1 m behind B.
      const inFront = A.position.clone().addScaledVector(nA, 1).applyMatrix4(mAB);
      frontErr = Math.max(frontErr, inFront.distanceTo(B.position.clone().addScaledVector(nB, -1)));
    }
    return { posErr, velErr, quatErr, speedErr, frontErr };
  });
  t.ok('position round trip A→B→A', r.posErr < 1e-9, r.posErr.toExponential(2));
  t.ok('velocity round trip A→B→A', r.velErr < 1e-9, r.velErr.toExponential(2));
  t.ok('orientation round trip A→B→A', r.quatErr < 1e-9, r.quatErr.toExponential(2));
  t.ok('speed is preserved', r.speedErr < 1e-9, r.speedErr.toExponential(2));
  t.ok('entering the front of A exits the front of B', r.frontErr < 1e-9, r.frontErr.toExponential(2));
});
