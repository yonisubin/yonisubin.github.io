// Side jobs: get into a job vehicle and press J (JOB on touch) to start a shift; press it
// again, or get out, to end it. Each task sets the destination through the Navigator, so
// the route line, the distance and re-routing all work as for your own destinations.
//
//   Taxi (any taxi)         a fare waves at the kerb 300–900 m away; stop next to them, then
//                           take them 600–2000 m. Pay $25 + $15/km + time bonus, −10 % per
//                           hard crash on the way.
//   Ambulance (at hospitals) a patient lies 400–1200 m away; stop beside them, then get them
//                           to the nearest hospital before the clock runs out.
//   Delivery (any van)      four houses within ~1 km; stop outside each (nearest first).
//                           Pay per drop and a bonus for the whole run inside the time limit.
//
// "Stop" means within STOP_RADIUS of the spot and slower than STOP_SPEED. Time limits come
// from the route length at an average 9 m/s plus some slack, so they're fair on any trip.

import * as THREE from 'three';
import type { StreetNet } from '../world/streets';
import type { Building } from '../world/layout';
import type { CharacterLibrary } from '../player/characterLibrary';
import type { CharacterModel } from '../player/character';
import type { Navigator } from './route';
import type { PlayerStats } from './stats';
import { Rng } from '../world/rng';

export type JobKind = 'taxi' | 'ambulance' | 'delivery';

const STOP_RADIUS = 9; // m
const STOP_SPEED = 2.5; // m/s
const AVERAGE_SPEED = 9; // m/s, for time limits
const CRASH_DAMAGE = 5; // a health hit this big while carrying a fare counts as a crash

export const JOB_NAMES: Record<JobKind, string> = { taxi: 'Taxi', ambulance: 'Ambulance', delivery: 'Delivery' };

interface Task {
  /** What you're doing right now (for the HUD). */
  label: string;
  target: { x: number; z: number };
  /** Seconds left (Infinity: no limit) and the limit it started from. */
  timeLeft: number;
  limit: number;
  /** Route length when the task started (for pay). */
  distance: number;
}

/** What the jobs need from the game. */
export interface JobHooks {
  /** The vehicle you're in, if it's a job vehicle: its kind, position and speed. */
  vehicle(): { kind: JobKind | null; position: THREE.Vector3; speed: number } | null;
  /** Nearest hospital door. */
  hospital(x: number, z: number): THREE.Vector3;
  /** Height you'd stand at. */
  surface(x: number, z: number): number;
  toast(text: string, seconds?: number): void;
  /** Something else going on that rules out starting a shift (a reason), or null. */
  blocked?(): string | null;
}

export class Jobs {
  kind: JobKind | null = null;
  stage: 'pickup' | 'dropoff' | 'deliver' = 'pickup';
  task: Task | null = null;
  /** Shift earnings and tasks done. */
  earned = 0;
  done = 0;
  /** Lifetime records per job (saved). */
  record: Record<string, { done: number; earned: number }> = {};
  private drops: { x: number; z: number }[] = [];
  private dropsDone = 0;
  private dropsTotal = 0;
  private crashes = 0;
  private savedWaypoint: { x: number; z: number } | null = null;
  private readonly rng = new Rng(Date.now() % 100000);
  /** The fare (waving) or patient (lying down), shown at the pickup spot. */
  private person: CharacterModel | null = null;
  private personLoading = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly net: StreetNet,
    private readonly houses: Building[],
    private readonly library: CharacterLibrary | null,
    private readonly navigator: Navigator,
    private readonly stats: PlayerStats,
    private readonly hooks: JobHooks,
  ) {
    stats.onDamage((amount) => {
      if (this.kind && amount >= CRASH_DAMAGE && this.stage === 'dropoff') this.crashes++;
    });
  }

  get active(): boolean {
    return this.kind !== null;
  }

  /** J pressed: start a shift in this job vehicle, or end the one you're on. */
  toggle(): void {
    if (this.kind) {
      this.end();
      return;
    }
    const v = this.hooks.vehicle();
    if (!v?.kind) {
      this.hooks.toast('Get in a taxi, an ambulance or a van to work a shift', 2.5);
      return;
    }
    const blocked = this.hooks.blocked?.();
    if (blocked) {
      this.hooks.toast(blocked, 2.5);
      return;
    }
    this.kind = v.kind;
    this.earned = 0;
    this.done = 0;
    this.savedWaypoint = this.navigator.owner === 'user' ? this.navigator.waypoint : null;
    this.hooks.toast(`${JOB_NAMES[v.kind]} shift started — follow the route`, 2.5);
    this.next(v.position);
  }

  /** Stop working: pay out the shift summary and give the map back. */
  end(reason = ''): void {
    if (!this.kind) return;
    const name = JOB_NAMES[this.kind];
    this.hooks.toast(`${name} shift over${reason ? ` (${reason})` : ''}: ${this.done} done, $${this.earned} earned`, 3.5);
    this.kind = null;
    this.task = null;
    this.hidePerson();
    if (this.navigator.owner === 'job') this.navigator.clear();
    if (this.savedWaypoint) this.navigator.setWaypoint(this.savedWaypoint.x, this.savedWaypoint.z);
    this.savedWaypoint = null;
  }

  /** Call every physics step. */
  fixedUpdate(dt: number): void {
    if (!this.kind || !this.task) return;
    const v = this.hooks.vehicle();
    if (!v || v.kind !== this.kind) {
      this.end('you left the vehicle');
      return;
    }
    const t = this.task;
    t.timeLeft -= dt;
    if (t.timeLeft <= 0) {
      const lost = this.kind === 'ambulance' ? 'the patient didn’t make it' : this.kind === 'taxi' ? 'the fare gave up' : 'too slow';
      this.hooks.toast(`Out of time — ${lost}`, 2.5);
      this.next(v.position);
      return;
    }
    const near = Math.hypot(v.position.x - t.target.x, v.position.z - t.target.z) < STOP_RADIUS;
    if (!near || v.speed > STOP_SPEED) return;
    this.arrived(v.position);
  }

  /** Reached the task's spot (and stopped). */
  private arrived(at: THREE.Vector3): void {
    const t = this.task!;
    if (this.kind === 'delivery') {
      this.dropsDone++;
      this.drops.shift();
      this.pay(30, 'Delivered');
      if (this.drops.length) {
        this.setTask(`Deliver (${this.dropsDone + 1}/${this.dropsTotal})`, this.drops[0], at, t.timeLeft);
        return;
      }
      // The whole run inside the time limit: bonus.
      this.pay(60, 'Run complete! Bonus');
      this.done++;
      this.next(at);
      return;
    }
    if (this.stage === 'pickup') {
      this.hidePerson();
      this.stage = 'dropoff';
      this.crashes = 0;
      if (this.kind === 'taxi') {
        const dest = this.roadPoint(at, 600, 2000);
        this.setTask('Drive the fare', dest, at);
        this.hooks.toast('Fare on board — take them to the flag', 2);
      } else {
        const door = this.hooks.hospital(at.x, at.z);
        const road = this.net.nearest(door.x, door.z, 200) ?? door;
        this.setTask('To the hospital', { x: road.x, z: road.z }, at);
        this.hooks.toast('Patient on board — get them to hospital!', 2);
      }
      return;
    }
    // Drop-off: pay for the distance and the time left, minus crashes.
    const km = t.distance / 1000;
    const base = this.kind === 'taxi' ? 25 + 15 * km : 60 + 20 * km;
    const bonus = Math.max(0, t.timeLeft) * (this.kind === 'taxi' ? 0.5 : 1);
    const total = Math.round((base + bonus) * Math.max(0.3, 1 - 0.1 * this.crashes));
    this.done++;
    this.pay(total, this.kind === 'taxi' ? `Fare paid${this.crashes ? ` (${this.crashes} crash${this.crashes > 1 ? 'es' : ''})` : ''}` : 'Patient delivered');
    this.next(at);
  }

  private pay(amount: number, text: string): void {
    this.stats.money += amount;
    this.earned += amount;
    const rec = (this.record[this.kind!] ??= { done: 0, earned: 0 });
    rec.earned += amount;
    if (text !== 'Delivered') rec.done++;
    this.hooks.toast(`${text}: +$${amount}`, 2.2);
  }

  /** The next fare / patient / delivery run. */
  private next(from: THREE.Vector3): void {
    if (!this.kind) return;
    if (this.kind === 'delivery') {
      this.stage = 'deliver';
      this.drops = this.pickHouses(from);
      this.dropsDone = 0;
      if (!this.drops.length) {
        this.end('no houses nearby');
        return;
      }
      // Limit for the whole run: the tour length (nearest-first) at the average speed.
      let len = 0;
      let px = from.x;
      let pz = from.z;
      for (const d of this.drops) {
        len += Math.hypot(d.x - px, d.z - pz) * 1.4; // roads wind: ~1.4× the straight line
        px = d.x;
        pz = d.z;
      }
      this.dropsTotal = this.drops.length; // fewer than 4 where houses are scarce
      this.setTask(`Deliver (1/${this.dropsTotal})`, this.drops[0], from, len / AVERAGE_SPEED + 60);
      return;
    }
    this.stage = 'pickup';
    const spot = this.roadPoint(from, this.kind === 'taxi' ? 300 : 400, this.kind === 'taxi' ? 900 : 1200);
    this.setTask(this.kind === 'taxi' ? 'Pick up the fare' : 'Reach the patient', spot, from);
    this.showPerson(spot, this.kind === 'ambulance');
  }

  private setTask(label: string, target: { x: number; z: number }, from: THREE.Vector3, timeLeft?: number): void {
    const route = this.navigator.router.find(from.x, from.z, target.x, target.z, 'drive');
    const distance = route?.length ?? Math.hypot(target.x - from.x, target.z - from.z) * 1.4;
    const limit = timeLeft ?? distance / AVERAGE_SPEED + 30;
    this.task = { label, target, timeLeft: limit, limit, distance };
    this.navigator.setWaypoint(target.x, target.z, 'job');
  }

  /** A point at the side of a road `min`–`max` m (straight line) from `from`. */
  private roadPoint(from: THREE.Vector3, min: number, max: number): { x: number; z: number } {
    const at = { x: 0, z: 0, tx: 0, tz: 0 };
    for (let attempt = 0; attempt < 60; attempt++) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(min, max);
      const hit = this.net.nearest(from.x + Math.cos(a) * r, from.z + Math.sin(a) * r, 150);
      if (!hit) continue;
      const d = Math.hypot(hit.x - from.x, hit.z - from.z);
      if (d < min * 0.8 || d > max * 1.2) continue;
      const edge = this.net.edges[hit.edge];
      if (edge.length < 30) continue;
      this.net.pointAt(edge, edge.cum[hit.seg] + (edge.cum[hit.seg + 1] - edge.cum[hit.seg]) * hit.t, at);
      // On the kerb side (right of the tangent).
      const off = this.net.halfWidth(edge) - 1.2;
      return { x: at.x - at.tz * off, z: at.z + at.tx * off };
    }
    return { x: from.x + min, z: from.z };
  }

  /** Four houses within ~1 km, ordered nearest-first from `from`; targets are the road outside. */
  private pickHouses(from: THREE.Vector3): { x: number; z: number }[] {
    const near = this.houses.filter((h) => {
      const d = Math.hypot(h.x - from.x, h.z - from.z);
      return d > 120 && d < 1000;
    });
    const chosen: { x: number; z: number }[] = [];
    for (let k = 0; k < 4 && near.length; k++) {
      const h = near.splice(this.rng.int(0, near.length - 1), 1)[0];
      const road = this.net.nearest(h.x, h.z, 60);
      if (road) chosen.push({ x: road.x, z: road.z });
    }
    // Nearest-first tour.
    const out: { x: number; z: number }[] = [];
    let px = from.x;
    let pz = from.z;
    while (chosen.length) {
      let best = 0;
      for (let k = 1; k < chosen.length; k++) if (Math.hypot(chosen[k].x - px, chosen[k].z - pz) < Math.hypot(chosen[best].x - px, chosen[best].z - pz)) best = k;
      const next = chosen.splice(best, 1)[0];
      out.push(next);
      px = next.x;
      pz = next.z;
    }
    return out;
  }

  /** Stand (and wave) or lie at the pickup spot. */
  private showPerson(at: { x: number; z: number }, lying: boolean): void {
    const place = () => {
      const m = this.person!;
      m.reset();
      m.root.position.set(at.x, this.hooks.surface(at.x, at.z), at.z);
      m.root.visible = true;
      if (lying) m.knockDown();
      this.personLying = lying;
    };
    if (this.person) {
      place();
      return;
    }
    if (!this.library || this.personLoading) return;
    this.personLoading = true;
    void this.library.create(this.library.randomLook(() => this.rng.float())).then((model) => {
      this.person = model;
      this.scene.add(model.root);
      model.root.visible = false;
      if (this.task && this.stage === 'pickup' && this.kind !== 'delivery') place();
    }).catch(() => {
      this.personLoading = false; // a failed download: try again for the next fare
    });
  }
  private personLying = false;
  private waveTimer = 0;

  private hidePerson(): void {
    if (this.person) this.person.root.visible = false;
  }

  /** Animate the waiting fare (call every frame). */
  render(frameDt: number, player: THREE.Vector3): void {
    const m = this.person;
    if (!m || !m.root.visible) return;
    if (!this.personLying) {
      m.root.rotation.y = Math.atan2(-(player.x - m.root.position.x), -(player.z - m.root.position.z));
      this.waveTimer -= frameDt;
      if (this.waveTimer <= 0) {
        this.waveTimer = 2.2;
        m.play('wave');
      }
    }
    m.update(0, true, frameDt);
  }

  /** HUD line, or null when not working. */
  hudText(): string | null {
    if (!this.kind || !this.task) return null;
    const t = this.task;
    const time = Number.isFinite(t.timeLeft) ? ` · ${Math.floor(t.timeLeft / 60)}:${String(Math.floor(t.timeLeft % 60)).padStart(2, '0')}` : '';
    return `${JOB_NAMES[this.kind]}: ${t.label}${time} · $${this.earned}`;
  }
}
