import * as THREE from 'three';
import type { Input } from '../input/actions';
import type { Interactable } from '../player/onFoot';
import { CURB_HEIGHT, type CityLayout } from '../world/layout';
import { WEAPONS, type PlayerStats, type WeaponId } from './stats';

// The gun store: a shopfront on the building nearest the spawn point, with a lit sign and a
// glowing marker at the door. E at the door opens a buy menu (weapons and ammo).

const SHOP_ITEMS: WeaponId[] = ['bat', 'pistol', 'rifle'];

/** The door: on the face of the building nearest `near` that faces it. */
function storeSpot(layout: CityLayout, near: THREE.Vector3): { door: THREE.Vector3; normal: THREE.Vector3 } {
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
          best = { door: new THREE.Vector3(fx, CURB_HEIGHT, fz), normal: new THREE.Vector3(nx, 0, nz), dist };
        }
      }
    }
  }
  return best!;
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
  readonly door: THREE.Vector3;
  readonly interactable: Interactable;
  private readonly marker: THREE.Mesh;
  private panel: HTMLDivElement | null = null;
  private time = 0;

  constructor(
    scene: THREE.Scene,
    layout: CityLayout,
    near: THREE.Vector3,
    private readonly stats: PlayerStats,
    private readonly input: Input,
  ) {
    const spot = storeSpot(layout, near);
    // Stand-in-front point, a little out from the wall.
    this.door = spot.door.clone().addScaledVector(spot.normal, 1.2);
    const yaw = Math.atan2(spot.normal.x, spot.normal.z); // plane faces +Z by default

    const signTex = signTexture();
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(4.2, 1.05),
      new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.5 }),
    );
    sign.position.copy(spot.door).addScaledVector(spot.normal, 0.08);
    sign.position.y = CURB_HEIGHT + 4.1;
    sign.rotation.y = yaw;
    scene.add(sign);

    const doorPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 2.4),
      new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 0.6 }),
    );
    doorPanel.position.copy(spot.door).addScaledVector(spot.normal, 0.05);
    doorPanel.position.y = CURB_HEIGHT + 1.2;
    doorPanel.rotation.y = yaw;
    scene.add(doorPanel);

    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 0.85, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xf2c94c, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    this.marker.position.copy(this.door);
    this.marker.position.y = CURB_HEIGHT + 0.03;
    scene.add(this.marker);

    this.interactable = {
      label: () => 'shop',
      position: () => this.door,
      radius: 2.2,
      activate: () => this.open(),
    };
  }

  get isOpen(): boolean {
    return this.panel !== null;
  }

  /** Pulse the door marker. Call each frame. */
  render(frameDt: number): void {
    this.time += frameDt;
    (this.marker.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.35 * Math.sin(this.time * 3);
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
    this.panel?.remove();
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
      info.innerHTML = `<div style="font-weight:600">${w.name}</div><div style="opacity:0.7;font-size:13px">${kind} · damage ${w.damage}${owned && !w.melee ? ` · ${s.ammo[id]} rounds` : ''}</div>`;
      row.appendChild(info);
      if (!owned) row.appendChild(this.button(`Buy $${w.price}`, s.money >= w.price, () => s.buyWeapon(id)));
      else if (w.ammoPrice) row.appendChild(this.button(`+${w.ammoPack} ammo $${w.ammoPrice}`, s.money >= w.ammoPrice, () => s.buyAmmo(id)));
      else row.appendChild(this.label('Owned'));
      panel.appendChild(row);
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

  private label(text: string): HTMLSpanElement {
    const el = document.createElement('span');
    el.style.cssText = 'opacity:0.6;font-size:14px;padding:8px 4px';
    el.textContent = text;
    return el;
  }
}
