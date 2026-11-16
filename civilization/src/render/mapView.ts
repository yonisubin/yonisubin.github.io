// PixiJS map view. Everything is drawn in code (no image assets): terrain hexes with simple
// shapes for hills, mountains and woods, rivers on hex edges, roads, improvements, resources,
// borders, fog, units and city banners.
//
// The world wraps east–west, so each layer is shown three times (shifted one world width left
// and right); static layers share one GraphicsContext between the copies, so they cost one
// geometry each. The camera's x wraps around.
import { Application, Container, Graphics, GraphicsContext, Text } from 'pixi.js';
import { D, get } from '../data';
import { cornerAngle, neighbor, tileCenter } from '../core/hex';
import { allCities, allUnits, cityAt, isCivilian, unitDef } from '../core/query';
import type { GameState } from '../core/state';
import { cityYields } from '../core/systems/yields';
import { cityMaxHp, itemCost, itemDef } from '../core/systems/cities';
import { resourceVisible, tileYields } from '../core/systems/yields';

export const HEX = 32; // hex circumradius in world pixels
const SQ3 = Math.sqrt(3);

const hexToNum = (c: string) => parseInt(c.slice(1), 16);
function shade(color: number, f: number): number {
  const r = Math.min(255, Math.max(0, Math.round(((color >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((color >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((color & 255) * f)));
  return (r << 16) | (g << 8) | b;
}

/** Corner points of a hex at (x, y). */
function hexPoints(x: number, y: number, r = HEX): number[] {
  const pts: number[] = [];
  for (let d = 0; d < 6; d++) {
    const a = cornerAngle(d);
    pts.push(x + r * Math.cos(a), y + r * Math.sin(a));
  }
  return pts;
}

/** Endpoints of the edge of a hex facing direction d. */
function edgePoints(x: number, y: number, d: number, r = HEX): [number, number, number, number] {
  const a1 = cornerAngle(d - 1), a2 = cornerAngle(d);
  return [x + r * Math.cos(a1), y + r * Math.sin(a1), x + r * Math.cos(a2), y + r * Math.sin(a2)];
}

/** Deterministic per-tile jitter in [0, 1). */
function jit(i: number, k: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 2654435761) ^ Math.imul(k + 7, 40503);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

export interface Overlay {
  selectedTile: number;
  reachable: Map<number, number>;
  attackable: number[];
  path: number[];
  pathTurns: number;
  /** City screen: show this city's work area. */
  city: number | null;
  showYields: boolean;
  hover: number;
  /** City screen: tiles that can be bought, with their price. */
  buyable: Map<number, number>;
}

export class MapView {
  app: Application;
  world = new Container();
  private copies: Container[] = [];
  private terrainCtx = new GraphicsContext();
  private bordersCtx = new GraphicsContext();
  private fogCtx = new GraphicsContext();
  private overlayCtx = new GraphicsContext();
  private dynamic: Container[] = [];
  private textLayers: Container[] = [];
  private terrainSig = '';
  private bordersSig = '';
  private fogSig = '';
  cam = { x: 0, y: 0, zoom: 1 };
  worldW = 0;
  worldH = 0;
  private s: GameState | null = null;

  constructor(app: Application) {
    this.app = app;
    app.stage.addChild(this.world);
    for (let k = 0; k < 3; k++) {
      const c = new Container();
      c.addChild(new Graphics(this.terrainCtx));
      c.addChild(new Graphics(this.bordersCtx));
      const dyn = new Container();
      this.dynamic.push(dyn);
      c.addChild(dyn);
      c.addChild(new Graphics(this.overlayCtx));
      c.addChild(new Graphics(this.fogCtx));
      const txt = new Container();
      this.textLayers.push(txt);
      c.addChild(txt);
      this.copies.push(c);
      this.world.addChild(c);
    }
  }

  setGame(s: GameState): void {
    this.s = s;
    this.worldW = s.map.w * SQ3 * HEX;
    this.worldH = (s.map.h * 1.5 + 0.5) * HEX;
    this.copies.forEach((c, k) => (c.x = (k - 1) * this.worldW));
    this.terrainSig = this.bordersSig = this.fogSig = '';
  }

  /** Redraw what changed. `viewer`: player whose fog applies (-1: see everything). */
  update(s: GameState, viewer: number, ov: Overlay, full = true): void {
    this.s = s;
    const tsig = s.map.tiles.map((t) => `${t.improvement ?? ''}${t.pillaged ? 'x' : ''}${t.road ? 'r' : ''}${t.feature ?? ''}${t.camp ? 'c' : ''}${t.ruin ? 'u' : ''}`).join('|') + (viewer >= 0 ? s.players[viewer].techs.length : 0);
    if (tsig !== this.terrainSig) {
      this.terrainSig = tsig;
      this.drawTerrain(s, viewer);
    }
    const bsig = s.map.tiles.map((t) => t.owner).join(',');
    if (bsig !== this.bordersSig) {
      this.bordersSig = bsig;
      this.drawBorders(s);
    }
    const fsig = viewer < 0 ? 'all' : s.players[viewer].explored.join('') + s.players[viewer].visible.join('');
    if (fsig !== this.fogSig) {
      this.fogSig = fsig;
      this.drawFog(s, viewer);
    }
    this.drawOverlay(s, ov);
    // Units, banners and text are rebuilt only when the game or selection changed (not on hover).
    if (full) for (let k = 0; k < 3; k++) this.drawDynamic(s, viewer, k, ov);
    this.applyCamera();
  }

  // ---- Camera ----

  applyCamera(): void {
    const { width, height } = this.app.screen;
    const c = this.cam;
    c.zoom = Math.max(0.3, Math.min(2.2, c.zoom));
    if (this.worldW) c.x = ((c.x % this.worldW) + this.worldW) % this.worldW;
    c.y = Math.max(0, Math.min(this.worldH, c.y));
    this.world.scale.set(c.zoom);
    this.world.x = width / 2 - c.x * c.zoom;
    this.world.y = height / 2 - c.y * c.zoom;
  }

  centerOn(tile: number): void {
    if (!this.s) return;
    const p = tileCenter(this.s.map, tile, HEX);
    this.cam.x = p.x;
    this.cam.y = p.y;
    this.applyCamera();
  }

  /** Screen point → tile index (or -1). */
  tileAtScreen(sx: number, sy: number): number {
    if (!this.s) return -1;
    const wx = (sx - this.world.x) / this.cam.zoom;
    const wy = (sy - this.world.y) / this.cam.zoom;
    // Undo tileCenter's offset, then pointy-top pixel → axial, cube-round.
    const x = wx - (SQ3 * HEX) / 2;
    const y = wy - HEX;
    const q = ((SQ3 / 3) * x - (1 / 3) * y) / HEX;
    const r = ((2 / 3) * y) / HEX;
    let rx = Math.round(q), rz = Math.round(r);
    const ry = Math.round(-q - r);
    const dx = Math.abs(rx - q), dy = Math.abs(ry - (-q - r)), dz = Math.abs(rz - r);
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (!(dy > dz)) rz = -rx - ry;
    const row = rz;
    if (row < 0 || row >= this.s.map.h) return -1;
    const col = rx + (row - (row & 1)) / 2;
    const w = this.s.map.w;
    return row * w + (((col % w) + w) % w);
  }

  // ---- Static layers ----

  private drawTerrain(s: GameState, viewer: number): void {
    const g = this.terrainCtx;
    g.clear();
    const m = s.map;
    for (let i = 0; i < m.tiles.length; i++) {
      const t = m.tiles[i];
      const { x, y } = tileCenter(m, i, HEX);
      const ter = get(D.terrains, t.terrain);
      let color = hexToNum(ter.color);
      if (t.feature === 'ice') color = hexToNum(get(D.features, 'ice').color);
      color = shade(color, 0.92 + jit(i, 1) * 0.12 + (ter.water ? 0 : (t.elevation - 0.5) * 0.15));
      g.poly(hexPoints(x, y, HEX + 0.6)).fill(color);
      if (ter.water && t.feature !== 'ice') {
        // A couple of wave ticks.
        for (let k = 0; k < 2; k++) {
          const wx = x + (jit(i, 10 + k) - 0.5) * HEX, wy = y + (jit(i, 20 + k) - 0.5) * HEX;
          g.moveTo(wx - 5, wy).quadraticCurveTo(wx - 2.5, wy - 3, wx, wy).quadraticCurveTo(wx + 2.5, wy - 3, wx + 5, wy).stroke({ width: 1.2, color: shade(color, 1.25), alpha: 0.6 });
        }
      }
      if (t.terrain === 'mountain') this.drawMountain(g, i, x, y);
      else if (t.hills) this.drawHills(g, i, x, y, color);
      if (t.feature && t.feature !== 'ice') this.drawFeature(g, i, x, y, t.feature);
    }
    // Rivers along edges (each edge drawn once, from the tile owning direction 0..2).
    for (let i = 0; i < m.tiles.length; i++) {
      const t = m.tiles[i];
      if (!t.river) continue;
      const { x, y } = tileCenter(m, i, HEX);
      for (let d = 0; d < 3; d++) {
        if (!(t.river & (1 << d))) continue;
        const [x1, y1, x2, y2] = edgePoints(x, y, d);
        g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: 4.5, color: 0x3a7fc0, cap: 'round' });
      }
      for (let d = 3; d < 6; d++) {
        if (!(t.river & (1 << d))) continue;
        if (neighbor(m, i, d) >= 0) continue; // drawn from the other side
        const [x1, y1, x2, y2] = edgePoints(x, y, d);
        g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: 4.5, color: 0x3a7fc0, cap: 'round' });
      }
    }
    // Roads: from centre toward neighbours with a road or a city.
    for (let i = 0; i < m.tiles.length; i++) {
      const t = m.tiles[i];
      if (!t.road) continue;
      const a = tileCenter(m, i, HEX);
      let linked = false;
      for (let d = 0; d < 6; d++) {
        const n = neighbor(m, i, d);
        if (n < 0 || !m.tiles[n].road) continue;
        linked = true;
        const ang = cornerAngle(d) + Math.PI / 6;
        const len = (SQ3 * HEX) / 2;
        g.moveTo(a.x, a.y).lineTo(a.x + Math.cos(ang) * len, a.y + Math.sin(ang) * len).stroke({ width: 3, color: 0x8a6a42, alpha: 0.9 });
      }
      if (!linked && !cityAt(s, i)) g.circle(a.x, a.y, 3).fill(0x8a6a42);
    }
    // Improvements, resources, ruins, camps.
    for (let i = 0; i < m.tiles.length; i++) {
      const t = m.tiles[i];
      const { x, y } = tileCenter(m, i, HEX);
      if (t.improvement) this.drawImprovement(g, x, y, t.improvement, t.pillaged);
      if (t.resource && resourceVisible(s, viewer, i)) {
        const r = get(D.resources, t.resource);
        const rx = x + HEX * 0.38, ry = y + HEX * 0.3, rr = HEX * 0.17;
        const col = hexToNum(r.color);
        if (r.kind === 'strategic') g.rect(rx - rr, ry - rr, rr * 2, rr * 2).fill(col).stroke({ width: 1.5, color: 0x101010 });
        else if (r.kind === 'luxury') g.poly([rx, ry - rr * 1.3, rx + rr * 1.1, ry, rx, ry + rr * 1.3, rx - rr * 1.1, ry]).fill(col).stroke({ width: 1.5, color: 0x101010 });
        else g.circle(rx, ry, rr).fill(col).stroke({ width: 1.5, color: 0x101010 });
      }
      if (t.ruin) {
        g.rect(x - 9, y - 4, 4, 12).fill(0xb9b2a0);
        g.rect(x + 5, y - 4, 4, 12).fill(0xb9b2a0);
        g.rect(x - 10, y - 8, 20, 4).fill(0xd8d0bc).stroke({ width: 1, color: 0x504a40 });
      }
      if (t.camp) {
        g.poly([x - 11, y + 8, x, y - 10, x + 11, y + 8]).fill(0x7a3b1e).stroke({ width: 1.5, color: 0x2a1408 });
        g.poly([x - 3, y + 8, x, y - 1, x + 3, y + 8]).fill(0xe8a33c);
      }
    }
  }

  private drawHills(g: GraphicsContext, i: number, x: number, y: number, color: number): void {
    for (let k = 0; k < 2; k++) {
      const hx = x + (k ? 8 : -8) + (jit(i, 30 + k) - 0.5) * 6, hy = y + (k ? 6 : -2);
      g.moveTo(hx - 11, hy).quadraticCurveTo(hx, hy - 13, hx + 11, hy).stroke({ width: 2.5, color: shade(color, 0.7) });
    }
  }

  private drawMountain(g: GraphicsContext, i: number, x: number, y: number): void {
    const peaks = [
      [-9, 8, 15],
      [6, 9, 19],
    ];
    for (const [dx, base, h] of peaks) {
      const px = x + dx + (jit(i, 40) - 0.5) * 4, py = y + base;
      g.poly([px - 12, py, px, py - h - 6, px + 12, py]).fill(0x7d756c).stroke({ width: 1.2, color: 0x4a443e });
      g.poly([px - 4, py - h + 2, px, py - h - 6, px + 4, py - h + 2]).fill(0xf2f2f2);
    }
  }

  private drawFeature(g: GraphicsContext, i: number, x: number, y: number, f: string): void {
    const col = hexToNum(get(D.features, f).color);
    if (f === 'forest') {
      for (let k = 0; k < 4; k++) {
        const tx = x + (jit(i, 50 + k) - 0.5) * HEX * 1.0, ty = y + (jit(i, 60 + k) - 0.5) * HEX * 0.8;
        g.poly([tx - 6, ty + 6, tx, ty - 9, tx + 6, ty + 6]).fill(shade(col, 0.85 + jit(i, 70 + k) * 0.3)).stroke({ width: 1, color: 0x1a2a14 });
      }
    } else if (f === 'jungle') {
      for (let k = 0; k < 5; k++) {
        const tx = x + (jit(i, 50 + k) - 0.5) * HEX * 1.1, ty = y + (jit(i, 60 + k) - 0.5) * HEX * 0.9;
        g.circle(tx, ty, 5 + jit(i, 80 + k) * 2).fill(shade(col, 0.85 + jit(i, 70 + k) * 0.35));
      }
    } else if (f === 'marsh') {
      for (let k = 0; k < 4; k++) {
        const tx = x + (jit(i, 50 + k) - 0.5) * HEX, ty = y + (jit(i, 60 + k) - 0.5) * HEX * 0.8;
        g.moveTo(tx - 6, ty).lineTo(tx + 6, ty).stroke({ width: 2, color: 0x4a7a8a });
        g.moveTo(tx, ty).lineTo(tx, ty - 6).stroke({ width: 1.5, color: 0x3d5a2a });
      }
    } else if (f === 'floodplains') {
      for (let k = 0; k < 3; k++) g.moveTo(x - 12, y - 6 + k * 6).lineTo(x + 12, y - 6 + k * 6).stroke({ width: 1.5, color: shade(col, 0.85), alpha: 0.8 });
    } else if (f === 'oasis') {
      g.ellipse(x, y + 2, 9, 6).fill(0x4f9cc0);
      g.poly([x + 6, y - 2, x + 8, y - 14, x + 10, y - 2]).fill(0x3a7a2a);
    }
  }

  private drawImprovement(g: GraphicsContext, x: number, y: number, id: string, pillaged: boolean): void {
    const col = hexToNum(get(D.improvements, id).color);
    const ix = x - HEX * 0.3, iy = y + HEX * 0.25;
    switch (id) {
      case 'farm':
        for (let k = 0; k < 3; k++) g.rect(ix - 9, iy - 7 + k * 5, 18, 3).fill(col);
        break;
      case 'mine':
        g.poly([ix - 8, iy + 6, ix, iy - 6, ix + 8, iy + 6]).fill(0x4a4038);
        g.moveTo(ix - 6, iy - 6).lineTo(ix + 6, iy + 2).stroke({ width: 2, color: 0xd0c0a0 });
        break;
      case 'pasture':
        g.rect(ix - 9, iy - 5, 18, 10).stroke({ width: 2, color: col });
        g.moveTo(ix - 3, iy - 5).lineTo(ix - 3, iy + 5).stroke({ width: 2, color: col });
        g.moveTo(ix + 3, iy - 5).lineTo(ix + 3, iy + 5).stroke({ width: 2, color: col });
        break;
      case 'plantation':
        for (let a = 0; a < 3; a++) for (let b = 0; b < 2; b++) g.circle(ix - 6 + a * 6, iy - 3 + b * 6, 2.2).fill(col);
        break;
      case 'camp':
        g.poly([ix - 8, iy + 6, ix, iy - 7, ix + 8, iy + 6]).fill(col).stroke({ width: 1, color: 0x2a1a0a });
        break;
      case 'quarry':
        g.rect(ix - 8, iy - 2, 7, 7).fill(col).stroke({ width: 1, color: 0x404040 });
        g.rect(ix + 1, iy - 6, 7, 11).fill(col).stroke({ width: 1, color: 0x404040 });
        break;
      case 'lumber_mill':
        g.rect(ix - 9, iy - 4, 18, 9).fill(col).stroke({ width: 1, color: 0x2a1a0a });
        g.circle(ix + 5, iy, 3).stroke({ width: 1.5, color: 0xe0d0b0 });
        break;
      case 'trading_post':
        g.rect(ix - 7, iy - 2, 14, 9).fill(col);
        g.poly([ix - 9, iy - 2, ix, iy - 9, ix + 9, iy - 2]).fill(0x8a3a2a);
        break;
      case 'citadel':
        g.poly([ix - 10, iy + 7, ix - 10, iy - 4, ix - 6, iy - 4, ix - 6, iy - 8, ix - 2, iy - 8, ix - 2, iy - 4, ix + 2, iy - 4, ix + 2, iy - 8, ix + 6, iy - 8, ix + 6, iy - 4, ix + 10, iy - 4, ix + 10, iy + 7]).fill(col).stroke({ width: 1.2, color: 0x202020 });
        break;
      default:
        // Great person tiles: a star in the improvement's colour.
        if (get(D.improvements, id).greatPerson) g.star(ix, iy, 5, 9, 4).fill(col).stroke({ width: 1.2, color: 0x202020 });
    }
    if (pillaged) {
      g.moveTo(ix - 8, iy - 8).lineTo(ix + 8, iy + 8).stroke({ width: 3, color: 0xd02020 });
      g.moveTo(ix + 8, iy - 8).lineTo(ix - 8, iy + 8).stroke({ width: 3, color: 0xd02020 });
    }
  }

  private drawBorders(s: GameState): void {
    const g = this.bordersCtx;
    g.clear();
    const m = s.map;
    for (let i = 0; i < m.tiles.length; i++) {
      const o = m.tiles[i].owner;
      if (o < 0) continue;
      const { x, y } = tileCenter(m, i, HEX);
      const col = hexToNum(s.players[o].color);
      g.poly(hexPoints(x, y)).fill({ color: col, alpha: 0.12 });
      for (let d = 0; d < 6; d++) {
        const n = neighbor(m, i, d);
        if (n >= 0 && m.tiles[n].owner === o) continue;
        const [x1, y1, x2, y2] = edgePoints(x, y, d, HEX - 2.5);
        g.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: 3.5, color: col, alpha: 0.95, cap: 'round' });
      }
    }
  }

  private drawFog(s: GameState, viewer: number): void {
    const g = this.fogCtx;
    g.clear();
    if (viewer < 0) return;
    const pl = s.players[viewer];
    const m = s.map;
    for (let i = 0; i < m.tiles.length; i++) {
      if (pl.visible[i]) continue;
      const { x, y } = tileCenter(m, i, HEX);
      if (!pl.explored[i]) g.poly(hexPoints(x, y, HEX + 1)).fill(0x0b0e14);
      else g.poly(hexPoints(x, y, HEX + 0.5)).fill({ color: 0x05070c, alpha: 0.42 });
    }
  }

  // ---- Per-frame layers ----

  private drawOverlay(s: GameState, ov: Overlay): void {
    const g = this.overlayCtx;
    g.clear();
    const m = s.map;
    for (const [t] of ov.reachable) {
      const { x, y } = tileCenter(m, t, HEX);
      g.poly(hexPoints(x, y, HEX - 3)).fill({ color: 0xffffff, alpha: 0.14 });
    }
    for (const t of ov.attackable) {
      const { x, y } = tileCenter(m, t, HEX);
      g.poly(hexPoints(x, y, HEX - 3)).stroke({ width: 3, color: 0xff4040, alpha: 0.9 });
    }
    if (ov.city !== null && s.cities[ov.city]) {
      const c = s.cities[ov.city];
      for (let i = 0; i < m.tiles.length; i++) {
        if (m.tiles[i].cityId !== c.id) continue;
        const { x, y } = tileCenter(m, i, HEX);
        g.poly(hexPoints(x, y, HEX - 2)).stroke({ width: 1.5, color: 0xffffff, alpha: 0.35 });
      }
      for (const i of c.worked) {
        const { x, y } = tileCenter(m, i, HEX);
        g.circle(x, y - 2, 8).fill({ color: 0xfff2c0, alpha: 0.9 }).stroke({ width: 2, color: c.locked.includes(i) ? 0xff9020 : 0x604010 });
      }
    }
    if (ov.selectedTile >= 0) {
      const { x, y } = tileCenter(m, ov.selectedTile, HEX);
      g.poly(hexPoints(x, y, HEX - 2)).stroke({ width: 3, color: 0xffffff });
    }
    if (ov.hover >= 0) {
      const { x, y } = tileCenter(m, ov.hover, HEX);
      g.poly(hexPoints(x, y, HEX - 1)).stroke({ width: 1.5, color: 0xffffff, alpha: 0.5 });
    }
    if (ov.path.length && ov.selectedTile >= 0) {
      let prev = tileCenter(m, ov.selectedTile, HEX);
      for (const t of ov.path) {
        let p = tileCenter(m, t, HEX);
        // Draw across the seam the short way.
        if (p.x - prev.x > this.worldW / 2) p = { x: p.x - this.worldW, y: p.y };
        if (prev.x - p.x > this.worldW / 2) p = { x: p.x + this.worldW, y: p.y };
        g.moveTo(prev.x, prev.y).lineTo(p.x, p.y).stroke({ width: 3, color: 0xfff0a0, alpha: 0.85 });
        prev = tileCenter(m, t, HEX);
      }
      const end = tileCenter(m, ov.path[ov.path.length - 1], HEX);
      g.circle(end.x, end.y, 6).fill(0xfff0a0);
    }
  }

  private drawDynamic(s: GameState, viewer: number, k: number, ov: Overlay): void {
    const dyn = this.dynamic[k];
    const txt = this.textLayers[k];
    for (const c of dyn.removeChildren()) c.destroy({ children: true });
    for (const c of txt.removeChildren()) c.destroy({ children: true });
    const m = s.map;
    const visible = (i: number) => viewer < 0 || s.players[viewer].visible[i] === 1;
    const explored = (i: number) => viewer < 0 || s.players[viewer].explored[i] === 1;
    const g = new Graphics();
    dyn.addChild(g);
    // Cities (shown where explored).
    for (const c of allCities(s)) {
      if (!explored(c.tile)) continue;
      const { x, y } = tileCenter(m, c.tile, HEX);
      const pl = s.players[c.owner];
      const col = hexToNum(pl.color), col2 = hexToNum(pl.color2);
      // A cluster of little houses.
      const houses = Math.min(6, 2 + Math.floor(c.pop / 2));
      for (let h = 0; h < houses; h++) {
        const a = (h / houses) * Math.PI * 2 + 0.4;
        const r = h === 0 ? 0 : 11;
        const hx = x + Math.cos(a) * r * (h ? 1 : 0), hy = y + 4 + Math.sin(a) * r * 0.6 * (h ? 1 : 0);
        g.rect(hx - 6, hy - 4, 12, 9).fill(0xe8dcc0).stroke({ width: 1, color: 0x403020 });
        g.poly([hx - 7.5, hy - 4, hx, hy - 10, hx + 7.5, hy - 4]).fill(col).stroke({ width: 1, color: 0x201810 });
      }
      // Banner.
      const name = `${c.isCapital ? '★ ' : ''}${c.name}`;
      const label = new Text({ text: name, style: { fontFamily: 'system-ui, sans-serif', fontSize: 12, fontWeight: '600', fill: col2 } });
      label.anchor.set(0.5);
      const bw = Math.max(70, label.width + 34), bh = 18;
      const bx = x - bw / 2, by = y - HEX - 6;
      const banner = new Graphics();
      banner.roundRect(bx, by, bw, bh, 5).fill({ color: col, alpha: 0.95 }).stroke({ width: 1.5, color: col2 });
      banner.circle(bx + 9, by + bh / 2, 7).fill(col2);
      txt.addChild(banner);
      const pop = new Text({ text: String(c.pop), style: { fontFamily: 'system-ui, sans-serif', fontSize: 10, fontWeight: '700', fill: col } });
      pop.anchor.set(0.5);
      pop.position.set(bx + 9, by + bh / 2);
      label.position.set(x + 6, by + bh / 2);
      txt.addChild(pop, label);
      if (viewer < 0 || c.owner === viewer) {
        const item = c.queue[0];
        const r = cityYields(s, c);
        const prod = Math.max(0.5, r.total.production);
        const sub = item ? `${itemDef(item).name} ${Math.max(1, Math.ceil((itemCost(s, c.owner, item) - c.production) / prod))}` : c.puppet ? 'puppet' : '— choose —';
        const st = new Text({ text: sub, style: { fontFamily: 'system-ui, sans-serif', fontSize: 9.5, fill: 0xffffff, stroke: { color: 0x000000, width: 3 } } });
        st.anchor.set(0.5, 0);
        st.position.set(x, by + bh + 1);
        txt.addChild(st);
      }
      const maxHp = cityMaxHp(c);
      if (c.hp < maxHp) {
        const frac = Math.max(0, Math.min(1, c.hp / maxHp));
        banner.rect(bx + 4, by + bh + (c.owner === viewer ? 13 : 2), bw - 8, 3).fill(0x300000);
        banner.rect(bx + 4, by + bh + (c.owner === viewer ? 13 : 2), (bw - 8) * frac, 3).fill(frac > 0.5 ? 0x40d040 : frac > 0.25 ? 0xe0c020 : 0xe03020);
      }
    }
    // Units (only where visible).
    const units = allUnits(s);
    const perTile = new Map<number, number>();
    for (const u of units) perTile.set(u.tile, (perTile.get(u.tile) ?? 0) + 1);
    for (const u of units) {
      if (!visible(u.tile)) continue;
      const { x, y } = tileCenter(m, u.tile, HEX);
      const pl = s.players[u.owner];
      const civ = isCivilian(u);
      // Two units on a tile (one military, one civilian) sit side by side.
      const shared = (perTile.get(u.tile) ?? 0) > 1 ? 1 : 0;
      const ux = x + (civ ? -9 : 7) * shared;
      const uy = y + (civ ? 7 : -5) * shared + (cityAt(s, u.tile) ? 6 : 0);
      const r = civ ? 9.5 : 12;
      const col = hexToNum(pl.color), col2 = hexToNum(pl.color2);
      const done = (viewer < 0 || u.owner === viewer) && u.moves <= 0;
      const alpha = done ? 0.7 : 1;
      if (civ) g.roundRect(ux - r, uy - r, r * 2, r * 2, 4).fill({ color: col, alpha }).stroke({ width: 2, color: col2 });
      else g.circle(ux, uy, r).fill({ color: col, alpha }).stroke({ width: 2, color: col2 });
      if (u.order === 'fortify') g.poly([ux + r - 4, uy - r - 2, ux + r + 4, uy - r - 2, ux + r + 4, uy - r + 4, ux + r, uy - r + 8, ux + r - 4, uy - r + 4]).fill(0xc0c8d0).stroke({ width: 1, color: 0x303030 });
      if (u.hp < D.rules.combat.maxHp) {
        const f = u.hp / D.rules.combat.maxHp;
        g.rect(ux - r, uy + r + 2, r * 2, 3).fill(0x300000);
        g.rect(ux - r, uy + r + 2, r * 2 * f, 3).fill(f > 0.5 ? 0x40d040 : f > 0.25 ? 0xe0c020 : 0xe03020);
      }
      if (u.pendingPromotions > 0 && u.owner === viewer) g.star(ux - r, uy - r, 5, 5, 2.5).fill(0xffd030);
      if (u.job && u.owner === viewer) g.circle(ux + r, uy + r, 4).fill(0xffa030);
      const glyph = new Text({ text: unitDef(u).glyph, style: { fontFamily: 'system-ui, "Segoe UI Symbol", sans-serif', fontSize: civ ? 12 : 14, fontWeight: '700', fill: col2 } });
      glyph.anchor.set(0.5);
      glyph.position.set(ux, uy);
      glyph.alpha = alpha;
      dyn.addChild(glyph);
    }
    // Yields lens.
    if (ov.showYields) {
      const lens = new Graphics();
      for (let i = 0; i < m.tiles.length; i++) {
        if (!explored(i)) continue;
        const t = m.tiles[i];
        if (get(D.terrains, t.terrain).impassable) continue;
        const { x, y } = tileCenter(m, i, HEX);
        const yy = tileYieldsForLens(s, i, viewer);
        const parts: [number, number][] = [
          [yy.food, 0x5cc85c],
          [yy.production, 0xd08a3a],
          [yy.gold, 0xf2d24a],
          [yy.science, 0x5aa0f0],
          [yy.culture, 0xc070e0],
        ];
        let px = x - 12;
        for (const [n, c] of parts) {
          for (let k2 = 0; k2 < Math.min(4, Math.floor(n)); k2++) {
            lens.circle(px, y + 12, 2.6).fill(c).stroke({ width: 0.8, color: 0x000000 });
            px += 6;
          }
        }
      }
      dyn.addChild(lens);
    }
    for (const [t, price] of ov.buyable) {
      const { x, y } = tileCenter(m, t, HEX);
      const label = new Text({ text: `${price}●`, style: { fontFamily: 'system-ui', fontSize: 11, fontWeight: '700', fill: 0xffe070, stroke: { color: 0x000000, width: 3 } } });
      label.anchor.set(0.5);
      label.position.set(x, y);
      txt.addChild(label);
    }
    if (ov.path.length && ov.pathTurns > 1) {
      const end = tileCenter(m, ov.path[ov.path.length - 1], HEX);
      const t = new Text({ text: String(ov.pathTurns), style: { fontFamily: 'system-ui', fontSize: 12, fontWeight: '700', fill: 0x202020 } });
      t.anchor.set(0.5);
      t.position.set(end.x, end.y);
      txt.addChild(t);
    }
  }
}

function tileYieldsForLens(s: GameState, i: number, viewer: number) {
  const owner = s.map.tiles[i].owner;
  return tileYields(s, i, owner >= 0 ? owner : viewer);
}
