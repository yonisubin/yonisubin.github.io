import * as THREE from 'three';

// One InstancedMesh with a fixed number of slots that streamed chunks borrow and give back.
// This keeps every kind of object (buildings, trees, lamps…) at one draw call however much
// of the world is loaded. The lowest free slot is always handed out first and the mesh only
// draws up to the highest slot in use, so a mostly empty pool costs almost nothing; free
// slots below that hold a zero-scale matrix (invisible).

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _mat = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

export class InstancePool {
  readonly mesh: THREE.InstancedMesh;
  /** Free slots, sorted high → low so pop() gives the lowest. */
  private readonly free: number[] = [];
  private readonly inUse: Uint8Array;
  private top = 0; // one past the highest slot in use
  private dirtyMatrix = false;
  private dirtyColor = false;
  /** Extra per-instance attributes (e.g. the facade style) that need uploading. */
  private readonly attributes: THREE.InstancedBufferAttribute[] = [];

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, readonly capacity: number, color = false) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    // Instances are spread over the whole loaded area, so per-mesh culling never helps.
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.inUse = new Uint8Array(capacity);
    for (let i = capacity - 1; i >= 0; i--) {
      this.mesh.setMatrixAt(i, HIDDEN);
      this.free.push(i);
    }
    if (color) {
      for (let i = 0; i < capacity; i++) this.mesh.setColorAt(i, new THREE.Color(1, 1, 1));
    }
    for (const name of Object.keys(geometry.attributes)) {
      const a = geometry.attributes[name];
      if (a instanceof THREE.InstancedBufferAttribute) this.attributes.push(a);
    }
  }

  get used(): number {
    return this.capacity - this.free.length;
  }

  /** A free slot, or −1 if the pool is full (the object is then simply not shown). */
  alloc(): number {
    const slot = this.free.pop() ?? -1;
    if (slot >= 0) {
      this.inUse[slot] = 1;
      if (slot >= this.top) this.top = slot + 1;
    }
    return slot;
  }

  release(slot: number): void {
    if (slot < 0) return;
    this.mesh.setMatrixAt(slot, HIDDEN);
    this.inUse[slot] = 0;
    // Keep `free` sorted high → low (binary search for the insert position).
    let lo = 0;
    let hi = this.free.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.free[mid] > slot) lo = mid + 1;
      else hi = mid;
    }
    this.free.splice(lo, 0, slot);
    while (this.top > 0 && !this.inUse[this.top - 1]) this.top--;
    this.dirtyMatrix = true;
  }

  /** Place slot `i`: position, per-axis scale, rotation about Y. */
  place(i: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, yaw = 0): void {
    if (i < 0) return;
    _quat.setFromAxisAngle(UP, yaw);
    this.mesh.setMatrixAt(i, _mat.compose(_pos.set(x, y, z), _quat, _scale.set(sx, sy, sz)));
    this.dirtyMatrix = true;
  }

  setMatrix(i: number, m: THREE.Matrix4): void {
    if (i < 0) return;
    this.mesh.setMatrixAt(i, m);
    this.dirtyMatrix = true;
  }

  setColor(i: number, c: THREE.Color): void {
    if (i < 0) return;
    this.mesh.setColorAt(i, c);
    this.dirtyColor = true;
  }

  /** Upload whatever changed this frame (call once per frame). */
  flush(): void {
    this.mesh.count = this.top;
    if (this.dirtyMatrix) this.mesh.instanceMatrix.needsUpdate = true;
    if (this.dirtyColor && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    if (this.dirtyMatrix) for (const a of this.attributes) a.needsUpdate = true;
    this.dirtyMatrix = this.dirtyColor = false;
  }
}
