import { BLOCK_SIZE, CELLS, LOT, WORLD_HALF, cellOf, type CityLayout } from './layout';
import { ROAD_SPECS } from './streets';
import type { Rect } from './suburbs';
import { WATER_Y, type Terrain } from './terrain';
import type { CoarseGrid } from './city';

// The world drawn as a picture, for the minimap and the full-screen map.
//
// `canvas` is the whole world at PX_PER_M (≈ 2200 px square): land colours and water from
// the coarse height grid, then roads, town blocks and buildings. Drawing 4 km at 1 px/m would
// take ~70 MB of canvas memory, too much for phones, so when zoomed in the maps also draw
// sharp vector detail (`drawDetail`) for the area on screen on top of the picture.

export const PX_PER_M = 0.5;
export const MAP_HALF = WORLD_HALF + 60; // world metres from the picture's centre to its edge

export const MAP_COLORS = {
  road: '#4a4d52',
  sidewalk: '#b9b7b0',
  lawn: '#6f9150',
  water: '#2f6f9a',
};

export interface WorldMap {
  canvas: HTMLCanvasElement;
  half: number;
  /** Vector roads, blocks and buildings within `radius` m of (x, z), in world units. */
  drawDetail(ctx: CanvasRenderingContext2D, x: number, z: number, radius: number): void;
}

const toByte = (linear: number) => Math.round(255 * Math.pow(Math.min(1, Math.max(0, linear)), 1 / 2.2));

export function createWorldMap(layout: CityLayout, terrain: Terrain, coarse: CoarseGrid): WorldMap {
  const size = Math.ceil(MAP_HALF * 2 * PX_PER_M);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // 1. Land and water from the coarse grid, one pixel per sample, smoothly scaled up.
  const { n, half, step, heights } = coarse;
  const small = document.createElement('canvas');
  small.width = small.height = n;
  const sctx = small.getContext('2d')!;
  const img = sctx.createImageData(n, n);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const i = iz * n + ix;
      const x = -half + ix * step;
      const z = -half + iz * step;
      const h = heights[i];
      let c: [number, number, number];
      if (h < WATER_Y) {
        // Water: lighter in the shallows.
        const t = Math.min(1, (WATER_Y - h) / 8);
        c = [0.05 + 0.1 * (1 - t), 0.2 + 0.2 * (1 - t), 0.35 + 0.15 * (1 - t)];
      } else {
        c = terrain.colorAt(x, z, h, 0);
        if (terrain.zoneAt(x, z) === 'forest') c = [c[0] * 0.7, c[1] * 0.9, c[2] * 0.7];
        // Gentle hill shading: brighter on higher ground.
        const k = 1 + Math.min(0.5, Math.max(0, h) / 120);
        c = [c[0] * k, c[1] * k, c[2] * k];
      }
      img.data[i * 4] = toByte(c[0]);
      img.data[i * 4 + 1] = toByte(c[1]);
      img.data[i * 4 + 2] = toByte(c[2]);
      img.data[i * 4 + 3] = 255;
    }
  }
  sctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  // Map space: world metres, origin at the canvas centre.
  ctx.setTransform(PX_PER_M, 0, 0, PX_PER_M, size / 2, size / 2);
  ctx.drawImage(small, -half - step / 2, -half - step / 2, half * 2 + step, half * 2 + step);

  // 2. Roads, blocks and buildings (everywhere).
  drawRoads(ctx, layout, 0, 0, Infinity);
  drawBlocks(ctx, layout, 0, 0, Infinity);

  return {
    canvas,
    half: MAP_HALF,
    drawDetail(c, x, z, radius) {
      drawRoads(c, layout, x, z, radius);
      drawBlocks(c, layout, x, z, radius);
    },
  };
}

/** Cell index range covering (centre ± radius), clamped to the grid. */
function cellRange(c: number, radius: number): [number, number] {
  if (!Number.isFinite(radius)) return [0, CELLS];
  return [Math.max(0, cellOf(c - radius) - 1), Math.min(CELLS, cellOf(c + radius) + 2)];
}

const inRange = (px: number, pz: number, x: number, z: number, r: number) => Math.abs(px - x) < r && Math.abs(pz - z) < r;

/** A rotated rectangle (local +Z along its depth). */
function fillRect(ctx: CanvasRenderingContext2D, r: Rect): void {
  ctx.save();
  ctx.translate(r.x, r.z);
  ctx.rotate(-r.yaw);
  ctx.fillRect(-r.w / 2, -r.d / 2, r.w, r.d);
  ctx.restore();
}

function drawRoads(ctx: CanvasRenderingContext2D, layout: CityLayout, x: number, z: number, radius: number): void {
  const net = layout.streets.net;
  const reach = radius + 400;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Sidewalks first (a pale band under the asphalt), then the roads.
  for (const pass of [0, 1]) {
    ctx.strokeStyle = pass === 0 ? MAP_COLORS.sidewalk : MAP_COLORS.road;
    for (const e of net.edges) {
      const spec = ROAD_SPECS[e.cls];
      if (pass === 0 && !spec.sidewalk) continue;
      const p = e.pts;
      if (!inRange(p[0], p[1], x, z, reach)) continue;
      ctx.lineWidth = spec.width + (pass === 0 ? spec.sidewalk * 2 : 0);
      ctx.beginPath();
      for (let i = 0; i < p.length; i += 2) {
        if (i === 0) ctx.moveTo(p[i], p[i + 1]);
        else ctx.lineTo(p[i], p[i + 1]);
      }
      ctx.stroke();
    }
    ctx.fillStyle = pass === 0 ? MAP_COLORS.sidewalk : MAP_COLORS.road;
    for (const n of net.nodes) {
      if (!n.bulb || !inRange(n.x, n.z, x, z, reach)) continue;
      ctx.beginPath();
      ctx.arc(n.x, n.z, n.bulb + (pass === 0 ? 1.6 : 0), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawBlocks(ctx: CanvasRenderingContext2D, layout: CityLayout, x: number, z: number, radius: number): void {
  // Downtown blocks.
  const [bx0, bx1] = cellRange(x, radius);
  const [bz0, bz1] = cellRange(z, radius);
  for (let bz = bz0; bz < bz1; bz++) {
    for (let bx = bx0; bx < bx1; bx++) {
      const b = layout.blockAt(bx, bz);
      if (!b) continue;
      ctx.fillStyle = MAP_COLORS.sidewalk;
      ctx.fillRect(b.cx - BLOCK_SIZE / 2, b.cz - BLOCK_SIZE / 2, BLOCK_SIZE, BLOCK_SIZE);
      if (b.lawn) {
        ctx.fillStyle = MAP_COLORS.lawn;
        ctx.fillRect(b.cx - LOT / 2, b.cz - LOT / 2, LOT, LOT);
      }
      if (b.helipad) {
        ctx.fillStyle = '#6a6c70';
        ctx.beginPath();
        ctx.arc(b.cx, b.cz, 9, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const bl of b.buildings) {
        const shade = Math.max(70, 150 - bl.height * 0.6);
        ctx.fillStyle = `rgb(${shade},${shade},${shade + 6})`;
        ctx.fillRect(bl.x - bl.width / 2, bl.z - bl.depth / 2, bl.width, bl.depth);
      }
    }
  }
  // The suburbs: parcels (lots, fields, ponds, buildings), driveways and houses.
  const streets = layout.streets;
  const reach = radius + 250;
  for (const p of streets.parcels) {
    if (!inRange(p.x, p.z, x, z, reach)) continue;
    ctx.fillStyle = MAP_COLORS.lawn;
    for (const r of p.grass) fillRect(ctx, r);
    ctx.fillStyle = '#5f9a48';
    for (const r of p.fields) fillRect(ctx, r);
    ctx.fillStyle = MAP_COLORS.road;
    for (const r of p.paved) fillRect(ctx, r);
    ctx.fillStyle = MAP_COLORS.water;
    for (const o of p.ponds) {
      ctx.beginPath();
      ctx.ellipse(o.x, o.z, o.rx, o.rz, -o.yaw, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#77756f';
    for (const bl of p.buildings) fillRect(ctx, { x: bl.x, z: bl.z, yaw: bl.yaw ?? 0, w: bl.width, d: bl.depth });
    if (p.canopy) {
      ctx.fillStyle = '#e8e4dc';
      fillRect(ctx, p.canopy);
    }
  }
  ctx.fillStyle = MAP_COLORS.sidewalk;
  for (const d of streets.driveways) if (inRange(d.x, d.z, x, z, reach)) fillRect(ctx, d);
  for (const h of streets.houses) {
    if (!inRange(h.x, h.z, x, z, reach)) continue;
    const [r, g, bb] = (h.roof?.color ?? h.color).map((v) => toByte(v * 1.6));
    ctx.fillStyle = `rgb(${r},${g},${bb})`;
    fillRect(ctx, { x: h.x, z: h.z, yaw: h.yaw ?? 0, w: h.width, d: h.depth });
  }
}

export type MarkerKind = 'car' | 'heli' | 'boat' | 'traffic' | 'shop' | 'giver' | 'objective' | 'hospital' | 'waypoint';

/**
 * A map symbol at (x, z) in world units; `px` is the size of one screen pixel in world units,
 * so symbols stay the same size on screen at any zoom.
 */
export function drawMarker(ctx: CanvasRenderingContext2D, kind: MarkerKind, x: number, z: number, px: number): void {
  const disc = (r: number, fill: string) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(x, z, r * px, 0, Math.PI * 2);
    ctx.fill();
  };
  const letter = (text: string, size: number) => {
    ctx.fillStyle = '#222';
    ctx.font = `bold ${size * px}px system-ui,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, z + 0.5 * px);
  };
  switch (kind) {
    case 'objective':
      disc(5.5, '#ff3b5c');
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5 * px;
      ctx.stroke();
      return;
    case 'giver':
      disc(6, '#ffd60a');
      letter('!', 10);
      return;
    case 'hospital':
      // White disc with a red cross.
      disc(6.5, '#fff');
      ctx.fillStyle = '#d32f2f';
      ctx.fillRect(x - 4 * px, z - 1.4 * px, 8 * px, 2.8 * px);
      ctx.fillRect(x - 1.4 * px, z - 4 * px, 2.8 * px, 8 * px);
      return;
    case 'traffic':
      ctx.fillStyle = '#d9d9d2';
      ctx.fillRect(x - 2.2 * px, z - 2.2 * px, 4.4 * px, 4.4 * px);
      return;
    case 'shop':
      disc(6, '#f2c94c');
      letter('$', 9);
      return;
    case 'car':
      ctx.fillStyle = '#3d8cff';
      ctx.fillRect(x - 3.5 * px, z - 3.5 * px, 7 * px, 7 * px);
      return;
    case 'waypoint': {
      // A flag pin: a pole from the spot with a magenta pennant.
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2 * px;
      ctx.beginPath();
      ctx.moveTo(x, z);
      ctx.lineTo(x, z - 16 * px);
      ctx.stroke();
      ctx.fillStyle = ROUTE_COLOR;
      ctx.beginPath();
      ctx.moveTo(x, z - 16 * px);
      ctx.lineTo(x + 11 * px, z - 12 * px);
      ctx.lineTo(x, z - 8 * px);
      ctx.closePath();
      ctx.fill();
      disc(2.5, '#fff');
      return;
    }
    case 'boat':
      disc(5.5, '#2ec4c4');
      letter('B', 8);
      return;
    case 'heli':
      disc(6, '#ffcc33');
      letter('H', 9);
      return;
  }
}

export const ROUTE_COLOR = '#e83cf0';

/**
 * A route (x, z pairs, world units) as a bright line with a dark outline; the off-road part
 * from point `offroad` on is dashed. `px` is one screen pixel in world units.
 */
export function drawRoute(ctx: CanvasRenderingContext2D, pts: number[], offroad: number, px: number, width = 4): void {
  if (pts.length < 4) return;
  const path = (from: number, to: number) => {
    ctx.beginPath();
    ctx.moveTo(pts[from * 2], pts[from * 2 + 1]);
    for (let i = from + 1; i <= to; i++) ctx.lineTo(pts[i * 2], pts[i * 2 + 1]);
  };
  const n = pts.length / 2;
  const roadEnd = Math.min(n - 1, Math.max(0, offroad - 1));
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (roadEnd > 0) {
    path(0, roadEnd);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = (width + 2.5) * px;
    ctx.stroke();
    ctx.strokeStyle = ROUTE_COLOR;
    ctx.lineWidth = width * px;
    ctx.stroke();
  }
  if (roadEnd < n - 1) {
    path(roadEnd, n - 1);
    ctx.setLineDash([6 * px, 5 * px]);
    ctx.strokeStyle = ROUTE_COLOR;
    ctx.lineWidth = width * 0.7 * px;
    ctx.stroke();
  }
  ctx.restore();
}
