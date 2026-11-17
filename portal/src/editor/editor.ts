// The puzzle maker: an in-browser gray-box chamber editor on a 0.5 m grid.
//
//   tools      Select (click, drag to move) · Brush (drag a footprint) · Paint (click a face: surface
//              tag; Shift-click: whole brush) · Entity (palette of every entity type) · Wire (click an
//              output, then an input) · Trigger / Checkpoint (drag a box) · Spawn (click)
//   keys       1–8 tools · Delete · Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) · Ctrl+D duplicate · arrows / PgUp /
//              PgDn move the selection 0.5 m (Shift: grow the box) · [ ] work plane · Esc deselect
//   camera     right-drag orbit, middle-drag pan, wheel zoom, F frame the chamber
//   file       drafts autosave to IndexedDB; export / import JSON; share link (#play=…); test-play
import type { EntityType, FaceKey, LevelData, SurfaceTag, Vec3 } from '../levels/level';
import { exportFileName, exportLevelJSON, importLevelJSON, LevelError, validateLevel } from '../levels/loader';
import { SHELL } from '../core/shellConfig';
import { LINES } from '../dialogue/lines';
import { button, download, formatDate, h } from '../ui/dom';
import { CATALOG, PALETTE_GROUPS, typesIn } from './catalog';
import { EditorDoc, blankLevel, snap, type Selection } from './doc';
import { EditorView, type Pick } from './view';
import { deleteDraft, listDrafts, loadDraft, newDraftKey, saveDraft } from './drafts';
import { shareUrl } from './share';

export type Tool = 'select' | 'brush' | 'paint' | 'entity' | 'wire' | 'trigger' | 'checkpoint' | 'spawn';
const TOOLS: [Tool, string, string][] = [
  ['select', 'Select', 'Click to select, drag to move. Arrows / PgUp / PgDn nudge, Shift grows the box.'],
  ['brush', 'Brush', 'Drag on the grid to draw a box (height set in Level info). [ and ] move the work plane.'],
  ['paint', 'Paint', 'Click a face to give it the paint tag. Shift-click sets the whole brush.'],
  ['entity', 'Entity', 'Pick a type in the palette, then click where it goes.'],
  ['wire', 'Wire', 'Click an output (button, catcher, gate...), then an input (door, platform...).'],
  ['trigger', 'Trigger', 'Drag a box: entering it fires its event (dialogue hooks can listen).'],
  ['checkpoint', 'Checkpoint', 'Drag a box: entering it moves the respawn point.'],
  ['spawn', 'Spawn', 'Click where the player starts.'],
];
const FACES: FaceKey[] = ['+y', '-y', '+x', '-x', '+z', '-z'];
const FACE_NAMES: Record<FaceKey, string> = { '+y': 'Top', '-y': 'Bottom', '+x': 'East (+x)', '-x': 'West (−x)', '+z': 'South (+z)', '-z': 'North (−z)' };
const TAGS: SurfaceTag[] = ['portalable', 'metal', 'glass'];
const deg = (r: number) => Math.round((r * 180) / Math.PI);
const rad = (d: number) => (d * Math.PI) / 180;

export interface EditorHost {
  testPlay(level: LevelData): void;
  exit(): void;
  toast(text: string): void;
}

export class Editor {
  readonly root: HTMLElement;
  readonly doc = new EditorDoc();
  readonly view: EditorView;
  tool: Tool = 'select';
  paintTag: SurfaceTag = 'metal';
  entityType: EntityType = 'cube';
  brushHeight: number = SHELL.editor.brushHeight;
  wireFrom: string | null = null;
  draftKey = newDraftKey();
  visible = false;
  private inspector: HTMLElement;
  private status: HTMLElement;
  private toolbar: HTMLElement;
  private title: HTMLElement;
  private undoBtn: HTMLButtonElement;
  private redoBtn: HTMLButtonElement;
  private draftTimer: ReturnType<typeof setTimeout> | null = null;
  private drag: { kind: 'move'; planeY: number; last: [number, number]; commit: () => void } | { kind: 'box'; start: [number, number] } | null = null;
  private modalEl: HTMLElement | null = null;
  /** Last draft write (tests wait for it). */
  lastDraftSave: Promise<unknown> = Promise.resolve();

  constructor(private readonly host: EditorHost) {
    this.root = h('div', { id: 'editor' });
    document.body.appendChild(this.root);
    this.title = h('span', { class: 'edTitle' });
    this.undoBtn = button('↶ Undo', 'undo', () => this.doc.undo(), { title: 'Ctrl+Z' });
    this.redoBtn = button('↷ Redo', 'redo', () => this.doc.redo(), { title: 'Ctrl+Y' });
    const top = h(
      'div',
      { class: 'edTop' },
      this.title,
      button('New', 'new', () => this.confirmNew()),
      button('Drafts', 'drafts', () => void this.showDrafts()),
      button('Save draft', 'saveDraft', () => void this.saveDraftNow(true)),
      button('Import', 'import', () => this.showImport()),
      button('Export', 'export', () => this.exportFile()),
      button('Share link', 'share', () => void this.showShare()),
      this.undoBtn,
      this.redoBtn,
      button('▶ Test play', 'testPlay', () => this.testPlay(), { class: 'primary' }),
      button('Exit', 'exitEditor', () => this.host.exit()),
    );
    this.toolbar = h('div', { class: 'edTools' });
    const viewport = h('div', { class: 'edViewport' });
    this.inspector = h('div', { class: 'edInspector' });
    this.status = h('div', { class: 'edStatus' });
    this.root.append(top, this.toolbar, viewport, this.inspector, this.status);
    this.view = new EditorView(viewport);
    this.doc.onChange = () => this.refresh();
    this.bindPointer();
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.root.style.display = 'none';
    this.buildToolbar();
  }

  get level(): LevelData {
    return this.doc.level;
  }

  // --- Show / hide ---------------------------------------------------------------------------

  show(level?: LevelData): void {
    if (level) {
      this.doc.load(level);
      this.draftKey = newDraftKey();
      this.view.frame(this.doc.level);
    }
    this.visible = true;
    this.root.style.display = 'grid';
    this.view.start();
    this.refresh();
    if (level) this.view.frame(this.doc.level);
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = 'none';
    this.view.stop();
    this.closeModal();
  }

  // --- Refresh -------------------------------------------------------------------------------

  private refresh(): void {
    this.title.textContent = `${this.doc.level.name}${this.doc.dirty ? ' •' : ''}`;
    this.undoBtn.disabled = !this.doc.canUndo;
    this.redoBtn.disabled = !this.doc.canRedo;
    this.view.rebuild(this.doc.level, this.doc.selection, this.wireFrom);
    this.renderInspector();
    this.renderStatus();
    if (this.doc.dirty) this.scheduleDraft();
  }

  private scheduleDraft(): void {
    if (this.draftTimer) clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => void this.saveDraftNow(false), SHELL.editor.draftDelay);
  }

  async saveDraftNow(announce: boolean): Promise<void> {
    if (this.draftTimer) clearTimeout(this.draftTimer);
    this.draftTimer = null;
    this.lastDraftSave = saveDraft(this.draftKey, this.doc.level).catch(() => undefined);
    await this.lastDraftSave;
    if (announce) this.host.toast('Draft saved');
  }

  private renderStatus(): void {
    const r = validateLevel(this.doc.level);
    const tip = TOOLS.find((t) => t[0] === this.tool)![2];
    this.status.innerHTML = '';
    const v = h('span', { class: r.errors.length ? 'bad' : r.warnings.length ? 'warn' : 'good', 'data-validation': r.errors.length ? 'errors' : 'ok' });
    v.textContent = r.errors.length ? `✗ ${r.errors[0]}${r.errors.length > 1 ? ` (+${r.errors.length - 1})` : ''}` : r.warnings.length ? `⚠ ${r.warnings[0]}` : '✓ Ready to play';
    this.status.append(v, h('span', { class: 'tip' }, this.wireFrom ? `Wiring from ${this.wireFrom}: click the input.` : tip));
  }

  // --- Toolbar -------------------------------------------------------------------------------

  private buildToolbar(): void {
    this.toolbar.innerHTML = '';
    TOOLS.forEach(([t, label], i) => {
      const b = button(`${i + 1} ${label}`, `tool-${t}`, () => this.setTool(t), { title: TOOLS[i][2] });
      b.classList.toggle('on', this.tool === t);
      this.toolbar.append(b);
    });
    const cut = h('input', { type: 'checkbox', 'data-id': 'hideCeilings' });
    cut.checked = this.view.hideCeilings;
    cut.addEventListener('change', () => {
      this.view.hideCeilings = cut.checked;
      this.refresh();
    });
    this.toolbar.append(h('label', { class: 'sub' }, cut, ' Hide ceilings'));
    if (this.tool === 'paint') {
      const sel = h('select', { 'data-id': 'paintTag' });
      for (const t of TAGS) sel.append(h('option', { value: t }, t));
      sel.value = this.paintTag;
      sel.addEventListener('change', () => (this.paintTag = sel.value as SurfaceTag));
      this.toolbar.append(h('label', { class: 'sub' }, 'Paint tag', sel));
    }
    if (this.tool === 'entity') {
      const pal = h('div', { class: 'palette' });
      for (const g of PALETTE_GROUPS) {
        pal.append(h('div', { class: 'group' }, g));
        for (const t of typesIn(g)) {
          const b = button(CATALOG[t].label, `palette-${t}`, () => {
            this.entityType = t;
            this.buildToolbar();
          });
          b.classList.toggle('on', this.entityType === t);
          b.prepend(h('i', { style: `background:#${CATALOG[t].color.toString(16).padStart(6, '0')}` }));
          pal.append(b);
        }
      }
      this.toolbar.append(pal);
    }
  }

  setTool(t: Tool): void {
    this.tool = t;
    this.wireFrom = null;
    this.buildToolbar();
    this.refresh();
  }

  // --- Pointer -------------------------------------------------------------------------------

  private bindPointer(): void {
    const c = this.view.canvas;
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      c.setPointerCapture(e.pointerId);
      this.pointerDown(e);
    });
    c.addEventListener('pointermove', (e) => this.pointerMove(e));
    c.addEventListener('pointerup', (e) => {
      if (e.button === 0) this.pointerUp(e);
    });
  }

  private pickSelection(p: Pick): Selection {
    if (p.kind === 'brush') return { kind: 'brush', index: p.index! };
    if (p.kind === 'entity') return { kind: 'entity', id: p.id! };
    if (p.kind === 'trigger') return { kind: 'trigger', id: p.id! };
    if (p.kind === 'checkpoint') return { kind: 'checkpoint', id: p.id! };
    if (p.kind === 'spawn') return { kind: 'spawn' };
    return null;
  }

  private pointerDown(e: PointerEvent): void {
    const v = this.view;
    switch (this.tool) {
      case 'select': {
        const p = v.pick(e, ['entity', 'spawn', 'trigger', 'checkpoint', 'brush']);
        const sel = p ? this.pickSelection(p) : null;
        this.doc.select(sel);
        if (sel && p) {
          const planeY = p.point.y;
          this.drag = { kind: 'move', planeY, last: [snap(p.point.x), snap(p.point.z)], commit: this.doc.beginGesture() };
        }
        break;
      }
      case 'brush':
      case 'trigger':
      case 'checkpoint': {
        const pt = v.planePoint(e, v.workY);
        if (pt) this.drag = { kind: 'box', start: [snap(pt.x), snap(pt.z)] };
        break;
      }
      case 'paint': {
        const p = v.pick(e, ['brush']);
        if (p?.kind === 'brush') {
          this.doc.setFaceTag(p.index!, e.shiftKey ? null : (p.face ?? null), this.paintTag);
          this.doc.select({ kind: 'brush', index: p.index! });
        }
        break;
      }
      case 'entity': {
        const p = v.pick(e, ['brush', 'ground']);
        if (p) this.doc.addEntity(this.entityType, [p.point.x, p.normal && p.normal.y < 0.5 && p.kind === 'brush' ? v.workY : p.point.y, p.point.z]);
        break;
      }
      case 'wire': {
        const p = v.pick(e, ['entity']);
        if (p?.kind === 'entity') this.wireClick(p.id!);
        break;
      }
      case 'spawn': {
        const p = v.pick(e, ['brush', 'ground']);
        if (p) this.doc.setSpawn([p.point.x, p.point.y, p.point.z]);
        break;
      }
    }
  }

  /** Wire tool: first click picks the output end, second the input end. */
  wireClick(id: string): void {
    const ent = this.doc.level.entities?.find((x) => x.id === id);
    if (!ent) return;
    if (!this.wireFrom) {
      if (!CATALOG[ent.type].outputs.length) return this.host.toast(`${CATALOG[ent.type].label} has no outputs`);
      this.wireFrom = id;
      this.refresh();
      return;
    }
    const from = this.wireFrom;
    this.wireFrom = null;
    if (!CATALOG[ent.type].inputs.length) {
      this.refresh();
      return this.host.toast(`${CATALOG[ent.type].label} has no inputs`);
    }
    if (!this.doc.addWire(from, id)) this.refresh();
  }

  private pointerMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    const v = this.view;
    if (d.kind === 'move') {
      const pt = v.planePoint(e, d.planeY);
      if (!pt) return;
      const cur: [number, number] = [snap(pt.x), snap(pt.z)];
      const dx = cur[0] - d.last[0], dz = cur[1] - d.last[1];
      if (dx || dz) {
        this.doc.applyMove(this.doc.level, this.doc.selection, [dx, 0, dz]);
        d.last = cur;
        this.view.rebuild(this.doc.level, this.doc.selection, this.wireFrom);
      }
    } else {
      const pt = v.planePoint(e, v.workY);
      if (!pt) return;
      const [min, max] = this.boxFrom(d.start, [snap(pt.x), snap(pt.z)]);
      v.showGhost(min, max);
    }
  }

  private boxFrom(a: [number, number], b: [number, number]): [Vec3, Vec3] {
    const y0 = this.view.workY;
    const hgt = this.tool === 'brush' ? this.brushHeight : 2.5;
    return [
      [Math.min(a[0], b[0]), y0, Math.min(a[1], b[1])],
      [Math.max(a[0], b[0]), y0 + hgt, Math.max(a[1], b[1])],
    ];
  }

  private pointerUp(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    this.view.showGhost(null);
    if (!d) return;
    if (d.kind === 'move') return d.commit();
    const pt = this.view.planePoint(e, this.view.workY);
    if (!pt) return;
    const [min, max] = this.boxFrom(d.start, [snap(pt.x), snap(pt.z)]);
    if (max[0] - min[0] < SHELL.editor.grid || max[2] - min[2] < SHELL.editor.grid) return this.host.toast('Drag on the grid to draw a box');
    if (this.tool === 'brush') this.doc.addBrush(min, max, 'portalable');
    else if (this.tool === 'trigger') this.doc.addTrigger(min, max, 'trigger');
    else this.doc.addCheckpoint(min, max);
  }

  // --- Keys ----------------------------------------------------------------------------------

  private onKey(e: KeyboardEvent): void {
    if (!this.visible || this.modalEl) {
      if (this.visible && e.key === 'Escape') this.closeModal();
      return;
    }
    const t = e.target as HTMLElement;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
    const g = SHELL.editor.grid;
    const ctrl = e.ctrlKey || e.metaKey;
    let handled = true;
    if (ctrl && e.key.toLowerCase() === 'z') e.shiftKey ? this.doc.redo() : this.doc.undo();
    else if (ctrl && e.key.toLowerCase() === 'y') this.doc.redo();
    else if (ctrl && e.key.toLowerCase() === 'd') this.doc.duplicateSelection();
    else if (ctrl && e.key.toLowerCase() === 's') void this.saveDraftNow(true);
    else if (e.key === 'Delete' || e.key === 'Backspace') this.doc.deleteSelection();
    else if (e.key === 'Escape') {
      this.wireFrom = null;
      this.doc.select(null);
    } else if (/^[1-8]$/.test(e.key) && !ctrl) this.setTool(TOOLS[Number(e.key) - 1][0]);
    else if (e.key === 'f' || e.key === 'F') this.view.frame(this.doc.level);
    else if (e.key === '[' || e.key === ']') {
      this.view.setWorkY(this.view.workY + (e.key === ']' ? g : -g));
      this.renderInspector();
    } else {
      const dirs: Record<string, Vec3> = { ArrowLeft: [-g, 0, 0], ArrowRight: [g, 0, 0], ArrowUp: [0, 0, -g], ArrowDown: [0, 0, g], PageUp: [0, g, 0], PageDown: [0, -g, 0] };
      const d = dirs[e.key];
      if (d && this.doc.selection) e.shiftKey ? this.doc.resizeSelection(d) : this.doc.moveSelection(d);
      else handled = false;
    }
    if (handled) e.preventDefault();
  }

  // --- Inspector -----------------------------------------------------------------------------

  private num(label: string, value: number, onChange: (v: number) => void, step: number = SHELL.editor.grid, id = ''): HTMLElement {
    const inp = h('input', { type: 'number', step, value: String(Math.round(value * 1000) / 1000), 'data-field': id || label });
    inp.addEventListener('change', () => {
      const n = Number(inp.value);
      if (Number.isFinite(n)) onChange(n);
    });
    return h('label', { class: 'field' }, h('span', {}, label), inp);
  }

  private vec(label: string, v: Vec3, onChange: (v: Vec3) => void, id: string): HTMLElement {
    const row = h('div', { class: 'vec' }, h('span', {}, label));
    (['x', 'y', 'z'] as const).forEach((axis, k) => {
      const inp = h('input', { type: 'number', step: SHELL.editor.grid, value: String(v[k]), 'data-field': `${id}.${axis}` });
      inp.addEventListener('change', () => {
        const n = Number(inp.value);
        if (!Number.isFinite(n)) return;
        const out: Vec3 = [...v];
        out[k] = n;
        onChange(out);
      });
      row.append(inp);
    });
    return row;
  }

  private text(label: string, value: string, onChange: (v: string) => void, id: string, list?: string): HTMLElement {
    const inp = h('input', { type: 'text', value, 'data-field': id, list });
    inp.addEventListener('change', () => onChange(inp.value.trim()));
    return h('label', { class: 'field' }, h('span', {}, label), inp);
  }

  private tagSelect(value: SurfaceTag, onChange: (t: SurfaceTag) => void, id: string): HTMLSelectElement {
    const s = h('select', { 'data-field': id });
    for (const t of TAGS) s.append(h('option', { value: t }, t));
    s.value = value;
    s.addEventListener('change', () => onChange(s.value as SurfaceTag));
    return s;
  }

  private renderInspector(): void {
    const box = this.inspector;
    box.innerHTML = '';
    const sel = this.doc.selection;
    const l = this.doc.level;
    if (sel?.kind === 'brush' && l.brushes[sel.index]) {
      const i = sel.index;
      const b = l.brushes[i];
      box.append(
        h('h3', {}, `Brush ${i + 1}`),
        this.vec('Min', b.min, (v) => this.doc.updateBrush(i, { min: v }), 'min'),
        this.vec('Max', b.max, (v) => this.doc.updateBrush(i, { max: v }), 'max'),
        h('label', { class: 'field' }, h('span', {}, 'All faces'), this.tagSelect(b.tag, (t) => this.doc.setFaceTag(i, null, t), 'tag')),
      );
      for (const f of FACES) box.append(h('label', { class: 'field face' }, h('span', {}, FACE_NAMES[f]), this.tagSelect(b.faces?.[f] ?? b.tag, (t) => this.doc.setFaceTag(i, f, t), `face${f}`)));
      const theme = h('select', { 'data-field': 'theme' }, h('option', { value: '' }, 'chamber default'), h('option', { value: 'clean' }, 'clean'), h('option', { value: 'industrial' }, 'industrial'));
      theme.value = b.theme ?? '';
      theme.addEventListener('change', () => this.doc.change((lv) => {
        const bb = lv.brushes[i];
        if (theme.value) bb.theme = theme.value as 'clean' | 'industrial';
        else delete bb.theme;
      }));
      box.append(h('label', { class: 'field' }, h('span', {}, 'Theme'), theme), this.selButtons());
    } else if (sel?.kind === 'entity') {
      const e = l.entities?.find((x) => x.id === sel.id);
      if (!e) return;
      const info = CATALOG[e.type];
      const props = h('textarea', { rows: 6, 'data-field': 'props', spellcheck: 'false' });
      props.value = JSON.stringify(e.props ?? {}, null, 1);
      const err = h('div', { class: 'err' });
      props.addEventListener('change', () => {
        try {
          const v = JSON.parse(props.value || '{}');
          if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('props must be an object');
          this.doc.updateEntity(e.id, { props: v as Record<string, unknown> });
        } catch (x) {
          err.textContent = (x as Error).message;
        }
      });
      box.append(
        h('h3', {}, info.label),
        this.text('Id', e.id, (v) => /^[\w-]+$/.test(v) ? this.doc.updateEntity(e.id, { id: v }) : this.host.toast('Ids use letters, digits, _ and -'), 'id'),
        this.vec('Position', e.position, (v) => this.doc.updateEntity(e.id, { position: v }), 'position'),
        this.num('Yaw (°)', deg(e.yaw ?? 0), (v) => this.doc.updateEntity(e.id, { yaw: rad(v) }), 15, 'yaw'),
        h('label', { class: 'field col' }, h('span', {}, 'Properties (JSON)'), props),
        err,
        h('div', { class: 'ports' }, `outputs: ${info.outputs.join(', ') || '—'} · inputs: ${info.inputs.join(', ') || '—'}`),
        this.wireList(e.id),
        this.selButtons(),
      );
    } else if (sel?.kind === 'trigger') {
      const t = l.triggers?.find((x) => x.id === sel.id);
      if (!t) return;
      const once = h('input', { type: 'checkbox', 'data-field': 'once' });
      once.checked = !!t.once;
      once.addEventListener('change', () => this.doc.updateTrigger(t.id, { once: once.checked }));
      box.append(
        h('h3', {}, `Trigger ${t.id}`),
        this.text('Event', t.event, (v) => v && this.doc.updateTrigger(t.id, { event: v }), 'event'),
        h('label', { class: 'field' }, h('span', {}, 'Only once'), once),
        this.vec('Min', t.min, (v) => this.doc.updateTrigger(t.id, { min: v }), 'min'),
        this.vec('Max', t.max, (v) => this.doc.updateTrigger(t.id, { max: v }), 'max'),
        h('p', { class: 'note' }, 'Add a dialogue hook with this event name (Level info) to make the overseer speak here.'),
        this.selButtons(),
      );
    } else if (sel?.kind === 'checkpoint') {
      const c = l.checkpoints?.find((x) => x.id === sel.id);
      if (!c) return;
      box.append(
        h('h3', {}, `Checkpoint ${c.id}`),
        this.vec('Min', c.min, (v) => this.doc.updateCheckpoint(c.id, { min: v }), 'min'),
        this.vec('Max', c.max, (v) => this.doc.updateCheckpoint(c.id, { max: v }), 'max'),
        this.vec('Respawn at', c.spawn.position, (v) => this.doc.updateCheckpoint(c.id, { spawn: { position: v, yaw: c.spawn.yaw } }), 'spawn'),
        this.num('Respawn yaw (°)', deg(c.spawn.yaw), (v) => this.doc.updateCheckpoint(c.id, { spawn: { position: c.spawn.position, yaw: rad(v) } }), 15, 'spawnYaw'),
        this.selButtons(),
      );
    } else {
      this.renderLevelInfo(box);
    }
  }

  private selButtons(): HTMLElement {
    return h('div', { class: 'row' }, button('Duplicate', 'duplicate', () => this.doc.duplicateSelection()), button('Delete', 'delete', () => this.doc.deleteSelection()));
  }

  private wireList(onlyId?: string): HTMLElement {
    const wrap = h('div', { class: 'wires' }, h('h4', {}, 'Wires'));
    const ws = this.doc.level.wiring ?? [];
    let n = 0;
    ws.forEach((w, i) => {
      if (onlyId && w.from.split('.')[0] !== onlyId && w.to.split('.')[0] !== onlyId) return;
      n++;
      wrap.append(h('div', { class: 'wire' }, h('span', {}, `${w.from} → ${w.to}`), button('✕', `unwire-${i}`, () => this.doc.removeWire(i), { title: 'Remove wire' })));
    });
    if (!n) wrap.append(h('div', { class: 'note' }, 'No wires. Use the Wire tool (5).'));
    return wrap;
  }

  private renderLevelInfo(box: HTMLElement): void {
    const l = this.doc.level;
    const device = h('select', { 'data-field': 'device' }, h('option', { value: 'both' }, 'both ends'), h('option', { value: 'a' }, 'blue only'), h('option', { value: 'none' }, 'no device'));
    device.value = l.device ?? 'both';
    device.addEventListener('change', () => this.doc.setInfo({ device: device.value === 'both' ? undefined : (device.value as 'a' | 'none') }));
    const info = l.info ?? {};
    const listId = 'edLineIds';
    const datalist = h('datalist', { id: listId });
    for (const id of Object.keys(LINES)) datalist.append(h('option', { value: id }));
    box.append(
      h('h3', {}, 'Level info'),
      this.text('Name', l.name, (v) => this.doc.setInfo({ name: v }), 'name'),
      this.text('Id', l.id ?? '', (v) => this.doc.setInfo({ id: v.replace(/[^\w.-]/g, '-') || undefined }), 'levelId'),
      h('label', { class: 'field' }, h('span', {}, 'Device'), device),
      this.num('Chamber no.', info.number ?? 0, (v) => this.doc.setInfo({ info: { ...info, number: v || undefined } }), 1, 'number'),
      this.text('Sign title', info.title ?? '', (v) => this.doc.setInfo({ info: { ...info, title: v || undefined } }), 'signTitle'),
      this.text('Sign icons', (info.icons ?? []).join(', '), (v) => this.doc.setInfo({ info: { ...info, icons: v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined } }), 'icons'),
      this.text('Next chamber id', l.next ?? '', (v) => this.doc.setInfo({ next: v || undefined }), 'next'),
      this.vec('Spawn', l.spawn.position, (v) => this.doc.setSpawn(v), 'spawn'),
      this.num('Spawn yaw (°)', deg(l.spawn.yaw), (v) => this.doc.setSpawn(l.spawn.position, rad(v)), 15, 'spawnYaw'),
      this.num('Work plane y', this.view.workY, (v) => {
        this.view.setWorkY(snap(v));
        this.renderInspector();
      }, SHELL.editor.grid, 'workY'),
      this.num('New brush height', this.brushHeight, (v) => (this.brushHeight = Math.max(SHELL.editor.grid, snap(v))), SHELL.editor.grid, 'brushHeight'),
    );
    // Dialogue hooks: event → line ids.
    const hooks = h('div', { class: 'hooks' }, h('h4', {}, 'Dialogue hooks'), datalist);
    (l.dialogue ?? []).forEach((d, i) => {
      const ev = h('input', { type: 'text', value: d.event, 'data-field': `hook${i}.event`, placeholder: 'chamberStart / trigger event' });
      const lines = h('input', { type: 'text', value: d.lines.join(', '), 'data-field': `hook${i}.lines`, list: listId, placeholder: 'line ids' });
      const save = () => {
        const all = (this.doc.level.dialogue ?? []).map((x) => ({ ...x }));
        all[i] = { event: ev.value.trim(), lines: lines.value.split(',').map((s) => s.trim()).filter(Boolean) };
        this.doc.setInfo({ dialogue: all.filter((x) => x.event && x.lines.length) });
      };
      ev.addEventListener('change', save);
      lines.addEventListener('change', save);
      hooks.append(h('div', { class: 'hook' }, ev, lines, button('✕', `unhook-${i}`, () => this.doc.setInfo({ dialogue: (this.doc.level.dialogue ?? []).filter((_, j) => j !== i) }))));
    });
    hooks.append(
      button('+ Hook', 'addHook', () => this.doc.setInfo({ dialogue: [...(this.doc.level.dialogue ?? []), { event: 'chamberStart', lines: ['chamberStart.helpful.1'] }] })),
    );
    box.append(hooks, this.wireList());
  }

  // --- File operations -----------------------------------------------------------------------

  exportJSON(): string {
    return exportLevelJSON(this.doc.level);
  }

  private exportFile(): void {
    try {
      download(exportFileName(this.doc.level), this.exportJSON());
    } catch (e) {
      this.showErrors(e);
    }
  }

  /** Load a level from JSON text. Returns the problems (empty when it worked). */
  importJSON(text: string): string[] {
    try {
      const level = importLevelJSON(text);
      this.doc.load(level);
      this.draftKey = newDraftKey();
      this.view.frame(level);
      return [];
    } catch (e) {
      return e instanceof LevelError ? e.errors : [String(e)];
    }
  }

  /** Validate, then hand the level to the game (Esc comes back here). */
  testPlay(): boolean {
    const r = validateLevel(this.doc.level);
    if (!r.level) {
      this.showErrors(new LevelError(r.errors));
      return false;
    }
    void this.saveDraftNow(false);
    this.host.testPlay(r.level);
    return true;
  }

  async shareLink(): Promise<string> {
    return shareUrl(this.doc.level);
  }

  private confirmNew(): void {
    const body = h('div', {}, h('p', {}, 'Start a new chamber? The current one stays in your drafts.'));
    body.append(
      button('New chamber', 'confirmNew', async () => {
        await this.saveDraftNow(false);
        this.doc.load(blankLevel());
        this.draftKey = newDraftKey();
        this.view.frame(this.doc.level);
        this.closeModal();
      }, { class: 'primary' }),
    );
    this.modal('New chamber', body);
  }

  private async showDrafts(): Promise<void> {
    const drafts = await listDrafts().catch(() => []);
    const body = h('div', { class: 'draftList' });
    if (!drafts.length) body.append(h('p', {}, 'No drafts yet.'));
    for (const d of drafts) {
      body.append(
        h(
          'div',
          { class: 'draft' },
          h('span', {}, `${d.name}`, h('small', {}, ` ${formatDate(d.updated)}`)),
          button('Open', `openDraft-${d.key}`, async () => {
            const full = await loadDraft(d.key);
            if (!full) return;
            this.doc.load(full.level);
            this.draftKey = full.key;
            this.view.frame(full.level);
            this.closeModal();
          }),
          button('Delete', `deleteDraft-${d.key}`, async () => {
            await deleteDraft(d.key);
            void this.showDrafts();
          }),
        ),
      );
    }
    this.modal('Drafts', body);
  }

  private showImport(): void {
    const ta = h('textarea', { rows: 10, 'data-field': 'importText', placeholder: 'Paste chamber JSON here', spellcheck: 'false' });
    const file = h('input', { type: 'file', accept: '.json,application/json' });
    const errs = h('pre', { class: 'error' });
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (f) ta.value = await f.text();
    });
    const body = h(
      'div',
      { class: 'import' },
      file,
      ta,
      errs,
      button('Import', 'doImport', () => {
        const problems = this.importJSON(ta.value);
        if (problems.length) errs.textContent = problems.join('\n');
        else this.closeModal();
      }, { class: 'primary' }),
    );
    this.modal('Import chamber', body);
  }

  private async showShare(): Promise<void> {
    let url: string;
    try {
      url = await this.shareLink();
    } catch (e) {
      return this.showErrors(e);
    }
    const inp = h('input', { type: 'text', value: url, readonly: true, 'data-field': 'shareUrl' });
    const body = h(
      'div',
      { class: 'share' },
      h('p', {}, 'Anyone opening this link plays your chamber. The whole chamber is inside the link.'),
      inp,
      button('Copy', 'copyShare', () => {
        inp.select();
        void navigator.clipboard?.writeText(url).then(() => this.host.toast('Link copied'), () => undefined);
      }, { class: 'primary' }),
      h('small', {}, `${url.length} characters`),
    );
    this.modal('Share link', body);
  }

  private showErrors(e: unknown): void {
    const list = e instanceof LevelError ? e.errors : [String(e)];
    this.modal('This chamber has problems', h('ul', { class: 'errors' }, ...list.map((x) => h('li', {}, x))));
  }

  private modal(title: string, body: HTMLElement): void {
    this.closeModal();
    this.modalEl = h('div', { class: 'edModal' }, h('div', { class: 'card' }, h('h3', {}, title), body, button('Close', 'closeModal', () => this.closeModal())));
    this.root.append(this.modalEl);
  }

  closeModal(): void {
    this.modalEl?.remove();
    this.modalEl = null;
  }
}
