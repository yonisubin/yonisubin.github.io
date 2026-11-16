import type { SimEntity } from '../sim/entity';

// The player's health, money and weapons.

export type WeaponId = 'fists' | 'bat' | 'pistol' | 'rifle';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  price: number; // $ (0 = always owned)
  melee: boolean;
  damage: number; // per hit (NPCs have 100 health)
  range: number; // m
  cooldown: number; // s between attacks
  auto?: boolean; // keeps firing while the button is held
  ammoPrice?: number; // $ per pack
  ammoPack?: number; // rounds per pack
  startAmmo?: number; // rounds included with the gun
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  fists: { id: 'fists', name: 'Fists', price: 0, melee: true, damage: 12, range: 1.7, cooldown: 0.45 },
  bat: { id: 'bat', name: 'Baseball bat', price: 100, melee: true, damage: 35, range: 2.3, cooldown: 0.7 },
  pistol: {
    id: 'pistol', name: 'Pistol', price: 300, melee: false, damage: 34, range: 80, cooldown: 0.3,
    ammoPrice: 30, ammoPack: 12, startAmmo: 24,
  },
  rifle: {
    id: 'rifle', name: 'Rifle', price: 800, melee: false, damage: 50, range: 150, cooldown: 0.11, auto: true,
    ammoPrice: 60, ammoPack: 30, startAmmo: 60,
  },
};
export const WEAPON_ORDER: WeaponId[] = ['fists', 'bat', 'pistol', 'rifle'];

// --- Weapon add-ons, sold at the store once you own the weapon.
//  scope — 4× zoom while aiming (guns only)
//  grip  — light grip / sling: run faster while that weapon is in hand
//  AP rounds — armour-piercing ammo: +50% damage, ~2.5× the price per bullet; separate
//              rounds that are fired before normal ones.
export type AddonId = 'scope' | 'grip';

export interface AddonDef {
  id: AddonId;
  name: string;
  description: string;
  price: Partial<Record<WeaponId, number>>; // which weapons can take it, and the price
}

export const ADDONS: Record<AddonId, AddonDef> = {
  scope: { id: 'scope', name: 'Scope', description: '4× zoom while aiming', price: { pistol: 150, rifle: 200 } },
  grip: { id: 'grip', name: 'Light grip', description: '+20% run speed', price: { bat: 60, pistol: 80, rifle: 120 } },
};

/** Armour-piercing rounds: damage multiplier, and price/pack per gun (normal ammo is $2.50/$2 a round). */
export const AP_DAMAGE = 1.5;
export const AP_AMMO: Partial<Record<WeaponId, { price: number; pack: number }>> = {
  pistol: { price: 75, pack: 12 }, // $6.25 a round
  rifle: { price: 150, pack: 30 }, // $5 a round
};

// Moving with a weapon in hand: guns weigh you down a little; a light grip makes any weapon
// quicker to run with.
const CARRY_SPEED: Record<WeaponId, number> = { fists: 1, bat: 1, pistol: 0.95, rifle: 0.9 };
const GRIP_SPEED = 1.2;

export const MAX_HEALTH = 100;
// Economy targets: bat straight away, pistol after ~1–2 min of collecting cash, rifle after
// ~4–5 min. Everything together costs ~45% of the cash lying around the city at once.
export const START_MONEY = 200; // the bat, with $100 left toward the pistol
const REGEN_DELAY = 6; // s after the last damage before health starts coming back
const REGEN_RATE = 5; // health per second
const DEATH_MONEY_LOSS = 0.2; // fraction of cash lost when you die

export class PlayerStats implements SimEntity {
  health = MAX_HEALTH;
  money = START_MONEY;
  readonly owned = new Set<WeaponId>(['fists']);
  readonly ammo: Record<WeaponId, number> = { fists: 0, bat: 0, pistol: 0, rifle: 0 };
  /** Armour-piercing rounds, fired before normal ammo. */
  readonly apAmmo: Record<WeaponId, number> = { fists: 0, bat: 0, pistol: 0, rifle: 0 };
  /** Owned add-ons, as "weapon:addon" keys. */
  readonly addons = new Set<string>();
  current: WeaponId = 'fists';
  dead = false;
  /** Shop price multiplier (the story's friends-of-Dolores discount sets 0.85). */
  priceFactor = 1;

  /** What a list price costs you now (rounded to the dollar). */
  price(list: number): number {
    return Math.round(list * this.priceFactor);
  }

  private sinceDamage = Infinity;
  private readonly damageListeners: ((amount: number) => void)[] = [];
  private readonly deathListeners: (() => void)[] = [];

  onDamage(listener: (amount: number) => void): void {
    this.damageListeners.push(listener);
  }

  onDeath(listener: () => void): void {
    this.deathListeners.push(listener);
  }

  get weapon(): WeaponDef {
    return WEAPONS[this.current];
  }

  /** True when holding anything better than fists (needed to carjack). */
  get armed(): boolean {
    return this.current !== 'fists';
  }

  damage(amount: number): void {
    if (this.dead || amount <= 0) return;
    this.health = Math.max(0, this.health - amount);
    this.sinceDamage = 0;
    for (const l of this.damageListeners) l(amount);
    if (this.health === 0) {
      this.dead = true;
      for (const l of this.deathListeners) l();
    }
  }

  /** Back to full health after dying; lose some cash, keep the weapons. */
  respawn(): void {
    this.money = Math.floor(this.money * (1 - DEATH_MONEY_LOSS));
    this.health = MAX_HEALTH;
    this.dead = false;
    this.sinceDamage = Infinity;
  }

  buyWeapon(id: WeaponId): boolean {
    const w = WEAPONS[id];
    if (this.owned.has(id) || this.money < this.price(w.price)) return false;
    this.money -= this.price(w.price);
    this.owned.add(id);
    this.ammo[id] += w.startAmmo ?? 0;
    this.current = id;
    return true;
  }

  hasAddon(weapon: WeaponId, addon: AddonId): boolean {
    return this.addons.has(`${weapon}:${addon}`);
  }

  buyAddon(weapon: WeaponId, addon: AddonId): boolean {
    const list = ADDONS[addon].price[weapon];
    if (list === undefined) return false;
    const price = this.price(list);
    if (!this.owned.has(weapon) || this.hasAddon(weapon, addon) || this.money < price) return false;
    this.money -= price;
    this.addons.add(`${weapon}:${addon}`);
    return true;
  }

  buyApAmmo(id: WeaponId): boolean {
    const ap = AP_AMMO[id];
    if (!ap || !this.owned.has(id) || this.money < this.price(ap.price)) return false;
    this.money -= this.price(ap.price);
    this.apAmmo[id] += ap.pack;
    return true;
  }

  /** Total rounds left for a gun (AP + normal). */
  roundsLeft(id: WeaponId): number {
    return this.ammo[id] + this.apAmmo[id];
  }

  /**
   * Use up one round of the current gun and return its damage (AP rounds first), or null
   * if it's out of ammo.
   */
  fireRound(): number | null {
    const w = this.weapon;
    if (this.apAmmo[w.id] > 0) {
      this.apAmmo[w.id]--;
      return w.damage * AP_DAMAGE;
    }
    if (this.ammo[w.id] > 0) {
      this.ammo[w.id]--;
      return w.damage;
    }
    return null;
  }

  /** Running/walking speed multiplier for the weapon in hand. */
  get moveSpeedMultiplier(): number {
    return this.hasAddon(this.current, 'grip') ? GRIP_SPEED : CARRY_SPEED[this.current];
  }

  /** True if the weapon in hand has a scope fitted. */
  get scoped(): boolean {
    return this.hasAddon(this.current, 'scope');
  }

  buyAmmo(id: WeaponId): boolean {
    const w = WEAPONS[id];
    if (!w.ammoPrice || !this.owned.has(id) || this.money < this.price(w.ammoPrice)) return false;
    this.money -= this.price(w.ammoPrice);
    this.ammo[id] += w.ammoPack!;
    return true;
  }

  /** Switch to the next owned weapon. */
  cycleWeapon(): void {
    const owned = WEAPON_ORDER.filter((id) => this.owned.has(id));
    this.current = owned[(owned.indexOf(this.current) + 1) % owned.length];
  }

  /** What gets saved (game/save.ts). */
  toJSON(): {
    health: number;
    money: number;
    owned: string[];
    ammo: Record<string, number>;
    apAmmo: Record<string, number>;
    addons: string[];
    current: string;
  } {
    return {
      health: this.health,
      money: this.money,
      owned: [...this.owned],
      ammo: { ...this.ammo },
      apAmmo: { ...this.apAmmo },
      addons: [...this.addons],
      current: this.current,
    };
  }

  /** Restore saved stats, ignoring anything that isn't a known weapon or add-on. */
  load(data: ReturnType<PlayerStats['toJSON']>): void {
    // Own keys only: `"constructor" in WEAPONS` is true too.
    const isWeapon = (id: unknown): id is WeaponId => typeof id === 'string' && Object.hasOwn(WEAPONS, id);
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
    this.money = num(data.money);
    this.health = Math.max(20, Math.min(MAX_HEALTH, num(data.health))); // never wake up nearly dead
    for (const id of Array.isArray(data.owned) ? data.owned : []) if (isWeapon(id)) this.owned.add(id);
    for (const id of WEAPON_ORDER) {
      this.ammo[id] = num(data.ammo?.[id]);
      this.apAmmo[id] = num(data.apAmmo?.[id]);
    }
    for (const key of Array.isArray(data.addons) ? data.addons : []) {
      if (typeof key !== 'string') continue;
      const [w, a] = key.split(':');
      if (isWeapon(w) && Object.hasOwn(ADDONS, a)) this.addons.add(key);
    }
    if (isWeapon(data.current) && this.owned.has(data.current)) this.current = data.current;
  }

  /** Health regenerates once you've avoided damage for a few seconds. */
  fixedUpdate(dt: number): void {
    this.sinceDamage += dt;
    if (!this.dead && this.sinceDamage > REGEN_DELAY && this.health < MAX_HEALTH) {
      this.health = Math.min(MAX_HEALTH, this.health + REGEN_RATE * dt);
    }
  }

  afterStep(): void {}
  render(): void {}
}
