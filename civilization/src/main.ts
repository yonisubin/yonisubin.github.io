// Placeholder for the second game: draws a seeded hex map so the page shows something
// while the real game is built. Replace freely.

// Anything this game saves in localStorage must use this prefix: the open-world game at the
// site root shares the same origin (yonisubin.github.io) and therefore the same storage.
export const STORAGE_PREFIX = 'civ:';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

/** Small seeded PRNG (mulberry32) so the map is the same on every load. */
function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TERRAIN = [
  { name: 'ocean', color: '#2b5d8a' },
  { name: 'coast', color: '#4a86b0' },
  { name: 'grass', color: '#6f9e4c' },
  { name: 'plains', color: '#b7a75a' },
  { name: 'forest', color: '#3f6b38' },
  { name: 'hills', color: '#8a7a5a' },
  { name: 'mountain', color: '#9a9a9a' },
];

function draw(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#10141c';
  ctx.fillRect(0, 0, w, h);

  // Pointy-top hexes: width = √3·r, rows are 1.5·r apart, odd rows shift half a hex.
  const r = 28;
  const hw = Math.sqrt(3) * r;
  const cols = Math.ceil(w / hw) + 1;
  const rows = Math.ceil(h / (1.5 * r)) + 1;
  const rand = rng(1234);
  // Blob of land: distance from the centre plus noise decides the terrain band.
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cx = col * hw + (row % 2 ? hw / 2 : 0);
      const cy = row * 1.5 * r;
      const d = Math.hypot((cx - w / 2) / (w / 2), (cy - h / 2) / (h / 2));
      const v = 1 - d + (rand() - 0.5) * 0.5;
      const t = v < 0.15 ? 0 : v < 0.25 ? 1 : 2 + Math.floor(rand() * (v > 0.6 ? 5 : 3));
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + (i * Math.PI) / 3;
        ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
      }
      ctx.closePath();
      ctx.fillStyle = TERRAIN[t].color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.stroke();
    }
  }
}

draw();
window.addEventListener('resize', draw);
