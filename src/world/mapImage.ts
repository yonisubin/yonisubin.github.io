import { BLOCK_SIZE, CELLS, LOT, ROAD_WIDTH, RURAL_ROAD_WIDTH, WORLD_HALF, cellOf, lineCoord, type CityLayout } from './layout';
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
      const g = layout.warp.inverse(x, z);
      const gx = g.x;
      const gz = g.z;
      drawRoads(c, layout, gx, gz, radius);
      drawBlocks(c, layout, gx, gz, radius);
    },
  };
}

/** Cell index range covering (centre ± radius), clamped to the grid. */
function cellRange(c: number, radius: number): [number, number] {
  if (!Number.isFinite(radius)) return [0, CELLS];
  return [Math.max(0, cellOf(c - radius) - 1), Math.min(CELLS, cellOf(c + radius) + 2)];
}

/** Trace a polygon through grid points, bent by the road warp. */
function warpedPath(ctx: CanvasRenderingContext2D, layout: CityLayout, points: [number, number][]): void {
  ctx.beginPath();
  points.forEach(([gx, gz], i) => {
    const w = layout.warp.forward(gx, gz);
    if (i === 0) ctx.moveTo(w.x, w.z);
    else ctx.lineTo(w.x, w.z);
  });
  ctx.closePath();
}

/** Points along the edge of a rectangle on the grid (centre, half sizes), `n` per side. */
function rectPoints(cx: number, cz: number, hx: number, hz: number, n: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) pts.push([cx - hx + (2 * hx * i) / n, cz - hz]);
  for (let i = 0; i < n; i++) pts.push([cx + hx, cz - hz + (2 * hz * i) / n]);
  for (let i = 0; i < n; i++) pts.push([cx + hx - (2 * hx * i) / n, cz + hz]);
  for (let i = 0; i < n; i++) pts.push([cx - hx, cz + hz - (2 * hz * i) / n]);
  return pts;
}

function drawRoads(ctx: CanvasRenderingContext2D, layout: CityLayout, x: number, z: number, radius: number): void {
  const roads = layout.roads;
  const [i0, i1] = cellRange(x, radius);
  const [k0, k1] = cellRange(z, radius);
  ctx.strokeStyle = MAP_COLORS.road;
  ctx.lineCap = 'square';
  // Each segment as a polyline through warped points, as wide as the road.
  const line = (ax: number, az: number, bx: number, bz: number, width: number) => {
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let t = 0; t <= 6; t++) {
      const w = layout.warp.forward(ax + ((bx - ax) * t) / 6, az + ((bz - az) * t) / 6);
      if (t === 0) ctx.moveTo(w.x, w.z);
      else ctx.lineTo(w.x, w.z);
    }
    ctx.stroke();
  };
  for (let k = k0; k <= k1; k++) {
    for (let i = i0; i <= i1; i++) {
      if (roads.hasH(i, k)) line(lineCoord(i), lineCoord(k), lineCoord(i + 1), lineCoord(k), roads.ruralH(i, k) ? RURAL_ROAD_WIDTH : ROAD_WIDTH);
      if (roads.hasV(i, k)) line(lineCoord(i), lineCoord(k), lineCoord(i), lineCoord(k + 1), roads.ruralV(i, k) ? RURAL_ROAD_WIDTH : ROAD_WIDTH);
    }
  }
}

function drawBlocks(ctx: CanvasRenderingContext2D, layout: CityLayout, x: number, z: number, radius: number): void {
  const [bx0, bx1] = cellRange(x, radius);
  const [bz0, bz1] = cellRange(z, radius);
  for (let bz = bz0; bz < bz1; bz++) {
    for (let bx = bx0; bx < bx1; bx++) {
      const b = layout.blockAt(bx, bz);
      if (!b) continue;
      ctx.fillStyle = MAP_COLORS.sidewalk;
      warpedPath(ctx, layout, rectPoints(b.cx, b.cz, BLOCK_SIZE / 2, BLOCK_SIZE / 2, 4));
      ctx.fill();
      if (b.lawn) {
        ctx.fillStyle = MAP_COLORS.lawn;
        warpedPath(ctx, layout, rectPoints(b.cx, b.cz, LOT / 2, LOT / 2, 4));
        ctx.fill();
      }
      if (b.helipad) {
        const w = layout.warp.forward(b.cx, b.cz);
        ctx.fillStyle = '#6a6c70';
        ctx.beginPath();
        ctx.arc(w.x, w.z, 9, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const bl of b.buildings) {
        // Taller buildings drawn darker; houses in their roof colour.
        if (bl.roof) {
          const [r, g, bb] = bl.roof.color.map(toByte);
          ctx.fillStyle = `rgb(${r},${g},${bb})`;
        } else {
          const shade = Math.max(70, 150 - bl.height * 0.6);
          ctx.fillStyle = `rgb(${shade},${shade},${shade + 6})`;
        }
        warpedPath(ctx, layout, rectPoints(bl.x, bl.z, bl.width / 2, bl.depth / 2, 1));
        ctx.fill();
      }
    }
  }
}

export type MarkerKind = 'car' | 'heli' | 'traffic' | 'shop' | 'giver' | 'objective' | 'hospital';

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
    case 'heli':
      disc(6, '#ffcc33');
      letter('H', 9);
      return;
  }
}
