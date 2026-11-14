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
  bat: { id: 'bat', name: 'Baseball bat', price: 150, melee: true, damage: 35, range: 2.3, cooldown: 0.7 },
  pistol: {
    id: 'pistol', name: 'Pistol', price: 400, melee: false, damage: 34, range: 80, cooldown: 0.3,
    ammoPrice: 40, ammoPack: 12, startAmmo: 24,
  },
  rifle: {
    id: 'rifle', name: 'Rifle', price: 1200, melee: false, damage: 50, range: 150, cooldown: 0.11, auto: true,
    ammoPrice: 80, ammoPack: 30, startAmmo: 60,
  },
};
export const WEAPON_ORDER: WeaponId[] = ['fists', 'bat', 'pistol', 'rifle'];

export const MAX_HEALTH = 100;
export const START_MONEY = 200; // enough for the bat
const REGEN_DELAY = 6; // s after the last damage before health starts coming back
const REGEN_RATE = 5; // health per second
const DEATH_MONEY_LOSS = 0.2; // fraction of cash lost when you die

export class PlayerStats implements SimEntity {
  health = MAX_HEALTH;
  money = START_MONEY;
  readonly owned = new Set<WeaponId>(['fists']);
  readonly ammo: Record<WeaponId, number> = { fists: 0, bat: 0, pistol: 0, rifle: 0 };
  current: WeaponId = 'fists';
  dead = false;

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
    if (this.owned.has(id) || this.money < w.price) return false;
    this.money -= w.price;
    this.owned.add(id);
    this.ammo[id] += w.startAmmo ?? 0;
    this.current = id;
    return true;
  }

  buyAmmo(id: WeaponId): boolean {
    const w = WEAPONS[id];
    if (!w.ammoPrice || !this.owned.has(id) || this.money < w.ammoPrice) return false;
    this.money -= w.ammoPrice;
    this.ammo[id] += w.ammoPack!;
    return true;
  }

  /** Switch to the next owned weapon. */
  cycleWeapon(): void {
    const owned = WEAPON_ORDER.filter((id) => this.owned.has(id));
    this.current = owned[(owned.indexOf(this.current) + 1) % owned.length];
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
