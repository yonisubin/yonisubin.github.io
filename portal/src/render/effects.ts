// Short-lived visual effects: dissolving objects (grills), sparks / blasts, bullet tracers.
// They are purely visual (no physics); each fades out and frees its GPU resources.
import * as THREE from 'three';
import { CONFIG } from '../core/config';
import { disposeObject } from '../elements/base';

interface Fx {
  obj: THREE.Object3D;
  age: number;
  life: number;
  tick(t: number, dt: number): void;
}

export class Effects {
  readonly group = new THREE.Group();
  private items: Fx[] = [];
  /** Reduce flashing (accessibility): bursts are dimmer and don't flash. */
  reduceFlashing = false;

  /** A copy of `source` that drifts up, glows and fades out (an object erased by a grill). */
  dissolve(source: THREE.Object3D): void {
    const ghost = source.clone(true);
    ghost.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry = m.geometry.clone();
      m.material = new THREE.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.85, depthWrite: false });
    });
    source.getWorldPosition(ghost.position);
    source.getWorldQuaternion(ghost.quaternion);
    this.group.add(ghost);
    this.items.push({
      obj: ghost,
      age: 0,
      life: CONFIG.hazards.dissolveSeconds,
      tick: (t, dt) => {
        ghost.position.y += dt * 0.4;
        ghost.scale.setScalar(1 - 0.3 * t);
        ghost.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
          if (m && 'opacity' in m) m.opacity = 0.85 * (1 - t);
        });
      },
    });
  }

  /** An expanding glowing ball (pellet pop, rocket blast). */
  burst(at: THREE.Vector3, color: number, radius: number): void {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: this.reduceFlashing ? 0.35 : 0.9, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), mat);
    mesh.position.copy(at);
    this.group.add(mesh);
    const peak = this.reduceFlashing ? 0.35 : 0.9;
    this.items.push({
      obj: mesh,
      age: 0,
      life: 0.4,
      tick: (t) => {
        mesh.scale.setScalar(radius * (0.2 + 0.8 * t));
        mat.opacity = peak * (1 - t);
      },
    });
  }

  /** A bullet tracer from a to b. */
  tracer(a: THREE.Vector3, b: THREE.Vector3, color = 0xffd27a): void {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    this.group.add(line);
    this.items.push({ obj: line, age: 0, life: 0.06, tick: (t) => (mat.opacity = 0.9 * (1 - t)) });
  }

  update(dt: number): void {
    for (const it of this.items) {
      it.age += dt;
      it.tick(Math.min(1, it.age / it.life), dt);
    }
    this.items = this.items.filter((it) => {
      if (it.age < it.life) return true;
      it.obj.removeFromParent();
      disposeObject(it.obj);
      return false;
    });
  }

  clear(): void {
    for (const it of this.items) {
      it.obj.removeFromParent();
      disposeObject(it.obj);
    }
    this.items = [];
  }

  get count(): number {
    return this.items.length;
  }
}
