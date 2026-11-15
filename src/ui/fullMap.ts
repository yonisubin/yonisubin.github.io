import type * as THREE from 'three';
import type { Input } from '../input/actions';
import { MAP_COLORS, ROUTE_COLOR, drawMarker, drawRoute, type MarkerKind, type WorldMap } from '../world/mapImage';
import { WORLD_HALF } from '../world/layout';

// The full-screen map: the whole world picture, which you can drag to pan and zoom with the
// mouse wheel or a pinch. North is up (unlike the minimap, which turns with the camera).
// Opened with M or by tapping/clicking the minimap; closed with M, Esc or the ✕ button.
// While it's open the game ignores input (the world keeps running).

export interface MapMarker {
  kind: MarkerKind;
  position: THREE.Vector3;
}

const MIN_SCALE_FACTOR = 0.9; // zoomed out: the world fits the screen with a little margin
const MAX_SCALE = 3; // screen px per metre at the closest zoom
const DETAIL_SCALE = 0.9; // draw sharp vector detail when zoomed in beyond this

export class FullMap {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private open_ = false;
  // View: the world point at the screen centre and the zoom (CSS px per metre).
  private cx = 0;
  private cz = 0;
  private scale = 0.5;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private needsCentre = true;
  /** The route to draw, or null; and the waypoint (set by clicking the map). */
  route: { pts: number[]; offroad: number } | null = null;
  waypoint: { x: number; z: number } | null = null;
  /** Where a press started (screen px), to tell a click from a drag. */
  private pressAt: { x: number; y: number; moved: boolean } | null = null;
  private readonly clearButton: HTMLButtonElement;

  constructor(
    private readonly map: WorldMap,
    private readonly input: Input,
    /** Called when the map opens/closes (e.g. hide "Click to play"). */
    private readonly onToggle: (open: boolean) => void,
    /** A click on the map: set the waypoint there, or (null) clear it. */
    private readonly onWaypoint: (point: { x: number; z: number } | null) => void,
  ) {
    this.root = document.createElement('div');
    this.root.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:55',
      'background:#20262c',
      'display:none',
      'touch-action:none',
      'user-select:none',
    ].join(';');
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;cursor:grab';
    this.ctx = this.canvas.getContext('2d')!;
    this.root.appendChild(this.canvas);

    // Close button, "centre on me" button and a legend.
    const button = (text: string, css: string, onClick: () => void) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.style.cssText = `position:absolute;${css};padding:8px 14px;border:0;border-radius:10px;background:rgba(0,0,0,0.6);color:#fff;font:600 16px system-ui,sans-serif;cursor:pointer`;
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
      });
      this.root.appendChild(b);
      return b;
    };
    button('✕', 'top:max(12px, env(safe-area-inset-top));right:max(12px, env(safe-area-inset-right))', () => this.close());
    button('◎ Me', 'top:max(12px, env(safe-area-inset-top));right:calc(max(12px, env(safe-area-inset-right)) + 60px)', () => {
      this.needsCentre = true;
    });
    this.clearButton = button('✕ Clear route', 'top:max(12px, env(safe-area-inset-top));right:calc(max(12px, env(safe-area-inset-right)) + 150px)', () => {
      this.onWaypoint(null);
    });
    this.clearButton.style.display = 'none';
    const tip = document.createElement('div');
    tip.style.cssText =
      'position:absolute;left:50%;transform:translateX(-50%);top:max(14px, env(safe-area-inset-top));padding:6px 12px;border-radius:10px;background:rgba(0,0,0,0.55);color:#fff;font:600 14px system-ui,sans-serif;pointer-events:none';
    tip.textContent = 'Click / tap the map to set a destination';
    this.root.appendChild(tip);
    const legend = document.createElement('div');
    legend.style.cssText =
      'position:absolute;left:max(12px, env(safe-area-inset-left));bottom:max(12px, env(safe-area-inset-bottom));padding:8px 12px;border-radius:10px;background:rgba(0,0,0,0.6);color:#fff;font:13px/1.7 system-ui,sans-serif;pointer-events:none';
    legend.innerHTML = [
      ['#ff5a3c', '▲', 'You'],
      ['#ffffff', '✚', 'Hospital'],
      ['#f2c94c', '$', 'Guns & Ammo'],
      ['#ffd60a', '!', 'Mission'],
      ['#3d8cff', '■', 'Your cars'],
      ['#ffcc33', 'H', 'Helicopter'],
      ['#ff3b5c', '●', 'Objective'],
      ['#2ec4c4', 'B', 'Boats'],
      [ROUTE_COLOR, '⚑', 'Destination'],
    ]
      .map(([c, s, t]) => `<span style="color:${c};display:inline-block;width:18px;text-align:center;font-weight:700">${s}</span> ${t}`)
      .join('<br>');
    this.root.appendChild(legend);
    document.body.appendChild(this.root);

    // Pan with one pointer, pinch-zoom with two, wheel to zoom at the cursor.
    this.canvas.addEventListener('pointerdown', (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.pressAt = this.pointers.size === 1 ? { x: e.clientX, y: e.clientY, moved: false } : null;
      this.canvas.style.cursor = 'grabbing';
      if (this.pointers.size === 2) this.pinchDist = this.pinchDistance();
    });
    this.canvas.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      if (this.pressAt && Math.hypot(e.clientX - this.pressAt.x, e.clientY - this.pressAt.y) > 6) this.pressAt.moved = true;
      if (this.pointers.size === 1) {
        this.cx -= (e.clientX - prev.x) / this.scale;
        this.cz -= (e.clientY - prev.y) / this.scale;
      }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const d = this.pinchDistance();
        if (this.pinchDist > 0) {
          const pts = [...this.pointers.values()];
          this.zoomAt((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2, d / this.pinchDist);
        }
        this.pinchDist = d;
      }
    });
    const up = (e: PointerEvent) => {
      // A click (not a drag, not a pinch): set the destination there, or clear it if you
      // clicked the one you already have.
      if (e.type === 'pointerup' && this.pressAt && !this.pressAt.moved && this.pointers.size === 1) this.pick(e.clientX, e.clientY);
      this.pressAt = null;
      this.pointers.delete(e.pointerId);
      this.pinchDist = 0;
      if (this.pointers.size === 0) this.canvas.style.cursor = 'grab';
    };
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
      },
      { passive: false },
    );
    // Keys while open (the game's input is blocked then): M or Esc closes.
    window.addEventListener('keydown', (e) => {
      if (!this.open_) return;
      if (e.code === 'KeyM' || e.code === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
  }

  /** A click at screen (sx, sy): the world point under it becomes the waypoint. */
  private pick(sx: number, sy: number): void {
    const x = this.cx + (sx - window.innerWidth / 2) / this.scale;
    const z = this.cz + (sy - window.innerHeight / 2) / this.scale;
    const w = this.waypoint;
    if (w && Math.hypot(w.x - x, w.z - z) * this.scale < 18) this.onWaypoint(null);
    else this.onWaypoint({ x, z });
  }

  get isOpen(): boolean {
    return this.open_;
  }

  toggle(): void {
    if (this.open_) this.close();
    else this.open();
  }

  open(): void {
    if (this.open_) return;
    this.open_ = true;
    this.needsCentre = true;
    this.input.setBlocked(true);
    this.input.exitPointerLock();
    this.root.style.display = '';
    this.onToggle(true);
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.root.style.display = 'none';
    this.pointers.clear();
    this.input.setBlocked(false);
    this.onToggle(false);
    this.input.requestPointerLock();
  }

  private pinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private minScale(): number {
    return (Math.min(window.innerWidth, window.innerHeight) / (WORLD_HALF * 2)) * MIN_SCALE_FACTOR;
  }

  /** Zoom by `factor`, keeping the world point under screen point (sx, sy) in place. */
  private zoomAt(sx: number, sy: number, factor: number): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    // World point under the cursor before zooming.
    const wx = this.cx + (sx - w / 2) / this.scale;
    const wz = this.cz + (sy - h / 2) / this.scale;
    this.scale = Math.min(MAX_SCALE, Math.max(this.minScale(), this.scale * factor));
    this.cx = wx - (sx - w / 2) / this.scale;
    this.cz = wz - (sy - h / 2) / this.scale;
  }

  /**
   * Call every frame. M toggles the map; while open it's redrawn with the current markers.
   * @param player  player position;  @param forward  camera view direction (for the arrow)
   */
  update(player: THREE.Vector3, forward: THREE.Vector3, markers: MapMarker[]): void {
    if (!this.open_ && this.input.consumePressed('toggleMap')) this.open();
    if (!this.open_) return;

    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    if (this.needsCentre) {
      // Centred on the player, showing about 1.5 km across the shorter side.
      this.cx = player.x;
      this.cz = player.z;
      this.scale = Math.max(this.minScale(), Math.min(w, h) / 1500);
      this.needsCentre = false;
    }
    // Keep the view over the world.
    const limit = WORLD_HALF;
    this.cx = Math.min(limit, Math.max(-limit, this.cx));
    this.cz = Math.min(limit, Math.max(-limit, this.cz));

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = MAP_COLORS.water;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // World → screen: scale, then move the view centre to the middle of the screen.
    const k = this.scale * dpr;
    ctx.setTransform(k, 0, 0, k, (w / 2) * dpr - this.cx * k, (h / 2) * dpr - this.cz * k);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.map.canvas, -this.map.half, -this.map.half, this.map.half * 2, this.map.half * 2);
    if (this.scale > DETAIL_SCALE) {
      const radius = Math.hypot(w, h) / 2 / this.scale;
      this.map.drawDetail(ctx, this.cx, this.cz, radius);
    }

    const px = 1 / this.scale; // one CSS pixel in world units
    if (this.route) drawRoute(ctx, this.route.pts, this.route.offroad, px, 4);
    this.clearButton.style.display = this.waypoint ? '' : 'none';
    for (const m of markers) {
      if (m.kind === 'traffic') continue; // too busy at this scale
      drawMarker(ctx, m.kind, m.position.x, m.position.z, px * 1.3);
    }
    // You: an arrow pointing the way the camera looks.
    const angle = Math.atan2(forward.z, forward.x);
    ctx.save();
    ctx.translate(player.x, player.z);
    ctx.rotate(angle + Math.PI / 2);
    ctx.fillStyle = '#ff5a3c';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2 * px;
    ctx.beginPath();
    ctx.moveTo(0, -11 * px);
    ctx.lineTo(8 * px, 8 * px);
    ctx.lineTo(0, 4 * px);
    ctx.lineTo(-8 * px, 8 * px);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // North marker and scale bar (screen space).
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(12, 12, 34, 34);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', 29, 30);
    const metres = [50, 100, 200, 500, 1000].find((m) => m * this.scale > 80) ?? 1000;
    const barPx = metres * this.scale;
    const bx = w - 24 - barPx;
    const by = h - 28;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(bx - 8, by - 20, barPx + 16, 30);
    ctx.fillStyle = '#fff';
    ctx.fillRect(bx, by, barPx, 3);
    ctx.font = '600 12px system-ui,sans-serif';
    ctx.fillText(metres >= 1000 ? `${metres / 1000} km` : `${metres} m`, bx + barPx / 2, by - 9);
  }
}
