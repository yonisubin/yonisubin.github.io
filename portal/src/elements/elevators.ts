// Entry and exit elevators: an octagonal glass booth with a door on its front (the entity's yaw,
// local +Z). The entry booth opens shortly after the chamber starts. Stepping into the exit booth
// ends the chamber: `exitReached` with the final counters, the door shuts, the ride lasts
// rideSeconds, then `elevatorDone` (with level.next) so the shell can load what comes next.
import * as THREE from 'three';
import { CONFIG } from '../core/config';
import type { ChamberContext } from '../game/context';
import type { Entity } from '../levels/level';
import { MAT } from '../render/models';
import { BaseElement } from './base';

const E = CONFIG.elements;
const SIDES = 8;

abstract class Booth extends BaseElement {
  protected doorF = 0;
  private readonly door: { body: import('@dimforge/rapier3d-compat').RigidBody; mesh: THREE.Mesh };
  protected readonly rot: THREE.Quaternion;

  constructor(ctx: ChamberContext, entity: Entity) {
    super(ctx, entity);
    const R = E.elevatorRadius;
    const H = E.elevatorHeight;
    const o = this.origin();
    this.rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw());
    const side = 2 * R * Math.tan(Math.PI / SIDES);
    for (let k = 0; k < SIDES; k++) {
      const a = (k / SIDES) * Math.PI * 2;
      const q = this.rot.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a));
      const at = new THREE.Vector3(0, H / 2, R).applyQuaternion(q).add(o);
      const half = new THREE.Vector3(side / 2, H / 2, 0.05);
      if (k === 0) continue; // the door side
      this.fixedBox(half, at, q);
      const wall = this.add(new THREE.Mesh(new THREE.BoxGeometry(side, H, 0.1), MAT.glass()));
      wall.position.copy(at);
      wall.quaternion.copy(q);
    }
    const roof = this.add(new THREE.Mesh(new THREE.CylinderGeometry(R + 0.1, R + 0.1, 0.15, SIDES), MAT.dark()));
    roof.position.set(o.x, o.y + H + 0.075, o.z);
    roof.rotation.y = this.yaw() + Math.PI / SIDES;
    this.fixedBox(new THREE.Vector3(R, 0.075, R), new THREE.Vector3(o.x, o.y + H + 0.075, o.z));
    const floor = this.add(new THREE.Mesh(new THREE.CylinderGeometry(R + 0.1, R + 0.1, 0.04, SIDES), MAT.dark()));
    floor.position.set(o.x, o.y + 0.02, o.z);
    floor.rotation.y = roof.rotation.y;
    // The door: a metal slab on the front side that slides up into the roof.
    const at = this.doorPos(0);
    const kb = this.kinematicBox(new THREE.Vector3(side / 2, H / 2, 0.06), at, 'metal');
    kb.body.setRotation(this.rot, true);
    const mesh = this.add(new THREE.Mesh(new THREE.BoxGeometry(side, H, 0.12), MAT.metal()));
    mesh.position.copy(at);
    mesh.quaternion.copy(this.rot);
    this.door = { body: kb.body, mesh };
  }

  private doorPos(f: number): THREE.Vector3 {
    return new THREE.Vector3(0, E.elevatorHeight / 2 + f * (E.elevatorHeight - 0.05), E.elevatorRadius).applyQuaternion(this.rot).add(this.origin());
  }

  protected moveDoor(want: number, dt: number): void {
    this.doorF = THREE.MathUtils.clamp(this.doorF + Math.sign(want - this.doorF) * (dt / E.doorTime), 0, 1);
    this.placeDoor(false);
  }

  protected placeDoor(now: boolean): void {
    const p = this.doorPos(this.doorF);
    if (now) this.door.body.setTranslation(p, true);
    else this.door.body.setNextKinematicTranslation(p);
    this.door.mesh.position.copy(p);
  }

  /** Is the player standing inside the booth? */
  protected playerInside(): boolean {
    const p = this.ctx.player.position;
    const o = this.origin();
    const feet = this.ctx.player.feetY();
    return Math.hypot(p.x - o.x, p.z - o.z) < E.elevatorRadius * 0.75 && feet > o.y - 0.2 && feet < o.y + 1;
  }

  doorOpen(): number {
    return this.doorF;
  }
}

/** Entry booth: opens entryDoorDelay after the start. Input: open (default: on after the delay). */
export class EntryElevator extends Booth {
  private t = 0;

  update(dt: number): void {
    this.t += dt;
    const want = this.input('open', this.t >= E.entryDoorDelay) ? 1 : 0;
    this.moveDoor(want, dt);
  }

  snapshot(): unknown {
    return { ...(super.snapshot() as object), t: this.t, door: this.doorF };
  }

  restore(state: unknown): void {
    super.restore(state);
    const s = state as { t: number; door: number };
    this.t = s.t;
    this.doorF = s.door;
    this.placeDoor(true);
  }
}

/** Exit booth: open while its input `open` is on (default on). Output: reached. */
export class ExitElevator extends Booth {
  private ride = -1;
  private done = false;

  constructor(ctx: ChamberContext, entity: Entity) {
    super(ctx, entity);
    this.outputs.reached = false;
  }

  /** Seconds into the ride (-1 before reaching it). */
  rideTime(): number {
    return this.ride;
  }

  update(dt: number): void {
    if (this.ride < 0) {
      this.moveDoor(this.input('open', true) ? 1 : 0, dt);
      if (this.playerInside() && !this.ctx.playerDead()) {
        this.ride = 0;
        this.setOutput('reached', true);
        this.ctx.reachExit();
        this.ctx.sfx('elevatorStart', 'Elevator hums');
      }
      return;
    }
    this.moveDoor(0, dt);
    this.ride += dt;
    if (!this.done && this.ride >= E.rideSeconds) {
      this.done = true;
      this.ctx.events.emit('elevatorDone', { chamberId: this.ctx.chamberId(), next: this.ctx.level.next });
    }
  }

  snapshot(): unknown {
    return { ...(super.snapshot() as object), ride: this.ride, done: this.done, door: this.doorF };
  }

  restore(state: unknown): void {
    super.restore(state);
    const s = state as { ride: number; done: boolean; door: number };
    this.ride = s.ride;
    this.done = s.done;
    this.doorF = s.door;
    this.placeDoor(true);
  }
}
