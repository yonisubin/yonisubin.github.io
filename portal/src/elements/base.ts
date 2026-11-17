// Shared plumbing for test elements: outputs that notify the wiring, inputs with "is it wired?",
// typed access to entity props, and owned meshes / bodies / colliders that dispose() frees.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { ChamberContext } from '../game/context';
import type { Entity, EntityType, SurfaceTag, Vec3 } from '../levels/level';
import type { Mover } from '../physics/world';
import type { Element } from './element';

/** Elements the player can press E on (pedestal buttons, commentary nodes). */
export interface Usable {
  useText(): string | null;
  use(): void;
}

export function isUsable(e: unknown): e is Usable {
  return !!e && typeof (e as Usable).use === 'function' && typeof (e as Usable).useText === 'function';
}

/** Elements with something to draw between physics steps. */
export interface Renderable {
  render(alpha: number, dt: number): void;
}

export function isRenderable(e: unknown): e is Renderable {
  return !!e && typeof (e as Renderable).render === 'function';
}

export abstract class BaseElement implements Element {
  readonly outputs: Record<string, boolean> = {};
  readonly inputs: readonly string[] = [];
  /** Current input values (only meaningful for wired inputs). */
  protected readonly inputValues: Record<string, boolean> = {};
  /** Inputs that have at least one wire (unwired inputs use the element's default). */
  readonly wired = new Set<string>();
  protected readonly objects: THREE.Object3D[] = [];
  protected readonly bodies: RAPIER.RigidBody[] = [];
  protected readonly colliders: RAPIER.Collider[] = [];

  constructor(
    protected readonly ctx: ChamberContext,
    readonly entity: Entity,
  ) {}

  get id(): string {
    return this.entity.id;
  }

  get type(): EntityType {
    return this.entity.type;
  }

  /** Entity origin as a vector. */
  protected origin(): THREE.Vector3 {
    return new THREE.Vector3(...this.entity.position);
  }

  protected yaw(): number {
    return this.entity.yaw ?? 0;
  }

  protected prop<T>(name: string, fallback: T): T {
    const v = this.entity.props?.[name];
    return v === undefined || v === null ? fallback : (v as T);
  }

  protected vec(name: string, fallback: Vec3): THREE.Vector3 {
    const v = this.prop<Vec3>(name, fallback);
    return new THREE.Vector3(v[0], v[1], v[2]);
  }

  /** Input value, or `fallback` when nothing is wired into it. */
  protected input(name: string, fallback: boolean): boolean {
    return this.wired.has(name) ? !!this.inputValues[name] : fallback;
  }

  protected setOutput(name: string, value: boolean): void {
    if (this.outputs[name] === value) return;
    this.outputs[name] = value;
    this.ctx.events.emit('output', { id: this.id, output: name, value });
    this.ctx.outputChanged(this);
  }

  /** Restore outputs silently (save restore; the wiring is re-synced afterwards). */
  protected restoreOutputs(o: Record<string, boolean> | undefined): void {
    if (o) Object.assign(this.outputs, o);
  }

  setInput(name: string, value: boolean): void {
    this.inputValues[name] = value;
    this.onInput(name, value);
  }

  protected onInput(_name: string, _value: boolean): void {}

  update(_dt: number): void {}

  snapshot(): unknown {
    return { outputs: { ...this.outputs }, inputs: { ...this.inputValues } };
  }

  restore(state: unknown): void {
    const s = state as { outputs?: Record<string, boolean>; inputs?: Record<string, boolean> } | null;
    this.restoreOutputs(s?.outputs);
    if (s?.inputs) Object.assign(this.inputValues, s.inputs);
  }

  protected add<T extends THREE.Object3D>(o: T): T {
    this.ctx.group.add(o);
    this.objects.push(o);
    return o;
  }

  /** A kinematic body with one box collider, registered as this element's solid part. */
  kinematicBox(half: THREE.Vector3, at: THREE.Vector3, tag: SurfaceTag = 'metal', mover?: Mover): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
    const world = this.ctx.physics.world;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(at.x, at.y, at.z));
    const collider = world.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z), body);
    this.ctx.physics.register(collider, { kind: 'solid', owner: this.id, tag, mover });
    this.bodies.push(body);
    return { body, collider };
  }

  /** A fixed box collider (no body). */
  protected fixedBox(half: THREE.Vector3, at: THREE.Vector3, rot?: THREE.Quaternion, sensor = false): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(at.x, at.y, at.z);
    if (rot) desc.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w });
    if (sensor) desc.setSensor(true);
    const c = this.ctx.physics.world.createCollider(desc);
    this.ctx.physics.register(c, sensor ? { kind: 'sensor', owner: this.id } : { kind: 'solid', owner: this.id, tag: 'metal' });
    this.colliders.push(c);
    return c;
  }

  dispose(): void {
    for (const o of this.objects) {
      o.removeFromParent();
      disposeObject(o);
    }
    this.objects.length = 0;
    const physics = this.ctx.physics;
    for (const b of this.bodies) if (physics.world.bodies.contains(b.handle)) physics.removeBody(b);
    for (const c of this.colliders) if (physics.world.colliders.contains(c.handle)) physics.removeCollider(c);
    this.bodies.length = 0;
    this.colliders.length = 0;
  }
}

/** Free an object's geometries, materials and textures (shared ones are flagged userData.shared). */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
    const mat = m.material;
    if (!mat) return;
    for (const x of Array.isArray(mat) ? mat : [mat]) {
      if (x.userData.shared) continue;
      for (const v of Object.values(x)) if (v instanceof THREE.Texture) v.dispose();
      x.dispose();
    }
  });
}
