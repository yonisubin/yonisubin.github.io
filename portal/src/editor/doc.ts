// The puzzle maker's document: the level being edited, the selection, and undo / redo. Every edit
// goes through change(), which records the previous state (JSON) so it can be undone. All positions
// snap to the 0.5 m grid.
import type { Brush, EntityType, FaceKey, LevelData, SurfaceTag, Vec3 } from '../levels/level';
import { SHELL } from '../core/shellConfig';
import { CATALOG } from './catalog';

export type Selection =
  | { kind: 'brush'; index: number }
  | { kind: 'entity'; id: string }
  | { kind: 'trigger'; id: string }
  | { kind: 'checkpoint'; id: string }
  | { kind: 'spawn' }
  | null;

export const snap = (v: number, g: number = SHELL.editor.grid) => Math.round(v / g) * g;
export const snap3 = (v: Vec3): Vec3 => [snap(v[0]), snap(v[1]), snap(v[2])];
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A fresh chamber: a 16 × 16 m white room, 4 m tall, spawn at the south, exit at the north. */
export function blankLevel(): LevelData {
  return {
    version: 2,
    id: 'custom',
    name: 'New chamber',
    spawn: { position: [0, 0, 6], yaw: 0 },
    brushes: [
      { min: [-8, -1, -8], max: [8, 0, 8], tag: 'portalable' },
      { min: [-8, 4, -8], max: [8, 5, 8], tag: 'portalable' },
      { min: [-9, -1, -8], max: [-8, 5, 8], tag: 'portalable' },
      { min: [8, -1, -8], max: [9, 5, 8], tag: 'portalable' },
      { min: [-9, -1, -9], max: [9, 5, -8], tag: 'portalable' },
      { min: [-9, -1, 8], max: [9, 5, 9], tag: 'metal' },
    ],
    entities: [{ id: 'exit', type: 'exitElevator', position: [0, 0, -6.5] }],
    wiring: [],
  };
}

export class EditorDoc {
  level: LevelData;
  selection: Selection = null;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  /** Called after every change (and undo / redo). */
  onChange: () => void = () => undefined;
  /** Edits since the last save (drafts). */
  dirty = false;

  constructor(level: LevelData = blankLevel()) {
    this.level = clone(level);
  }

  /** Replace the whole document (open / import / new). Clears history. */
  load(level: LevelData): void {
    this.level = clone(level);
    this.selection = null;
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.onChange();
  }

  /** Record an undo step, then apply `fn` to the level. */
  change(fn: (l: LevelData) => void): void {
    this.undoStack.push(JSON.stringify(this.level));
    if (this.undoStack.length > SHELL.editor.undoLimit) this.undoStack.shift();
    this.redoStack = [];
    fn(this.level);
    this.dirty = true;
    this.fixSelection();
    this.onChange();
  }

  /** Begin a drag: returns a commit function that records ONE undo step for the whole gesture. */
  beginGesture(): () => void {
    const before = JSON.stringify(this.level);
    return () => {
      if (JSON.stringify(this.level) === before) return;
      this.undoStack.push(before);
      this.redoStack = [];
      this.dirty = true;
      this.onChange();
    };
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(JSON.stringify(this.level));
    this.level = JSON.parse(prev) as LevelData;
    this.dirty = true;
    this.fixSelection();
    this.onChange();
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(JSON.stringify(this.level));
    this.level = JSON.parse(next) as LevelData;
    this.dirty = true;
    this.fixSelection();
    this.onChange();
    return true;
  }

  private fixSelection(): void {
    const s = this.selection;
    if (!s) return;
    const l = this.level;
    const ok =
      (s.kind === 'brush' && s.index < l.brushes.length) ||
      (s.kind === 'entity' && !!l.entities?.some((e) => e.id === s.id)) ||
      (s.kind === 'trigger' && !!l.triggers?.some((e) => e.id === s.id)) ||
      (s.kind === 'checkpoint' && !!l.checkpoints?.some((e) => e.id === s.id)) ||
      s.kind === 'spawn';
    if (!ok) this.selection = null;
  }

  select(s: Selection): void {
    this.selection = s;
    this.onChange();
  }

  // --- Operations (each one undoable) ---------------------------------------------------------

  addBrush(min: Vec3, max: Vec3, tag: SurfaceTag = 'portalable'): number {
    const a = snap3(min), b = snap3(max);
    const lo: Vec3 = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])];
    const hi: Vec3 = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
    for (let k = 0; k < 3; k++) if (hi[k] - lo[k] < SHELL.editor.grid) hi[k] = lo[k] + SHELL.editor.grid;
    let index = -1;
    this.change((l) => {
      index = l.brushes.push({ min: lo, max: hi, tag }) - 1;
    });
    this.selection = { kind: 'brush', index };
    this.onChange();
    return index;
  }

  updateBrush(index: number, patch: Partial<Brush>): void {
    this.change((l) => {
      const b = l.brushes[index];
      if (!b) return;
      Object.assign(b, clone(patch));
      for (let k = 0; k < 3; k++) {
        b.min[k] = snap(b.min[k]);
        b.max[k] = snap(b.max[k]);
        if (b.max[k] - b.min[k] < SHELL.editor.grid) b.max[k] = b.min[k] + SHELL.editor.grid;
      }
    });
  }

  /** Set one face's tag (or the base tag when face is null); faces equal to the base are dropped. */
  setFaceTag(index: number, face: FaceKey | null, tag: SurfaceTag): void {
    this.change((l) => {
      const b = l.brushes[index];
      if (!b) return;
      if (face === null) b.tag = tag;
      else (b.faces ??= {})[face] = tag;
      if (b.faces) {
        for (const [k, v] of Object.entries(b.faces)) if (v === b.tag) delete b.faces[k as FaceKey];
        if (!Object.keys(b.faces).length) delete b.faces;
      }
    });
  }

  removeBrush(index: number): void {
    this.change((l) => void l.brushes.splice(index, 1));
  }

  /** Move a brush / entity / trigger / checkpoint / spawn by a delta (m). */
  moveSelection(d: Vec3): void {
    const s = this.selection;
    if (!s) return;
    this.change((l) => this.applyMove(l, s, d));
  }

  /** Move without recording history (live drags; wrap in beginGesture). */
  applyMove(l: LevelData, s: Selection, d: Vec3): void {
    const add = (v: Vec3) => {
      for (let k = 0; k < 3; k++) v[k] = snap(v[k] + d[k]);
    };
    if (!s) return;
    if (s.kind === 'brush') {
      const b = l.brushes[s.index];
      if (b) (add(b.min), add(b.max));
    } else if (s.kind === 'entity') {
      const e = l.entities?.find((x) => x.id === s.id);
      if (e) add(e.position);
    } else if (s.kind === 'trigger') {
      const t = l.triggers?.find((x) => x.id === s.id);
      if (t) (add(t.min), add(t.max));
    } else if (s.kind === 'checkpoint') {
      const c = l.checkpoints?.find((x) => x.id === s.id);
      if (c) (add(c.min), add(c.max), add(c.spawn.position));
    } else if (s.kind === 'spawn') add(l.spawn.position);
  }

  /** Grow / shrink the selected box's max corner (Shift + arrows). */
  resizeSelection(d: Vec3): void {
    const s = this.selection;
    if (!s) return;
    this.change((l) => {
      const box = s.kind === 'brush' ? l.brushes[s.index] : s.kind === 'trigger' ? l.triggers?.find((x) => x.id === s.id) : s.kind === 'checkpoint' ? l.checkpoints?.find((x) => x.id === s.id) : null;
      if (!box) return;
      for (let k = 0; k < 3; k++) box.max[k] = Math.max(box.min[k] + SHELL.editor.grid, snap(box.max[k] + d[k]));
    });
  }

  private uniqueId(base: string, taken: (id: string) => boolean): string {
    for (let i = 1; ; i++) if (!taken(`${base}${i}`)) return `${base}${i}`;
  }

  addEntity(type: EntityType, position: Vec3, props?: Record<string, unknown>): string {
    const id = this.uniqueId(type, (x) => !!this.level.entities?.some((e) => e.id === x));
    this.change((l) => {
      (l.entities ??= []).push({ id, type, position: snap3(position), ...(props ?? Object.keys(CATALOG[type].props).length ? { props: clone(props ?? CATALOG[type].props) } : {}) });
    });
    this.selection = { kind: 'entity', id };
    this.onChange();
    return id;
  }

  updateEntity(id: string, patch: { id?: string; position?: Vec3; yaw?: number; props?: Record<string, unknown> }): void {
    this.change((l) => {
      const e = l.entities?.find((x) => x.id === id);
      if (!e) return;
      if (patch.position) e.position = snap3(patch.position);
      if (patch.yaw !== undefined) e.yaw = patch.yaw;
      if (patch.props) e.props = clone(patch.props);
      if (patch.id && patch.id !== id && !l.entities!.some((x) => x.id === patch.id)) {
        e.id = patch.id;
        // Keep wires pointing at the renamed entity.
        for (const w of l.wiring ?? []) {
          if (w.from.split('.')[0] === id) w.from = `${patch.id}.${w.from.split('.')[1]}`;
          if (w.to.split('.')[0] === id) w.to = `${patch.id}.${w.to.split('.')[1]}`;
        }
        if (this.selection?.kind === 'entity' && this.selection.id === id) this.selection = { kind: 'entity', id: patch.id };
      }
    });
  }

  removeEntity(id: string): void {
    this.change((l) => {
      l.entities = (l.entities ?? []).filter((e) => e.id !== id);
      l.wiring = (l.wiring ?? []).filter((w) => w.from.split('.')[0] !== id && w.to.split('.')[0] !== id);
    });
  }

  /** Wire source entity's output to target entity's input (default port names from the catalog). */
  addWire(fromId: string, toId: string, output?: string, input?: string): string | null {
    const ents = this.level.entities ?? [];
    const a = ents.find((e) => e.id === fromId), b = ents.find((e) => e.id === toId);
    if (!a || !b || a === b) return null;
    const out = output ?? CATALOG[a.type].outputs[0];
    const inp = input ?? CATALOG[b.type].inputs[0];
    if (!out || !inp) return null;
    const w = { from: `${a.id}.${out}`, to: `${b.id}.${inp}` };
    if (this.level.wiring?.some((x) => x.from === w.from && x.to === w.to)) return null;
    this.change((l) => void (l.wiring ??= []).push(w));
    return `${w.from}→${w.to}`;
  }

  removeWire(index: number): void {
    this.change((l) => void l.wiring?.splice(index, 1));
  }

  addTrigger(min: Vec3, max: Vec3, event = 'trigger'): string {
    const id = this.uniqueId('trigger', (x) => !!this.level.triggers?.some((t) => t.id === x));
    this.change((l) => void (l.triggers ??= []).push({ id, min: snap3(min), max: snap3(max), event, once: true }));
    this.selection = { kind: 'trigger', id };
    this.onChange();
    return id;
  }

  updateTrigger(id: string, patch: { event?: string; once?: boolean; min?: Vec3; max?: Vec3; id?: string }): void {
    this.change((l) => {
      const t = l.triggers?.find((x) => x.id === id);
      if (!t) return;
      if (patch.event !== undefined) t.event = patch.event;
      if (patch.once !== undefined) t.once = patch.once;
      if (patch.min) t.min = snap3(patch.min);
      if (patch.max) t.max = snap3(patch.max);
    });
  }

  removeTrigger(id: string): void {
    this.change((l) => void (l.triggers = (l.triggers ?? []).filter((t) => t.id !== id)));
  }

  addCheckpoint(min: Vec3, max: Vec3): string {
    const id = this.uniqueId('checkpoint', (x) => !!this.level.checkpoints?.some((t) => t.id === x));
    const spawn: Vec3 = snap3([(min[0] + max[0]) / 2, Math.min(min[1], max[1]), (min[2] + max[2]) / 2]);
    this.change((l) => void (l.checkpoints ??= []).push({ id, min: snap3(min), max: snap3(max), spawn: { position: spawn, yaw: 0 } }));
    this.selection = { kind: 'checkpoint', id };
    this.onChange();
    return id;
  }

  updateCheckpoint(id: string, patch: { min?: Vec3; max?: Vec3; spawn?: { position: Vec3; yaw: number } }): void {
    this.change((l) => {
      const c = l.checkpoints?.find((x) => x.id === id);
      if (!c) return;
      if (patch.min) c.min = snap3(patch.min);
      if (patch.max) c.max = snap3(patch.max);
      if (patch.spawn) c.spawn = { position: snap3(patch.spawn.position), yaw: patch.spawn.yaw };
    });
  }

  removeCheckpoint(id: string): void {
    this.change((l) => void (l.checkpoints = (l.checkpoints ?? []).filter((t) => t.id !== id)));
  }

  setSpawn(position: Vec3, yaw?: number): void {
    this.change((l) => {
      l.spawn = { position: snap3(position), yaw: yaw ?? l.spawn.yaw };
    });
  }

  setInfo(patch: Partial<Pick<LevelData, 'name' | 'id' | 'device' | 'next' | 'info' | 'dialogue'>>): void {
    this.change((l) => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === '') delete (l as unknown as Record<string, unknown>)[k];
        else (l as unknown as Record<string, unknown>)[k] = clone(v);
      }
      if (!l.name) l.name = 'Untitled chamber';
    });
  }

  deleteSelection(): void {
    const s = this.selection;
    if (!s) return;
    if (s.kind === 'brush') this.removeBrush(s.index);
    else if (s.kind === 'entity') this.removeEntity(s.id);
    else if (s.kind === 'trigger') this.removeTrigger(s.id);
    else if (s.kind === 'checkpoint') this.removeCheckpoint(s.id);
    this.selection = null;
    this.onChange();
  }

  duplicateSelection(): void {
    const s = this.selection;
    if (s?.kind === 'brush') {
      const b = this.level.brushes[s.index];
      const g = SHELL.editor.grid * 2;
      this.addBrush([b.min[0] + g, b.min[1], b.min[2] + g], [b.max[0] + g, b.max[1], b.max[2] + g], b.tag);
    } else if (s?.kind === 'entity') {
      const e = this.level.entities?.find((x) => x.id === s.id);
      if (e) this.addEntity(e.type, [e.position[0] + 1, e.position[1], e.position[2] + 1], e.props);
    }
  }
}
