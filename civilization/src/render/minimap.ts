// Minimap: a small canvas of the explored world (terrain, borders, cities) with the camera's
// view rectangle. Click or drag on it to move the camera.
import { D } from '../data';
import { allCities } from '../core/query';
import type { GameState } from '../core/state';

export class Minimap {
  canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private sig = '';

  constructor(canvas: HTMLCanvasElement, onPick: (fx: number, fy: number) => void) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    let down = false;
    const pick = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      onPick((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    };
    canvas.addEventListener('pointerdown', (e) => {
      down = true;
      canvas.setPointerCapture(e.pointerId);
      pick(e);
    });
    canvas.addEventListener('pointermove', (e) => down && pick(e));
    canvas.addEventListener('pointerup', () => (down = false));
  }

  /** view: camera rectangle as fractions of the world (x may wrap). */
  draw(s: GameState, viewer: number, view: { x: number; y: number; w: number; h: number }, rev: number): void {
    const { w, h } = s.map;
    const cw = 2 * w + 1, ch = Math.round(h * 1.5) + 1;
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    const c = this.ctx;
    const sig = `${rev}|${view.x.toFixed(3)}|${view.y.toFixed(3)}|${view.w.toFixed(3)}`;
    if (sig === this.sig) return;
    this.sig = sig;
    c.fillStyle = '#0b0e14';
    c.fillRect(0, 0, cw, ch);
    const pl = viewer >= 0 ? s.players[viewer] : null;
    for (let i = 0; i < s.map.tiles.length; i++) {
      if (pl && !pl.explored[i]) continue;
      const t = s.map.tiles[i];
      const col = i % w, row = Math.floor(i / w);
      const x = col * 2 + (row & 1), y = Math.round(row * 1.5);
      c.fillStyle = t.owner >= 0 ? s.players[t.owner].color : D.terrains.get(t.terrain)!.color;
      c.globalAlpha = pl && !pl.visible[i] ? 0.65 : 1;
      c.fillRect(x, y, 2, 2);
    }
    c.globalAlpha = 1;
    c.fillStyle = '#ffffff';
    for (const city of allCities(s)) {
      if (pl && !pl.explored[city.tile]) continue;
      const col = city.tile % w, row = Math.floor(city.tile / w);
      c.fillRect(col * 2 + (row & 1) - 1, Math.round(row * 1.5) - 1, 3, 3);
    }
    c.strokeStyle = '#ffffff';
    c.lineWidth = 1;
    for (const dx of [-1, 0, 1]) c.strokeRect((view.x + dx - view.w / 2) * cw, (view.y - view.h / 2) * ch, view.w * cw, view.h * ch);
  }
}
