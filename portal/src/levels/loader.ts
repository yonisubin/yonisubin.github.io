// Level pipeline (shell side): validate and normalise LevelData v2 from untrusted JSON (editor
// exports, imports, share links), with readable errors and defaults; JSON import/export.
//
// validateLevel() never throws: it returns the normalised level (or null) plus every problem found.
// parseLevel() throws a LevelError listing them. Errors make a level unusable; warnings are fixed
// up (defaults filled in, bad optional parts dropped) and reported.
import type { Brush, Checkpoint, DialogueHook, Entity, EntityType, FaceKey, LevelData, Marker, SurfaceTag, Trigger, Vec3, Wire } from './level';

export const ENTITY_TYPES: readonly EntityType[] = [
  'cube', 'companionCube', 'sphere', 'debris',
  'floorButton', 'pedestalButton', 'door', 'platform', 'lift', 'panel', 'gate', 'indicator', 'sign',
  'entryElevator', 'exitElevator', 'fixedPortal',
  'pelletLauncher', 'pelletCatcher', 'grill', 'liquid', 'crusher', 'turret', 'rocketTurret', 'disposal', 'bossCore',
  'light', 'decal', 'commentaryNode',
];

const TAGS: readonly SurfaceTag[] = ['portalable', 'metal', 'glass'];
const FACES: readonly FaceKey[] = ['+x', '-x', '+y', '-y', '+z', '-z'];
/** World size sanity limit (m): anything beyond is almost certainly a typo. */
const WORLD_LIMIT = 2000;

export interface ValidationResult {
  level: LevelData | null;
  errors: string[];
  warnings: string[];
}

export class LevelError extends Error {
  constructor(readonly errors: string[], readonly warnings: string[] = []) {
    super(`Invalid level:\n- ${errors.join('\n- ')}`);
    this.name = 'LevelError';
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function vec3(v: unknown, where: string, errors: string[]): Vec3 | null {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(isNum)) {
    errors.push(`${where} must be [x, y, z] numbers (got ${short(v)})`);
    return null;
  }
  if (v.some((n) => Math.abs(n) > WORLD_LIMIT)) {
    errors.push(`${where} is more than ${WORLD_LIMIT} m from the origin (${short(v)})`);
    return null;
  }
  return [v[0], v[1], v[2]];
}

function short(v: unknown): string {
  const s = JSON.stringify(v);
  return s === undefined ? String(v) : s.length > 60 ? `${s.slice(0, 57)}...` : s;
}

/** min/max box: both corners valid, max > min on every axis (swapped corners are fixed with a warning). */
function box(o: Obj, where: string, errors: string[], warnings: string[]): { min: Vec3; max: Vec3 } | null {
  const a = vec3(o.min, `${where}.min`, errors);
  const b = vec3(o.max, `${where}.max`, errors);
  if (!a || !b) return null;
  const min: Vec3 = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])];
  const max: Vec3 = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
  if (min.some((v, i) => v !== a[i])) warnings.push(`${where}: min and max were swapped on some axis (fixed)`);
  if (min.some((v, i) => max[i] - v < 1e-6)) {
    errors.push(`${where} has zero thickness on some axis (min ${short(min)}, max ${short(max)})`);
    return null;
  }
  return { min, max };
}

export function validateLevel(input: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObj(input)) return { level: null, errors: ['The level must be a JSON object'], warnings };
  const o = input;

  if (o.version !== undefined && o.version !== 2) errors.push(`Unsupported level version ${short(o.version)} (this game reads version 2)`);
  let name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : '';
  if (!name) {
    name = 'Untitled chamber';
    warnings.push('No name: called it "Untitled chamber"');
  }
  let id: string | undefined;
  if (o.id !== undefined) {
    if (typeof o.id === 'string' && /^[\w.-]{1,64}$/.test(o.id)) id = o.id;
    else warnings.push(`id ${short(o.id)} is not a simple name (letters, digits, _ . -): dropped`);
  }

  // Spawn
  let spawn: LevelData['spawn'] | null = null;
  if (!isObj(o.spawn)) errors.push('Missing spawn: { position: [x, y, z], yaw }');
  else {
    const p = vec3(o.spawn.position, 'spawn.position', errors);
    const yaw = isNum(o.spawn.yaw) ? o.spawn.yaw : 0;
    if (o.spawn.yaw !== undefined && !isNum(o.spawn.yaw)) warnings.push('spawn.yaw is not a number: using 0');
    if (p) spawn = { position: p, yaw };
  }

  // Brushes
  const brushes: Brush[] = [];
  if (!Array.isArray(o.brushes)) errors.push('Missing brushes: an array of { min, max, tag }');
  else {
    if (o.brushes.length === 0) errors.push('The level has no brushes (nothing to stand on)');
    o.brushes.forEach((b, i) => {
      const w = `brushes[${i}]`;
      if (!isObj(b)) return void errors.push(`${w} must be an object`);
      const bx = box(b, w, errors, warnings);
      let tag = b.tag as SurfaceTag;
      if (!TAGS.includes(tag)) {
        if (b.tag !== undefined) warnings.push(`${w}.tag ${short(b.tag)} is unknown (use ${TAGS.join(' / ')}): using portalable`);
        tag = 'portalable';
      }
      let faces: Brush['faces'];
      if (b.faces !== undefined) {
        if (!isObj(b.faces)) warnings.push(`${w}.faces must be an object: dropped`);
        else {
          faces = {};
          for (const [k, v] of Object.entries(b.faces)) {
            if (!FACES.includes(k as FaceKey)) warnings.push(`${w}.faces: unknown face "${k}" (use ${FACES.join(' ')}): dropped`);
            else if (!TAGS.includes(v as SurfaceTag)) warnings.push(`${w}.faces["${k}"] = ${short(v)} is not a surface tag: dropped`);
            else if (v !== tag) faces[k as FaceKey] = v as SurfaceTag;
          }
          if (!Object.keys(faces).length) faces = undefined;
        }
      }
      const theme = b.theme === 'clean' || b.theme === 'industrial' ? b.theme : undefined;
      if (b.theme !== undefined && !theme) warnings.push(`${w}.theme must be "clean" or "industrial": dropped`);
      if (bx) brushes.push({ min: bx.min, max: bx.max, tag, ...(faces ? { faces } : {}), ...(theme ? { theme } : {}) });
    });
  }

  // Markers
  const markers: Marker[] = [];
  if (Array.isArray(o.markers))
    o.markers.forEach((m, i) => {
      const w = `markers[${i}]`;
      if (!isObj(m)) return void warnings.push(`${w} is not an object: dropped`);
      const e: string[] = [];
      const p = vec3(m.position, `${w}.position`, e);
      const size = Array.isArray(m.size) && m.size.length === 2 && m.size.every(isNum) ? (m.size as [number, number]) : null;
      if (!p || !size || !isNum(m.color)) warnings.push(`${w} needs position, size [w, d] and a colour number: dropped`);
      else markers.push({ position: p, size, color: m.color });
    });

  // Entities
  const entities: Entity[] = [];
  const ids = new Set<string>();
  if (o.entities !== undefined && !Array.isArray(o.entities)) errors.push('entities must be an array');
  if (Array.isArray(o.entities))
    o.entities.forEach((en, i) => {
      const w = `entities[${i}]`;
      if (!isObj(en)) return void errors.push(`${w} must be an object`);
      const eid = typeof en.id === 'string' && en.id ? en.id : '';
      if (!eid) return void errors.push(`${w} has no id`);
      if (ids.has(eid)) return void errors.push(`${w}: duplicate entity id "${eid}"`);
      if (!/^[\w-]+$/.test(eid)) return void errors.push(`${w}: id "${eid}" may only use letters, digits, _ and - (it is used in wiring as "id.output")`);
      if (!ENTITY_TYPES.includes(en.type as EntityType)) return void errors.push(`${w} ("${eid}"): unknown type ${short(en.type)}`);
      const p = vec3(en.position, `${w} ("${eid}").position`, errors);
      if (!p) return;
      ids.add(eid);
      const ent: Entity = { id: eid, type: en.type as EntityType, position: p };
      if (en.yaw !== undefined) {
        if (isNum(en.yaw)) ent.yaw = en.yaw;
        else warnings.push(`${w} ("${eid}").yaw is not a number: dropped`);
      }
      if (en.props !== undefined) {
        if (isObj(en.props)) ent.props = JSON.parse(JSON.stringify(en.props)) as Record<string, unknown>;
        else warnings.push(`${w} ("${eid}").props must be an object: dropped`);
      }
      entities.push(ent);
    });

  // Wiring: "id.port" → "id.port", both ends must name existing entities.
  const wiring: Wire[] = [];
  if (Array.isArray(o.wiring))
    o.wiring.forEach((wr, i) => {
      const w = `wiring[${i}]`;
      if (!isObj(wr) || typeof wr.from !== 'string' || typeof wr.to !== 'string') return void errors.push(`${w} must be { from: "id.output", to: "id.input" }`);
      const bad = [wr.from, wr.to].filter((s) => !/^[\w-]+\.\w+$/.test(s));
      if (bad.length) return void errors.push(`${w}: "${bad[0]}" must look like "entityId.port"`);
      const missing = [wr.from, wr.to].map((s) => s.split('.')[0]).filter((e) => !ids.has(e));
      if (missing.length) return void errors.push(`${w}: no entity "${missing[0]}" (wire ${wr.from} → ${wr.to})`);
      if (wiring.some((x) => x.from === wr.from && x.to === wr.to)) return void warnings.push(`${w}: duplicate wire ${wr.from} → ${wr.to} dropped`);
      wiring.push({ from: wr.from, to: wr.to });
    });

  // Triggers
  const triggers: Trigger[] = [];
  const tids = new Set<string>();
  if (Array.isArray(o.triggers))
    o.triggers.forEach((t, i) => {
      const w = `triggers[${i}]`;
      if (!isObj(t)) return void errors.push(`${w} must be an object`);
      const tid = typeof t.id === 'string' && t.id ? t.id : `trigger${i + 1}`;
      if (t.id === undefined) warnings.push(`${w} has no id: called it "${tid}"`);
      if (tids.has(tid)) return void errors.push(`${w}: duplicate trigger id "${tid}"`);
      if (typeof t.event !== 'string' || !t.event) return void errors.push(`${w} ("${tid}") needs an event name`);
      const bx = box(t, w, errors, warnings);
      if (!bx) return;
      tids.add(tid);
      triggers.push({ id: tid, ...bx, event: t.event, ...(t.once !== undefined ? { once: !!t.once } : {}) });
    });

  // Checkpoints
  const checkpoints: Checkpoint[] = [];
  const cids = new Set<string>();
  if (Array.isArray(o.checkpoints))
    o.checkpoints.forEach((c, i) => {
      const w = `checkpoints[${i}]`;
      if (!isObj(c)) return void errors.push(`${w} must be an object`);
      const cid = typeof c.id === 'string' && c.id ? c.id : `checkpoint${i + 1}`;
      if (cids.has(cid)) return void errors.push(`${w}: duplicate checkpoint id "${cid}"`);
      const bx = box(c, w, errors, warnings);
      const sp = isObj(c.spawn) ? vec3(c.spawn.position, `${w}.spawn.position`, errors) : null;
      if (!isObj(c.spawn)) errors.push(`${w} ("${cid}") needs spawn: { position, yaw }`);
      if (!bx || !sp) return;
      cids.add(cid);
      checkpoints.push({ id: cid, ...bx, spawn: { position: sp, yaw: isObj(c.spawn) && isNum(c.spawn.yaw) ? c.spawn.yaw : 0 } });
    });

  // Dialogue hooks
  const dialogue: DialogueHook[] = [];
  if (Array.isArray(o.dialogue))
    o.dialogue.forEach((d, i) => {
      const w = `dialogue[${i}]`;
      if (!isObj(d) || typeof d.event !== 'string' || !Array.isArray(d.lines)) return void warnings.push(`${w} must be { event, lines: [ids] }: dropped`);
      const lines = d.lines.filter((l): l is string => typeof l === 'string' && !!l);
      if (lines.length) dialogue.push({ event: d.event, lines });
    });

  let device: LevelData['device'];
  if (o.device !== undefined) {
    if (o.device === 'none' || o.device === 'a' || o.device === 'both') device = o.device;
    else warnings.push(`device ${short(o.device)} must be "none", "a" or "both": using both`);
  }

  let info: LevelData['info'];
  if (isObj(o.info)) {
    info = {};
    if (isNum(o.info.number)) info.number = o.info.number;
    if (typeof o.info.title === 'string') info.title = o.info.title;
    if (Array.isArray(o.info.icons)) info.icons = o.info.icons.filter((s): s is string => typeof s === 'string');
    if (o.info.theme === 'clean' || o.info.theme === 'industrial') info.theme = o.info.theme;
  }

  if (spawn && brushes.length) {
    const s = spawn.position;
    const inside = brushes.some((b) => s[0] > b.min[0] + 1e-3 && s[0] < b.max[0] - 1e-3 && s[1] + 0.9 > b.min[1] + 1e-3 && s[1] + 0.9 < b.max[1] - 1e-3 && s[2] > b.min[2] + 1e-3 && s[2] < b.max[2] - 1e-3);
    if (inside) warnings.push('The spawn point is inside a brush');
  }
  if (!entities.some((e) => e.type === 'exitElevator')) warnings.push('No exit elevator: the chamber cannot be finished');

  if (errors.length || !spawn) return { level: null, errors, warnings };
  const level: LevelData = { version: 2, ...(id ? { id } : {}), name, spawn, brushes };
  if (markers.length) level.markers = markers;
  if (entities.length) level.entities = entities;
  if (wiring.length) level.wiring = wiring;
  if (triggers.length) level.triggers = triggers;
  if (checkpoints.length) level.checkpoints = checkpoints;
  if (dialogue.length) level.dialogue = dialogue;
  if (device) level.device = device;
  if (info && Object.keys(info).length) level.info = info;
  if (typeof o.next === 'string' && o.next) level.next = o.next;
  return { level, errors, warnings };
}

/** Validate or throw a LevelError with every problem listed. */
export function parseLevel(input: unknown): LevelData {
  const r = validateLevel(input);
  if (!r.level) throw new LevelError(r.errors, r.warnings);
  return r.level;
}

/** JSON text → level (throws LevelError, or a LevelError wrapping a JSON syntax error). */
export function importLevelJSON(text: string): LevelData {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new LevelError([`Not valid JSON: ${(e as Error).message}`]);
  }
  return parseLevel(data);
}

/** Level → pretty JSON (normalised first, so exports are always valid). */
export function exportLevelJSON(level: LevelData): string {
  return JSON.stringify(parseLevel(level), null, 2);
}

/** A file name for an export: "my-chamber.twinfold.json". */
export function exportFileName(level: LevelData): string {
  const base = (level.id || level.name || 'chamber').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'chamber';
  return `${base}.twinfold.json`;
}
