// Map input: click/tap to select and order, right-click to move/attack, drag or arrow keys to
// pan, wheel or pinch to zoom, and the keyboard shortcuts.
import { canAttack } from '../core/systems/combat';
import { cityAt, isCivilian, unitsAt } from '../core/query';
import { claimableTiles, tileBuyCost } from '../core/systems/cities';
import type { MapView } from '../render/mapView';
import { act, endTurn, game, load, nextUnit, quickSave, selectCity, selectUnit, toast } from './controller';
import { set, ui } from './store';
import { tileTooltip } from './hud';

export function installInput(view: MapView, canvas: HTMLCanvasElement, tooltip: HTMLElement): void {
  const pointers = new Map<number, { x: number; y: number }>();
  let dragStart: { x: number; y: number; camX: number; camY: number } | null = null;
  let dragged = false;
  let pinch: { dist: number; zoom: number } | null = null;

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: view.cam.zoom };
    }
    dragStart = { x: e.clientX, y: e.clientY, camX: view.cam.x, camY: view.cam.y };
    dragged = false;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      view.cam.zoom = pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist);
      view.applyCamera();
      dragged = true;
      return;
    }
    if (dragStart && pointers.size === 1) {
      const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
      if (dragged || Math.hypot(dx, dy) > 6) {
        dragged = true;
        view.cam.x = dragStart.camX - dx / view.cam.zoom;
        view.cam.y = dragStart.camY - dy / view.cam.zoom;
        view.applyCamera();
        tooltip.style.display = 'none';
        set({ hover: -1 });
        return;
      }
    }
    hover(e.clientX, e.clientY);
  });
  const up = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!dragged && dragStart && pointers.size === 0) {
      const tile = view.tileAtScreen(e.clientX, e.clientY);
      if (tile >= 0) click(tile, e.button === 2);
    }
    if (pointers.size === 0) dragStart = null;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', (e) => {
    pointers.delete(e.pointerId);
    pinch = null;
    dragStart = null;
  });
  canvas.addEventListener('pointerleave', () => {
    tooltip.style.display = 'none';
    set({ hover: -1 });
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      // Zoom around the cursor: keep the world point under it fixed.
      const before = { x: (e.clientX - view.world.x) / view.cam.zoom, y: (e.clientY - view.world.y) / view.cam.zoom };
      view.cam.zoom *= Math.exp(-e.deltaY * 0.0015);
      view.applyCamera();
      const after = { x: (e.clientX - view.world.x) / view.cam.zoom, y: (e.clientY - view.world.y) / view.cam.zoom };
      view.cam.x += before.x - after.x;
      view.cam.y += before.y - after.y;
      view.applyCamera();
    },
    { passive: false },
  );

  function hover(x: number, y: number): void {
    const st = ui();
    if (!st.game || st.setup) return;
    const tile = view.tileAtScreen(x, y);
    if (tile !== st.hover) set({ hover: tile });
    if (tile < 0) {
      tooltip.style.display = 'none';
      return;
    }
    tooltip.innerHTML = tileTooltip(st.game, tile);
    tooltip.style.display = '';
    const w = tooltip.offsetWidth, h = tooltip.offsetHeight;
    tooltip.style.left = `${Math.min(window.innerWidth - w - 8, x + 16)}px`;
    tooltip.style.top = `${Math.min(window.innerHeight - h - 8, y + 16)}px`;
  }

  window.addEventListener('keydown', (e) => {
    const st = ui();
    if (!st.game || st.setup) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const s = game();
    const unit = st.selUnit !== null ? s.units[st.selUnit] : undefined;
    const own = unit && unit.owner === s.human ? unit : undefined;
    const pan = 120 / view.cam.zoom;
    const k = e.key;
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 's') {
      e.preventDefault();
      quickSave();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'l') {
      e.preventDefault();
      load('Quicksave');
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const build = (job: string) => {
      if (own && act({ type: 'build', unit: own.id, job })) nextUnit();
    };
    switch (k) {
      case 'ArrowLeft':
        view.cam.x -= pan;
        break;
      case 'ArrowRight':
        view.cam.x += pan;
        break;
      case 'ArrowUp':
        view.cam.y -= pan;
        break;
      case 'ArrowDown':
        view.cam.y += pan;
        break;
      case '+':
      case '=':
        view.cam.zoom *= 1.2;
        break;
      case '-':
        view.cam.zoom /= 1.2;
        break;
      case 'Enter':
        endTurn();
        break;
      case '.':
        if (!nextUnit()) toast('No units need orders.');
        break;
      case ' ':
        e.preventDefault();
        if (own && act({ type: 'order', unit: own.id, order: 'skip' })) nextUnit();
        break;
      case 'f':
        if (own && act({ type: 'order', unit: own.id, order: 'fortify' })) nextUnit();
        break;
      case 's':
        if (own && act({ type: 'order', unit: own.id, order: 'sleep' })) nextUnit();
        break;
      case 'e':
        if (own) (document.querySelector('[data-a="order"][data-o="explore"]') as HTMLElement | null)?.click();
        break;
      case 'b':
        if (own) act({ type: 'found', unit: own.id });
        break;
      case 'r':
        build('road');
        break;
      case 'm':
        build('mine');
        break;
      case 'i':
        build('farm');
        break;
      case 'p':
        if (own) act({ type: 'pillage', unit: own.id });
        break;
      case 't':
        set({ panel: st.panel === 'tech' ? 'none' : 'tech' });
        break;
      case 'y':
        set({ lens: !st.lens });
        break;
      case 'h': {
        const cap = Object.values(s.cities).find((c) => c.owner === s.human && c.isCapital);
        if (cap) view.centerOn(cap.tile);
        break;
      }
      case 'Escape':
        if (st.targeting) set({ targeting: null });
        else if (st.panel !== 'none') set({ panel: 'none' });
        else if (st.cityAttack) set({ cityAttack: false });
        else if (st.selCity !== null) selectCity(null);
        else selectUnit(null);
        break;
      default:
        return;
    }
    view.applyCamera();
  });

  function click(tile: number, right: boolean): void {
    const st = ui();
    if (!st.game || st.busy || st.setup) return;
    const s = st.game;
    const p = s.human;
    // City screen: ranged attack, lock tiles, buy tiles.
    if (st.selCity !== null && s.cities[st.selCity]?.owner === p) {
      const c = s.cities[st.selCity];
      if (st.cityAttack) {
        act({ type: 'cityAttack', city: c.id, to: tile });
        set({ cityAttack: false });
        return;
      }
      if (s.map.tiles[tile].cityId === c.id && tile !== c.tile && !right) {
        act({ type: 'lockTile', city: c.id, tile });
        return;
      }
      if (claimableTiles(s, c).includes(tile) && !right) {
        const cost = tileBuyCost(s, c, tile);
        if (confirm(`Buy this tile for ${cost} gold?`)) act({ type: 'buyTile', city: c.id, tile });
        return;
      }
    }
    // A unit waiting for a target (air strike, rebase, nuke, debate).
    if (st.targeting) {
      const t = st.targeting;
      const kind = t.kind === 'strike' ? 'airStrike' : t.kind === 'theological' ? 'theological' : t.kind;
      if (t.kind === 'nuke' && !confirm('Launch a nuclear weapon? Everything in the blast will be destroyed.')) {
        set({ targeting: null });
        return;
      }
      act({ type: kind, unit: t.unit, to: tile } as never);
      set({ targeting: null });
      return;
    }
    const sel = st.selUnit !== null ? s.units[st.selUnit] : undefined;
    const mine = sel && sel.owner === p ? sel : undefined;
    const ownUnits = unitsAt(s, tile).filter((u) => u.owner === p).sort((a, b) => Number(isCivilian(a)) - Number(isCivilian(b)));
    const city = cityAt(s, tile);
    if (mine && mine.tile !== tile && (right || !ownUnits.length)) {
      // Order: attack if there's something to fight there, else move.
      if (!canAttack(s, mine, tile)) act({ type: 'attack', unit: mine.id, to: tile });
      else {
        const ok = act({ type: 'move', unit: mine.id, to: tile });
        if (ok && mine.moves <= 0 && s.units[mine.id]) nextUnit();
      }
      return;
    }
    if (right) return;
    if (ownUnits.length) {
      // Clicking again on a selected unit cycles to the other unit there, then to the city.
      const idx = ownUnits.findIndex((u) => u.id === st.selUnit);
      if (idx >= 0 && idx === ownUnits.length - 1 && city && city.owner === p) selectCity(city.id);
      else selectUnit(ownUnits[(idx + 1) % ownUnits.length].id);
      return;
    }
    if (city && s.players[p].explored[tile]) {
      selectCity(city.id);
      return;
    }
    const other = unitsAt(s, tile).find(() => s.players[p].visible[tile]);
    if (other) selectUnit(other.id);
    else {
      selectUnit(null);
      selectCity(null);
    }
  }
}
