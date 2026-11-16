import * as THREE from 'three';
import type { Input } from '../input/actions';
import type { Interactable } from '../player/onFoot';
import type { CityLayout } from '../world/layout';
import type { StoreSite } from './places';
import { ADDONS, AP_AMMO, AP_DAMAGE, WEAPONS, type AddonId, type PlayerStats, type WeaponId } from './stats';

// Gun stores: a shopfront on the building nearest the spawn point plus the other stores placed
// around the world (game/places.ts), each with a lit sign and a glowing marker at the door.
// E at any door opens the same buy menu (weapons, ammo, add-ons).

const SHOP_ITEMS: WeaponId[] = ['bat', 'pistol', 'rifle'];

/** The door: on the face of the building nearest `near` that faces it. */
function storeSpot(
  layout: CityLayout,
  near: THREE.Vector3,
  surface: (x: number, z: number) => number,
): { door: THREE.Vector3; normal: THREE.Vector3 } {
  let best: { door: THREE.Vector3; normal: THREE.Vector3; dist: number } | null = null;
  for (const block of layout.blocks) {
    for (const b of block.buildings) {
      const faces: [number, number, number, number][] = [
        [b.x + b.width / 2, b.z, 1, 0],
        [b.x - b.width / 2, b.z, -1, 0],
        [b.x, b.z + b.depth / 2, 0, 1],
        [b.x, b.z - b.depth / 2, 0, -1],
      ];
      for (const [fx, fz, nx, nz] of faces) {
        const dist = Math.hypot(fx - near.x, fz - near.z);
        if (!best || dist < best.dist) {
          best = { door: new THREE.Vector3(fx, 0, fz), normal: new THREE.Vector3(nx, 0, nz), dist };
        }
      }
    }
  }
  const door = best!.door;
  const normal = best!.normal;
  // Door height: the sidewalk just outside it.
  door.y = surface(door.x + normal.x, door.z + normal.z);
  return { door, normal };
}

function signTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#1c1f24';
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = '#f2c94c';
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, 500, 116);
  ctx.fillStyle = '#f2c94c';
  ctx.font = 'bold 64px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('GUNS & AMMO', 256, 68);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Shop {
  /** The first store's door (by the spawn). */
  readonly door: THREE.Vector3;
  /** Every store's door, for the maps. */
  readonly doors: THREE.Vector3[] = [];
  readonly interactables: Interactable[] = [];
  private readonly markers: THREE.Mesh[] = [];
  private panel: HTMLDivElement | null = null;
  private time = 0;

  constructor(
    scene: THREE.Scene,
    layout: CityLayout,
    near: THREE.Vector3,
    private readonly stats: PlayerStats,
    private readonly input: Input,
    sites: StoreSite[] = [],
    surface: (x: number, z: number) => number,
  ) {
    const signTex = signTexture();
    const signMaterial = new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.5 });
    const doorMaterial = new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 0.6 });
    const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xf2c94c, transparent: true, opacity: 0.8, depthWrite: false });
    const first = storeSpot(layout, near, surface);
    for (const spot of [first, ...sites]) {
      // Stand-in-front point, a little out from the wall.
      const door = spot.door.clone().addScaledVector(spot.normal, 1.2);
      const yaw = Math.atan2(spot.normal.x, spot.normal.z); // plane faces +Z by default

      const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.05), signMaterial);
      sign.position.copy(spot.door).addScaledVector(spot.normal, 0.08);
      sign.position.y = spot.door.y + 3.95;
      sign.rotation.y = yaw;
      scene.add(sign);

      const doorPanel = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.4), doorMaterial);
      doorPanel.position.copy(spot.door).addScaledVector(spot.normal, 0.05);
      doorPanel.position.y = spot.door.y + 1.05;
      doorPanel.rotation.y = yaw;
      scene.add(doorPanel);

      const marker = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.85, 32).rotateX(-Math.PI / 2), markerMaterial);
      marker.position.copy(door);
      marker.position.y = door.y + 0.03;
      scene.add(marker);
      this.markers.push(marker);

      this.doors.push(door);
      this.interactables.push({
        label: () => 'shop',
        position: () => door,
        radius: 2.2,
        activate: () => this.open(),
      });
    }
    this.door = this.doors[0];
  }

  /** Pulse the door marker. Call each frame. */
  render(frameDt: number): void {
    this.time += frameDt;
    // All markers share one material, so one pulse animates them all.
    (this.markers[0].material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.35 * Math.sin(this.time * 3);
  }

  open(): void {
    if (this.panel) return;
    this.input.setBlocked(true);
    this.input.exitPointerLock(); // free the mouse to click the menu
    const panel = document.createElement('div');
    panel.style.cssText = [
      'position:fixed',
      'left:50%',
      'top:50%',
      'transform:translate(-50%,-50%)',
      'z-index:60',
      'width:min(420px, calc(100vw - 32px))',
      'max-height:calc(100vh - 32px)',
      'overflow:auto',
      'padding:18px',
      'border-radius:14px',
      'background:rgba(20,22,26,0.94)',
      'color:#fff',
      'font:15px/1.4 system-ui,sans-serif',
      'box-shadow:0 8px 30px rgba(0,0,0,0.5)',
    ].join(';');
    // Clicks in the menu mustn't fall through to the game (pointer lock / touch look).
    for (const type of ['pointerdown', 'mousedown', 'click']) panel.addEventListener(type, (e) => e.stopPropagation());
    document.body.appendChild(panel);
    this.panel = panel;
    this.redraw();
  }

  close(): void {
    if (!this.panel) return; // input blocks are counted: release only the one we took
    this.panel.remove();
    this.panel = null;
    this.input.setBlocked(false);
  }

  private redraw(): void {
    const panel = this.panel;
    if (!panel) return;
    const s = this.stats;
    panel.innerHTML = '';
    const title = document.createElement('div');
    title.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px';
    title.innerHTML = `<span style="font-size:20px;font-weight:700;color:#f2c94c">Guns &amp; Ammo</span><span style="font:600 18px ui-monospace,monospace">$${s.money}</span>`;
    panel.appendChild(title);

    for (const id of SHOP_ITEMS) {
      const w = WEAPONS[id];
      const owned = s.owned.has(id);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid rgba(255,255,255,0.1)';
      const info = document.createElement('div');
      info.style.flex = '1';
      const kind = w.melee ? 'melee' : w.auto ? 'automatic' : 'semi-automatic';
      const rounds = owned && !w.melee ? ` · ${s.ammo[id]} rounds${s.apAmmo[id] ? ` + ${s.apAmmo[id]} AP` : ''}` : '';
      info.innerHTML = `<div style="font-weight:600">${w.name}</div><div style="opacity:0.7;font-size:13px">${kind} · damage ${w.damage}${rounds}</div>`;
      row.appendChild(info);
      if (!owned) row.appendChild(this.button(`Buy $${s.price(w.price)}`, s.money >= s.price(w.price), () => s.buyWeapon(id)));
      else if (w.ammoPrice) row.appendChild(this.button(`+${w.ammoPack} ammo $${s.price(w.ammoPrice)}`, s.money >= s.price(w.ammoPrice), () => s.buyAmmo(id)));
      else row.appendChild(this.label('Owned'));
      panel.appendChild(row);

      // Add-ons appear once you own the weapon.
      if (!owned) continue;
      for (const addon of Object.keys(ADDONS) as AddonId[]) {
        const def = ADDONS[addon];
        const list = def.price[id];
        if (list === undefined) continue;
        const price = s.price(list);
        const has = s.hasAddon(id, addon);
        panel.appendChild(
          this.subRow(`${def.name}`, def.description, has ? this.label('Fitted') : this.button(`$${price}`, s.money >= price, () => s.buyAddon(id, addon))),
        );
      }
      const ap = AP_AMMO[id];
      if (ap) {
        const perRound = (ap.price / ap.pack).toFixed(2);
        panel.appendChild(
          this.subRow(
            'Armour-piercing rounds',
            `+${Math.round((AP_DAMAGE - 1) * 100)}% damage · $${perRound} a round · fired first`,
            this.button(`+${ap.pack} $${s.price(ap.price)}`, s.money >= s.price(ap.price), () => s.buyApAmmo(id)),
          ),
        );
      }
    }

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-top:12px;gap:10px';
    const hint = document.createElement('span');
    hint.style.cssText = 'opacity:0.6;font-size:12px';
    hint.textContent = 'Q switches weapons · F / click to attack';
    footer.appendChild(hint);
    footer.appendChild(this.button('Leave', true, () => this.close(), '#555'));
    panel.appendChild(footer);
  }

  private button(text: string, enabled: boolean, onClick: () => void, color = '#2f7d45'): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = text;
    b.disabled = !enabled;
    b.style.cssText = [
      'padding:8px 12px',
      'border:0',
      'border-radius:8px',
      `background:${enabled ? color : '#333'}`,
      `color:${enabled ? '#fff' : '#888'}`,
      'font:600 14px system-ui,sans-serif',
      `cursor:${enabled ? 'pointer' : 'default'}`,
      'white-space:nowrap',
    ].join(';');
    b.addEventListener('click', () => {
      onClick();
      this.redraw();
    });
    return b;
  }

  /** An indented add-on line under its weapon. */
  private subRow(name: string, description: string, action: HTMLElement): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:5px 0 5px 16px';
    const info = document.createElement('div');
    info.style.flex = '1';
    info.innerHTML = `<div style="font-size:14px">↳ ${name}</div><div style="opacity:0.6;font-size:12px">${description}</div>`;
    row.append(info, action);
    return row;
  }

  private label(text: string): HTMLSpanElement {
    const el = document.createElement('span');
    el.style.cssText = 'opacity:0.6;font-size:14px;padding:8px 4px';
    el.textContent = text;
    return el;
  }
}
