// Decides what you hear each frame from the state of the game: your engine (car, helicopter
// or boat), footsteps, the nearest traffic, police sirens and helicopter, the wind, the sea,
// the city, birds by day and crickets at night, and the car radio. It owns the continuous
// voices (built once, when the audio starts) and only sets their levels and pitches.

import * as THREE from 'three';
import { EngineVoice, NoiseVoice, RotorVoice, SirenVoice, type Sound } from './sound';
import { Radio } from './radio';

/** What the game tells the sound each frame. */
export interface SoundState {
  camera: THREE.Camera;
  mode: 'foot' | 'car' | 'heli' | 'boat';
  /** Where you are (feet / vehicle centre). */
  focus: THREE.Vector3;
  swimming: boolean;
  /** Car: signed speed (m/s), throttle (−1…1), sideways slide speed (m/s). */
  car: { speed: number; throttle: number; slide: number } | null;
  /** Helicopter rotor 0…1 (yours, while flying). */
  rotor: number;
  /** Boat speed (m/s) and throttle. */
  boat: { speed: number; throttle: number } | null;
  /** Height above the ground (m), for wind. */
  height: number;
  traffic: THREE.Vector3[];
  /** Police cars chasing / blocking, and the police helicopter (or null). */
  sirens: THREE.Vector3[];
  policeHeli: THREE.Vector3 | null;
  night: number; // 0 day … 1 night
  /** 0 … 1: how much water is around (waves), how built-up it is (city hum). */
  water: number;
  urban: number;
}

// Gears for the fake engine note: each spans a speed range (m/s); rpm climbs through it.
const GEARS = [0, 6, 12, 19, 27, 36, 60];

export class SoundDirector {
  readonly radio: Radio;
  private car: EngineVoice | null = null;
  private boatEngine: EngineVoice | null = null;
  private heli: RotorVoice | null = null;
  private policeHeli: RotorVoice | null = null;
  private screech: NoiseVoice | null = null;
  private wind: NoiseVoice | null = null;
  private waves: NoiseVoice | null = null;
  private hum: NoiseVoice | null = null;
  private wake: NoiseVoice | null = null;
  private readonly traffic: EngineVoice[] = [];
  private readonly sirens: SirenVoice[] = [];
  private readonly last = new THREE.Vector3();
  private stride = 0;
  private time = 0;
  private ambientTimer = 1;

  constructor(private readonly s: Sound) {
    this.radio = new Radio(s);
    s.onStart(() => this.build());
  }

  private build(): void {
    const s = this.s;
    this.car = new EngineVoice(s, 38, false);
    this.boatEngine = new EngineVoice(s, 62, false);
    this.heli = new RotorVoice(s, false);
    this.policeHeli = new RotorVoice(s, true);
    this.screech = new NoiseVoice(s, 'bandpass', 2400, 4);
    this.wind = new NoiseVoice(s, 'lowpass', 500, 0.7);
    this.waves = new NoiseVoice(s, 'lowpass', 600, 0.5);
    this.hum = new NoiseVoice(s, 'lowpass', 140, 0.7);
    this.wake = new NoiseVoice(s, 'bandpass', 900, 0.8);
    for (let k = 0; k < 3; k++) this.traffic.push(new EngineVoice(s, 34 + k * 5, true));
    for (let k = 0; k < 2; k++) this.sirens.push(new SirenVoice(s));
  }

  update(dt: number, st: SoundState): void {
    const s = this.s;
    this.radio.update(st.mode === 'car' || st.mode === 'boat');
    if (!s.ctx || !this.car) return;
    this.time += dt;
    s.setListener(st.camera);

    // --- Your vehicle.
    if (st.mode === 'car' && st.car) {
      const v = Math.abs(st.car.speed);
      let g = 0;
      while (g < GEARS.length - 2 && v > GEARS[g + 1]) g++;
      const rpm = 0.15 + 0.85 * ((v - GEARS[g]) / (GEARS[g + 1] - GEARS[g]));
      this.car.set(Math.min(1, rpm), Math.max(0, st.car.throttle), 1);
      this.screech!.set(st.car.slide > 3.5 && v > 5 ? Math.min(0.12, (st.car.slide - 3.5) * 0.03) : 0, 2200 + st.car.slide * 60, 0.05);
    } else {
      this.car.set(0, 0, 0);
      this.screech!.set(0);
    }
    this.heli!.set(st.mode === 'heli' ? st.rotor : 0, 1);
    if (st.mode === 'boat' && st.boat) {
      this.boatEngine!.set(Math.min(1, Math.abs(st.boat.speed) / 22), Math.abs(st.boat.throttle), 1.2);
      this.wake!.set(Math.min(0.15, Math.abs(st.boat.speed) * 0.008));
    } else {
      this.boatEngine!.set(0, 0, 0);
      this.wake!.set(0);
    }

    // --- Footsteps: one per ~0.8 m walked (1.1 m running), splashes when swimming.
    if (st.mode === 'foot') {
      const moved = Math.hypot(st.focus.x - this.last.x, st.focus.z - this.last.z);
      if (moved < 3) {
        const speed = dt > 0 ? moved / dt : 0;
        const running = speed > 3.2;
        this.stride += moved;
        const every = st.swimming ? 1.3 : running ? 1.1 : 0.8;
        if (this.stride > every && speed > 0.5) {
          this.stride = 0;
          s.step(running, st.swimming);
        }
      }
    }
    this.last.copy(st.focus);

    // --- Other cars: the three nearest traffic engines.
    const near = st.traffic
      .map((p) => ({ p, d: p.distanceToSquared(st.focus) }))
      .filter((e) => e.d < 90 * 90)
      .sort((a, b) => a.d - b.d);
    this.traffic.forEach((voice, k) => {
      const e = near[k];
      voice.set(0.3, 0.3, e ? 0.8 : 0, e?.p);
    });

    // --- Police: two nearest sirens and the helicopter.
    const sirens = st.sirens.map((p) => ({ p, d: p.distanceToSquared(st.focus) })).sort((a, b) => a.d - b.d);
    this.sirens.forEach((voice, k) => {
      const e = sirens[k];
      if (e) voice.set(1, e.p);
      else voice.set(0, st.focus);
    });
    this.policeHeli!.set(st.policeHeli ? 1 : 0, 1.4, st.policeHeli ?? st.focus);

    // --- Ambience.
    const moving = st.mode === 'car' ? Math.abs(st.car?.speed ?? 0) : st.mode === 'heli' ? 20 : 0;
    this.wind!.set(Math.min(0.12, 0.012 + st.height * 0.0006 + moving * 0.002), 300 + Math.min(900, moving * 25 + st.height * 4));
    // Waves come and go every few seconds.
    const swell = 0.6 + 0.4 * Math.sin(this.time * 0.9) * Math.sin(this.time * 0.37);
    this.waves!.set(st.water * 0.09 * swell, 500 + swell * 400, 0.3);
    this.hum!.set(st.urban * 0.05 * (1 - st.night * 0.5));
    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0 && st.mode === 'foot') {
      this.ambientTimer = 0.6 + Math.random() * 2.2;
      // A bird (day) or a cricket (night) somewhere nearby, more in green places.
      const green = 1 - st.urban * 0.7;
      if (Math.random() < green) {
        const a = Math.random() * Math.PI * 2;
        const r = 8 + Math.random() * 25;
        const at = new THREE.Vector3(st.focus.x + Math.cos(a) * r, st.focus.y + 3 + Math.random() * 5, st.focus.z + Math.sin(a) * r);
        if (st.night > 0.6) s.cricket(at);
        else if (st.night < 0.3) s.chirp(at);
      }
    }
  }
}
