// End of game: a victory/defeat splash with original art (drawn as SVG), score table, graphs
// of every statistic over time, a replay of territory turn by turn with the event log, and the
// Hall of Fame (kept in localStorage under civ:hallOfFame).
import { D, get } from '../data';
import { tileCenter } from '../core/hex';
import { yearOf } from '../core/query';
import type { GameState, TurnStats } from '../core/state';
import { score } from '../core/systems/economy';
import { decodeOwners, finalScore } from '../core/systems/stats';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface HallEntry {
  key: string;
  date: number;
  leader: string;
  civ: string;
  won: boolean;
  kind: string;
  turn: number;
  score: number;
  difficulty: string;
  mapSize: string;
}

const HOF_KEY = 'civ:hallOfFame';

export function hallOfFame(): HallEntry[] {
  try {
    const v = JSON.parse(localStorage.getItem(HOF_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Add this finished game once (keyed by seed and turn). */
export function recordHallOfFame(s: GameState): void {
  if (!s.winner || s.human < 0) return;
  const key = `${s.settings.seed}|${s.turn}|${s.human}`;
  const list = hallOfFame();
  if (list.some((e) => e.key === key)) return;
  const p = s.players[s.human];
  list.push({
    key,
    date: Date.now(),
    leader: p.leader,
    civ: p.name,
    won: s.winner.player === s.human,
    kind: s.winner.kind,
    turn: s.turn,
    score: finalScore(s, s.human),
    difficulty: get(D.difficulty, s.settings.difficulty).name,
    mapSize: get(D.mapSizes, s.settings.mapSize).name,
  });
  list.sort((a, b) => b.score - a.score);
  try {
    localStorage.setItem(HOF_KEY, JSON.stringify(list.slice(0, 50)));
  } catch {
    /* storage unavailable */
  }
}

export function hallOfFameHtml(): string {
  const list = hallOfFame();
  if (!list.length) return '<p class="sub">No finished games yet.</p>';
  return `<table><tr><th>Score</th><th>Leader</th><th>Result</th><th>Turn</th><th>Setting</th></tr>${list
    .slice(0, 15)
    .map((e) => `<tr><td><b>${e.score}</b></td><td>${esc(e.leader)}<div class="sub">${esc(e.civ)}</div></td><td class="${e.won ? '' : 'bad'}">${e.won ? 'Won' : 'Lost'} (${esc(e.kind)})</td><td>${e.turn}</td><td class="sub">${esc(e.difficulty)}, ${esc(e.mapSize)}</td></tr>`)
    .join('')}</table>`;
}

/** Original splash art: a sun over hex hills (victory) or a broken banner (defeat), or a ship. */
function splash(kind: string, won: boolean, color: string): string {
  const hexes = Array.from({ length: 7 }, (_, i) => {
    const x = 30 + i * 52, y = 150 - (i % 2) * 14;
    const pts = Array.from({ length: 6 }, (_, k) => {
      const a = ((60 * k - 30) * Math.PI) / 180;
      return `${x + 30 * Math.cos(a)},${y + 30 * Math.sin(a)}`;
    }).join(' ');
    return `<polygon points="${pts}" fill="${won ? '#3f6b38' : '#3a3d44'}" stroke="#1b2016" stroke-width="2"/>`;
  }).join('');
  const sky = won ? '<defs><radialGradient id="sun"><stop offset="0" stop-color="#ffe9a0"/><stop offset="1" stop-color="#e0b85a" stop-opacity="0"/></radialGradient></defs><circle cx="190" cy="70" r="70" fill="url(#sun)"/><circle cx="190" cy="70" r="26" fill="#ffd56a"/>' : '<circle cx="300" cy="40" r="16" fill="#d8dde8" opacity="0.6"/>';
  const extra =
    kind === 'science'
      ? '<path d="M190 10 l12 34 h-24z M184 44 h12 v26 h-12z" fill="#e8e4d8"/><path d="M186 70 l4 18 l4 -18z" fill="#ff9a40"/>'
      : won
        ? `<line x1="190" y1="60" x2="190" y2="128" stroke="#2a2010" stroke-width="4"/><path d="M190 62 h44 l-10 12 l10 12 h-44z" fill="${color}"/>`
        : `<line x1="170" y1="128" x2="214" y2="80" stroke="#2a2010" stroke-width="4"/><path d="M214 80 l30 6 l-18 16 z" fill="${color}" opacity="0.7"/>`;
  return `<svg viewBox="0 0 380 190" class="splash">${sky}${hexes}${extra}</svg>`;
}

const STATS: { key: keyof TurnStats; name: string }[] = [
  { key: 'score', name: 'Score' },
  { key: 'pop', name: 'Population' },
  { key: 'military', name: 'Military' },
  { key: 'production', name: 'Production' },
  { key: 'gold', name: 'Gold per turn' },
  { key: 'science', name: 'Science' },
  { key: 'culture', name: 'Culture' },
  { key: 'land', name: 'Land' },
];

export function endgameHtml(s: GameState, tab: string, stat: string, replayTurn: number): string {
  const w = s.players[s.winner!.player];
  const won = s.winner!.player === s.human;
  const tabs = ['summary', 'graphs', 'replay', 'hall']
    .map((t) => `<button class="${t === tab ? 'primary' : ''}" data-a="end-tab" data-t="${t}">${{ summary: 'Summary', graphs: 'Graphs', replay: 'Replay', hall: 'Hall of Fame' }[t]}</button>`)
    .join('');
  let body = '';
  if (tab === 'summary') {
    const rows = s.players
      .filter((p) => !p.isBarbarian)
      .sort((a, b) => score(s, b.id) - score(s, a.id))
      .map((p) => `<tr><td><span class="dot" style="background:${p.color}"></span>${esc(p.name)}<div class="sub">${esc(p.leader)}</div></td><td>${score(s, p.id)}</td><td>${p.alive ? '' : 'destroyed'}</td></tr>`)
      .join('');
    body = `${splash(s.winner!.kind, won, s.players[Math.max(0, s.human)].color)}
      <p>The ${esc(w.name)} won a <b>${s.winner!.kind}</b> victory on turn ${s.turn} (${yearOf(s)}).${s.human >= 0 ? ` Your final score: <b>${finalScore(s, s.human)}</b>.` : ''}</p>
      <table><tr><th>Civilization</th><th>Score</th><th></th></tr>${rows}</table>`;
  } else if (tab === 'graphs') {
    body = `<div class="row">${STATS.map((x) => `<button class="${x.key === stat ? 'primary' : ''}" data-a="end-stat" data-t="${x.key}">${x.name}</button>`).join('')}</div>
      <canvas id="end-graph" width="900" height="380"></canvas>
      <div class="row">${s.players.filter((p) => !p.isBarbarian).map((p) => `<span><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</span>`).join('')}</div>`;
  } else if (tab === 'replay') {
    const last = s.replay.length ? s.replay[s.replay.length - 1].turn : 0;
    const events = s.events.filter((e) => e.turn <= replayTurn).slice(-8).reverse();
    body = `<div class="row"><button data-a="replay-play">▶ Play</button><input type="range" id="replay-turn" min="0" max="${last}" value="${replayTurn}"><span>Turn ${replayTurn} · ${yearOf(s, replayTurn)}</span></div>
      <canvas id="end-replay" width="900" height="420"></canvas>
      <div class="note">${events.map((e) => `Turn ${e.turn}: ${esc(e.text)}`).join('<br>') || 'Nothing yet.'}</div>`;
  } else body = hallOfFameHtml();
  return `<div class="dialog wide endgame"><div class="row head"><h2>${won ? 'Victory!' : s.human >= 0 ? 'Defeat' : 'Game over'}</h2><div class="row">${tabs}</div>
    <button data-a="end-close" title="Keep looking at the map">Close</button><button class="primary" data-a="new-game">New game</button></div><div class="end-body">${body}</div></div>`;
}

/** Draw the graph or replay canvases after the HTML is in place. */
export function drawEndgame(s: GameState, tab: string, stat: string, replayTurn: number): void {
  if (tab === 'graphs') drawGraph(s, stat as keyof TurnStats);
  if (tab === 'replay') drawReplay(s, replayTurn);
}

function drawGraph(s: GameState, key: keyof TurnStats): void {
  const cv = document.getElementById('end-graph') as HTMLCanvasElement | null;
  if (!cv) return;
  const c = cv.getContext('2d')!;
  const W = cv.width, H = cv.height, pad = 40;
  c.clearRect(0, 0, W, H);
  const players = s.players.filter((p) => !p.isBarbarian);
  let maxV = 1, minV = 0, maxT = 1;
  for (const p of players)
    for (const st of p.stats) {
      maxV = Math.max(maxV, st[key]);
      minV = Math.min(minV, st[key]);
      maxT = Math.max(maxT, st.turn);
    }
  c.strokeStyle = '#2e3647';
  c.fillStyle = '#9aa3b5';
  c.font = '12px system-ui';
  for (let k = 0; k <= 4; k++) {
    const y = H - pad - ((H - 2 * pad) * k) / 4;
    c.beginPath();
    c.moveTo(pad, y);
    c.lineTo(W - 10, y);
    c.stroke();
    c.fillText(String(Math.round(minV + ((maxV - minV) * k) / 4)), 4, y + 4);
  }
  c.fillText(`turn ${maxT}`, W - 60, H - 12);
  for (const p of players) {
    c.strokeStyle = p.color;
    c.lineWidth = p.id === s.human ? 3 : 1.8;
    c.beginPath();
    p.stats.forEach((st, i) => {
      const x = pad + ((W - pad - 10) * st.turn) / maxT;
      const y = H - pad - ((H - 2 * pad) * (st[key] - minV)) / (maxV - minV || 1);
      if (i) c.lineTo(x, y);
      else c.moveTo(x, y);
    });
    c.stroke();
  }
}

function drawReplay(s: GameState, turn: number): void {
  const cv = document.getElementById('end-replay') as HTMLCanvasElement | null;
  if (!cv) return;
  const c = cv.getContext('2d')!;
  const { w, h } = s.map;
  const snap = [...s.replay].reverse().find((r) => r.turn <= turn) ?? s.replay[0];
  if (!snap) return;
  const owners = decodeOwners(snap.owners, w * h);
  // Scale the hex map to the canvas.
  const size = Math.min(cv.width / ((w + 0.5) * Math.sqrt(3)), cv.height / (h * 1.5 + 0.5));
  c.fillStyle = '#0b0e14';
  c.fillRect(0, 0, cv.width, cv.height);
  for (let i = 0; i < w * h; i++) {
    const t = s.map.tiles[i];
    const { x, y } = tileCenter(s.map, i, size);
    const o = owners[i];
    c.fillStyle = o >= 0 && s.players[o] ? s.players[o].color : D.terrains.get(t.terrain)!.water ? '#1d3550' : '#4a5a3a';
    c.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = ((-30 - 60 * k) * Math.PI) / 180;
      const px = x + size * Math.cos(a), py = y + size * Math.sin(a);
      if (k) c.lineTo(px, py);
      else c.moveTo(px, py);
    }
    c.fill();
  }
  // Event markers up to this turn (cities founded/taken).
  c.fillStyle = '#ffffff';
  for (const e of s.events) {
    if (e.turn > turn || e.tile === undefined) continue;
    const { x, y } = tileCenter(s.map, e.tile, size);
    c.fillRect(x - 1.5, y - 1.5, 3, 3);
  }
}
