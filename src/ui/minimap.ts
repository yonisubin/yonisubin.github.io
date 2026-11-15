import type * as THREE from 'three';
import type { Input } from '../input/actions';
import type { WorldMap } from '../world/mapImage';

// Round minimap in the top-right corner. Each frame the pre-drawn world picture
// (world/mapImage.ts) is drawn rotated and moved so the player is in the middle and the
// camera's view direction points up, with sharp vector roads and buildings for the area in
// view on top. Markers (vehicles, traffic) are drawn over that. Zooms out as the player gets
// higher (helicopter). M toggles it.

const VIEW_RADIUS = 110; // m from the centre to the edge of the minimap, at ground level

export type MarkerKind = 'car' | 'heli' | 'traffic' | 'shop' | 'giver' | 'objective';
export interface Marker {
  kind: MarkerKind;
  position: THREE.Vector3;
}

export class Minimap {
  readonly size: number; // CSS px
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly dpr: number;
  private visible = true;

  constructor(
    private readonly map: WorldMap,
    private readonly input: Input,
    touch: boolean,
  ) {
    this.size = touch ? 120 : 160;
    this.dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = this.size * this.dpr;
    this.canvas.style.cssText = [
      'position:fixed',
      'top:max(10px, env(safe-area-inset-top))',
      'right:max(10px, env(safe-area-inset-right))',
      `width:${this.size}px`,
      `height:${this.size}px`,
      'z-index:20',
      'border-radius:50%',
      'box-shadow:0 2px 10px rgba(0,0,0,0.35)',
      'pointer-events:none',
    ].join(';');
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  /**
   * @param centre  player position
   * @param forward camera view direction (only x/z used); it points up on the map
   */
  update(centre: THREE.Vector3, forward: THREE.Vector3, markers: Marker[], clock: string): void {
    if (this.input.consumePressed('toggleMap')) {
      this.visible = !this.visible;
      this.canvas.style.display = this.visible ? '' : 'none';
    }
    if (!this.visible) return;

    const ctx = this.ctx;
    const s = this.size * this.dpr;
    const r = s / 2;
    // Zoom out with altitude so the helicopter sees more of the city.
    const viewRadius = Math.min(300, VIEW_RADIUS + Math.max(0, centre.y) * 1.8);
    const k = r / viewRadius; // canvas px per metre
    // Rotate so the camera's forward direction (fx, fz) — z is "down" on the map — points up:
    // its angle a = atan2(fz, fx) has to become −90°.
    const angle = -Math.PI / 2 - Math.atan2(forward.z, forward.x);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, s, s);
    ctx.save();
    ctx.beginPath();
    ctx.arc(r, r, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#5d7a45';
    ctx.fillRect(0, 0, s, s);

    // World → minimap: translate so the player is at the origin, rotate, scale, centre.
    ctx.translate(r, r);
    ctx.rotate(angle);
    ctx.scale(k, k);
    ctx.translate(-centre.x, -centre.z);
    ctx.drawImage(this.map.canvas, -this.map.half, -this.map.half, this.map.half * 2, this.map.half * 2);
    this.map.drawDetail(ctx, centre.x, centre.z, viewRadius * 1.5);

    // Markers, kept a constant size on screen.
    const px = 1 / k;
    for (const m of markers) {
      let { x, z } = m.position;
      if (m.kind === 'objective') {
        // Objectives off the edge of the map are pinned to the rim, pointing the way.
        const dx = x - centre.x;
        const dz = z - centre.z;
        const d = Math.hypot(dx, dz);
        const max = viewRadius - 8 * px;
        if (d > max) {
          x = centre.x + (dx / d) * max;
          z = centre.z + (dz / d) * max;
        }
        ctx.fillStyle = '#ff3b5c';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5 * px;
        ctx.beginPath();
        ctx.arc(x, z, 5.5 * px, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        continue;
      }
      if (m.kind === 'giver') {
        ctx.fillStyle = '#ffd60a';
        ctx.beginPath();
        ctx.arc(x, z, 6 * px, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#222';
        ctx.font = `bold ${10 * px}px system-ui,sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('!', x, z + 0.5 * px);
        continue;
      }
      if (m.kind === 'traffic') {
        ctx.fillStyle = '#d9d9d2';
        ctx.fillRect(x - 2.2 * px, z - 2.2 * px, 4.4 * px, 4.4 * px);
      } else if (m.kind === 'shop') {
        ctx.fillStyle = '#f2c94c';
        ctx.beginPath();
        ctx.arc(x, z, 6 * px, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#222';
        ctx.font = `bold ${9 * px}px system-ui,sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('$', x, z + 0.5 * px);
      } else if (m.kind === 'car') {
        ctx.fillStyle = '#3d8cff';
        ctx.fillRect(x - 3.5 * px, z - 3.5 * px, 7 * px, 7 * px);
      } else {
        ctx.fillStyle = '#ffcc33';
        ctx.beginPath();
        ctx.arc(x, z, 6 * px, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#222';
        ctx.font = `bold ${9 * px}px system-ui,sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('H', x, z + 0.5 * px);
      }
    }
    ctx.restore();

    // Player arrow (always points up: the map turns instead).
    ctx.fillStyle = '#ff5a3c';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5 * this.dpr;
    ctx.beginPath();
    ctx.moveTo(r, r - 8 * this.dpr);
    ctx.lineTo(r + 6 * this.dpr, r + 6 * this.dpr);
    ctx.lineTo(r, r + 3 * this.dpr);
    ctx.lineTo(r - 6 * this.dpr, r + 6 * this.dpr);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // "N" on the rim, in the direction of world north (−Z).
    const north = angle - Math.PI / 2; // −Z is "up" in map space, then rotated with the map
    const nx = r + Math.cos(north) * (r - 10 * this.dpr);
    const ny = r + Math.sin(north) * (r - 10 * this.dpr);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${11 * this.dpr}px system-ui,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny);

    // Clock along the bottom.
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(r - 24 * this.dpr, s - 22 * this.dpr, 48 * this.dpr, 16 * this.dpr);
    ctx.fillStyle = '#fff';
    ctx.font = `600 ${11 * this.dpr}px ui-monospace,monospace`;
    ctx.fillText(clock, r, s - 14 * this.dpr);

    // Rim.
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2 * this.dpr;
    ctx.beginPath();
    ctx.arc(r, r, r - this.dpr, 0, Math.PI * 2);
    ctx.stroke();
  }
}
