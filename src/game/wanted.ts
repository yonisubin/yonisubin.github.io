// The wanted level: 0–5 stars, raised by crimes and lost by staying out of police sight.
//
// Crimes add "heat" (one star = 1.0). A crime the police see counts double. The stars are
// the whole part of the heat, so a single punch (0.5) gives none, but a second one does.
//
// Losing them: while no police unit can see you, a timer runs. After LOSE_TIME seconds
// you drop one star, and the timer starts again for the next one. Any sighting resets it.
// Below one star, leftover heat fades slowly. Dying or being busted clears everything.
//
// How tough the police are follows the stars (npc/police.ts): 1–2 they chase and ram,
// 3+ officers shoot, 4+ roadblocks, 5 a helicopter.

import type { SimEntity } from '../sim/entity';

export const MAX_STARS = 5;
/** Seconds out of sight to drop a star. */
export const LOSE_TIME = 20;

/** How much heat each crime is worth (stars). */
export const CRIMES = {
  assault: 0.5, // hitting someone
  knockout: 1, // knocking someone out (fists, bat, gun or car)
  gunfire: 0.5, // shooting near people (at most once every couple of seconds)
  carjack: 1,
  wreck: 1, // wrecking a traffic car
  police: 1, // hurting an officer or a police car (and at least 2 stars)
} as const;
export type Crime = keyof typeof CRIMES;

export class Wanted implements SimEntity {
  /** 0 … MAX_STARS + 0.99 */
  heat = 0;
  /** Seconds since police last saw you (only counts while you're wanted). */
  unseen = 0;
  /** Set each step by the police: can any unit see the player right now? */
  seen = false;
  /** Did the police see the last crime? (Whoever reports crimes can check `witnessed`.) */
  witnessed: (() => boolean) | null = null;
  private gunfireCooldown = 0;
  private readonly listeners: ((stars: number, previous: number) => void)[] = [];

  get stars(): number {
    return Math.min(MAX_STARS, Math.floor(this.heat));
  }

  /** True while stars are counting down (police have lost sight of you). */
  get evading(): boolean {
    return this.stars > 0 && this.unseen > 2;
  }

  /** Called with (new stars, old stars) whenever the star count changes. */
  onChange(listener: (stars: number, previous: number) => void): void {
    this.listeners.push(listener);
  }

  /** A crime happened. Seen by the police, it counts double. */
  crime(kind: Crime): void {
    if (kind === 'gunfire') {
      if (this.gunfireCooldown > 0) return;
      this.gunfireCooldown = 2;
    }
    const before = this.stars;
    let amount: number = CRIMES[kind];
    // Seen by the police: double (crimes against the police are always seen, so not those).
    if (kind !== 'police' && this.witnessed?.()) amount *= 2;
    this.heat = Math.min(MAX_STARS + 0.99, this.heat + amount);
    if (kind === 'police') this.heat = Math.max(this.heat, 2);
    this.unseen = 0;
    this.notify(before);
  }

  /** Busted, dead, or a new game: no stars. */
  clear(): void {
    const before = this.stars;
    this.heat = 0;
    this.unseen = 0;
    this.notify(before);
  }

  fixedUpdate(dt: number): void {
    this.gunfireCooldown = Math.max(0, this.gunfireCooldown - dt);
    if (this.stars === 0) {
      this.unseen = 0;
      this.heat = Math.max(0, this.heat - dt * 0.02); // leftover heat fades over ~25–50 s
      return;
    }
    if (this.seen) {
      this.unseen = 0;
      return;
    }
    this.unseen += dt;
    if (this.unseen >= LOSE_TIME) {
      const before = this.stars;
      this.heat = before - 1; // exactly one star less, nothing left over
      this.unseen = 0;
      this.notify(before);
    }
  }

  afterStep(): void {}
  render(): void {}

  private notify(before: number): void {
    const now = this.stars;
    if (now !== before) for (const l of this.listeners) l(now, before);
  }
}
