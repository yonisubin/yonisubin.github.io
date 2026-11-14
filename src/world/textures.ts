import * as THREE from 'three';
import { Rng } from './rng';

// Small tileable textures painted on a canvas at startup: no image downloads needed.
// Each repeats seamlessly, so they can be tiled across large surfaces via `repeat`.

const SIZE = 512;

function makeTexture(paint: (ctx: CanvasRenderingContext2D, rng: Rng) => void, seed: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  paint(ctx, new Rng(seed));
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Sprinkle small specks for a gritty surface. Drawn wrapped so the tile stays seamless. */
function speckle(ctx: CanvasRenderingContext2D, rng: Rng, count: number, colors: string[], maxR: number): void {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = rng.pick(colors);
    const x = rng.float() * SIZE;
    const y = rng.float() * SIZE;
    const r = rng.range(0.5, maxR);
    for (const dx of [-SIZE, 0, SIZE]) {
      for (const dy of [-SIZE, 0, SIZE]) ctx.fillRect(x + dx, y + dy, r, r);
    }
  }
}

/** Asphalt: dark grey with aggregate specks and a few darker patches. */
export function asphaltTexture(): THREE.CanvasTexture {
  return makeTexture((ctx, rng) => {
    ctx.fillStyle = '#3a3b3d';
    ctx.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < 18; i++) {
      ctx.fillStyle = `rgba(20,20,22,${rng.range(0.05, 0.15)})`;
      ctx.beginPath();
      ctx.ellipse(rng.float() * SIZE, rng.float() * SIZE, rng.range(20, 90), rng.range(10, 50), rng.float() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    speckle(ctx, rng, 9000, ['#2c2d2f', '#48494b', '#525355', '#303133'], 2.2);
  }, 1);
}

/** Concrete paving slabs: 4 × 4 slabs per tile with joints. */
export function sidewalkTexture(): THREE.CanvasTexture {
  return makeTexture((ctx, rng) => {
    ctx.fillStyle = '#a9a7a1';
    ctx.fillRect(0, 0, SIZE, SIZE);
    const n = 4;
    const s = SIZE / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const k = rng.range(-10, 10);
        ctx.fillStyle = `rgb(${168 + k},${166 + k},${160 + k})`;
        ctx.fillRect(i * s + 2, j * s + 2, s - 4, s - 4);
      }
    }
    speckle(ctx, rng, 5000, ['#9a9892', '#b5b3ad', '#8f8d88'], 1.6);
    ctx.strokeStyle = '#7d7b76';
    ctx.lineWidth = 3;
    for (let i = 0; i <= n; i++) {
      ctx.beginPath();
      ctx.moveTo(i * s, 0);
      ctx.lineTo(i * s, SIZE);
      ctx.moveTo(0, i * s);
      ctx.lineTo(SIZE, i * s);
      ctx.stroke();
    }
  }, 2);
}

/** Grass: green base with blade-like specks of varied shade. */
export function grassTexture(): THREE.CanvasTexture {
  return makeTexture((ctx, rng) => {
    ctx.fillStyle = '#4f6e32';
    ctx.fillRect(0, 0, SIZE, SIZE);
    speckle(ctx, rng, 14000, ['#5c7d3a', '#44602a', '#6a8a42', '#3e5826', '#738f4a'], 2.5);
  }, 3);
}

/** Helipad marking: concrete disc, white ring and a big "H". Transparent outside the disc. */
export function helipadTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const c = SIZE / 2;
  ctx.fillStyle = '#5b5d60';
  ctx.beginPath();
  ctx.arc(c, c, c - 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#f2f2ee';
  ctx.lineWidth = 18;
  ctx.beginPath();
  ctx.arc(c, c, c - 40, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#f2f2ee';
  const w = 40; // stroke width of the H
  const h = 230; // height of the H
  const gap = 150; // distance between the H's uprights
  ctx.fillRect(c - gap / 2 - w / 2, c - h / 2, w, h);
  ctx.fillRect(c + gap / 2 - w / 2, c - h / 2, w, h);
  ctx.fillRect(c - gap / 2, c - w / 2, gap, w);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
