import type { Input } from '../input/actions';
import type { SimEntity } from '../sim/entity';
import type { City } from './city';
import type { Lighting, SkyRig } from './sky';
import { facadeNight } from './facadeMaterial';
import { carMaterials } from '../vehicles/carModel';

// Day/night cycle. Time advances with the physics clock (so it's deterministic and
// testable); each rendered frame the current time is pushed to everything that changes
// with it: sun/moon and sky, lit windows, street lamps, vehicle lights.

const DAY_LENGTH = 12 * 60; // real seconds for a full 24 h day
const START_HOUR = 10;
const FAST_FORWARD = 40; // × while the time-skip key (T) is held

export class DayNight implements SimEntity {
  hours = START_HOUR;
  lighting: Lighting = { daylight: 1, night: 0 };

  constructor(
    private readonly sky: SkyRig,
    private readonly city: City,
    private readonly input: Input,
  ) {
    this.apply();
  }

  fixedUpdate(dt: number): void {
    const rate = this.input.isDown('timeSkip') ? FAST_FORWARD : 1;
    this.hours = (this.hours + ((dt * 24) / DAY_LENGTH) * rate) % 24;
  }

  afterStep(): void {}

  render(): void {
    this.apply();
  }

  private apply(): void {
    this.lighting = this.sky.setTime(this.hours);
    const n = this.lighting.night;
    this.city.setNight(n);
    facadeNight.value = n;
    carMaterials.headlight.emissiveIntensity = 0.6 + 3 * n;
    carMaterials.taillight.emissiveIntensity = 0.4 + 2 * n;
    carMaterials.sign.emissiveIntensity = 0.4 + 1.5 * n;
  }

  /** "HH:MM" */
  get clock(): string {
    const h = Math.floor(this.hours);
    const m = Math.floor((this.hours - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
