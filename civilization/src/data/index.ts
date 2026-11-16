// Loads every rules file, validates it with the zod schemas and indexes it by id.
// Everything else reads rules through `D` (e.g. D.units.get('warrior')).
import { z } from 'zod';
import * as S from './schema';
import terrains from './terrains.json';
import features from './features.json';
import resources from './resources.json';
import improvements from './improvements.json';
import units from './units.json';
import buildings from './buildings.json';
import techs from './techs.json';
import promotions from './promotions.json';
import factions from './factions.json';
import difficulty from './difficulty.json';
import pace from './pace.json';
import mapSizes from './mapSizes.json';
import ruins from './ruins.json';
import projects from './projects.json';
import specialists from './specialists.json';
import greatPeople from './greatPeople.json';
import policies from './policies.json';
import cityStates from './cityStates.json';
import rules from './rules.json';

export type TerrainDef = z.infer<typeof S.Terrain>;
export type FeatureDef = z.infer<typeof S.Feature>;
export type ResourceDef = z.infer<typeof S.Resource>;
export type ImprovementDef = z.infer<typeof S.Improvement>;
export type UnitDef = z.infer<typeof S.Unit>;
export type BuildingDef = z.infer<typeof S.Building>;
export type TechDef = z.infer<typeof S.Tech>;
export type PromotionDef = z.infer<typeof S.Promotion>;
export type FactionDef = z.infer<typeof S.Faction>;
export type DifficultyDef = z.infer<typeof S.Difficulty>;
export type PaceDef = z.infer<typeof S.Pace>;
export type MapSizeDef = z.infer<typeof S.MapSize>;
export type RuinDef = z.infer<typeof S.Ruin>;
export type RulesDef = z.infer<typeof S.Rules>;
export type ProjectDef = z.infer<typeof S.Project>;
export type PolicyTreeDef = z.infer<typeof S.PolicyTree>;
export type PolicyDef = z.infer<typeof S.Policy>;
export type EffectDef = z.infer<typeof S.Effect>;
export type CityStateDef = z.infer<typeof S.CityState>;

/** Parse a list file and index it by id; throws with the file name and path on any error. */
function table<T extends { id: string }>(name: string, schema: z.ZodType<T>, raw: unknown): Map<string, T> {
  const parsed = z.array(schema).safeParse(raw);
  if (!parsed.success) throw new Error(`data/${name}.json is invalid: ${z.prettifyError(parsed.error)}`);
  const map = new Map<string, T>();
  for (const row of parsed.data) {
    if (map.has(row.id)) throw new Error(`data/${name}.json: duplicate id "${row.id}"`);
    map.set(row.id, row);
  }
  return map;
}

const parsedRules = S.Rules.safeParse(rules);
if (!parsedRules.success) throw new Error(`data/rules.json is invalid: ${z.prettifyError(parsedRules.error)}`);

export const D = {
  terrains: table('terrains', S.Terrain, terrains),
  features: table('features', S.Feature, features),
  resources: table('resources', S.Resource, resources),
  improvements: table('improvements', S.Improvement, improvements),
  units: table('units', S.Unit, units),
  buildings: table('buildings', S.Building, buildings),
  techs: table('techs', S.Tech, techs),
  promotions: table('promotions', S.Promotion, promotions),
  factions: table('factions', S.Faction, factions),
  difficulty: table('difficulty', S.Difficulty, difficulty),
  pace: table('pace', S.Pace, pace),
  mapSizes: table('mapSizes', S.MapSize, mapSizes),
  ruins: table('ruins', S.Ruin, ruins),
  projects: table('projects', S.Project, projects),
  specialists: table('specialists', S.Specialist, specialists),
  greatPeople: table('greatPeople', S.GreatPerson, greatPeople),
  policyTrees: table('policies', S.PolicyTree, policies),
  cityStates: table('cityStates', S.CityState, cityStates),
  rules: parsedRules.data,
  /** Every policy by id, with the tree it belongs to. */
  policies: new Map<string, z.infer<typeof S.Policy> & { tree: string }>(),
};
for (const t of D.policyTrees.values()) for (const p of t.policies) D.policies.set(p.id, { ...p, tree: t.id });

/** Get a row or throw (ids in state are always valid, so a miss is a bug). */
export function get<T>(map: Map<string, T>, id: string): T {
  const v = map.get(id);
  if (v === undefined) throw new Error(`unknown id "${id}"`);
  return v;
}

// Cross-reference checks: every id a row points at must exist.
(function checkRefs() {
  const errs: string[] = [];
  const need = (m: Map<string, unknown>, id: string | undefined, where: string) => {
    if (id !== undefined && id !== 'none' && id !== 'any_land' && !m.has(id)) errs.push(`${where}: unknown "${id}"`);
  };
  for (const t of D.techs.values()) for (const p of t.prereqs) need(D.techs, p, `tech ${t.id} prereq`);
  for (const u of D.units.values()) {
    need(D.techs, u.tech, `unit ${u.id} tech`);
    need(D.techs, u.obsoleteTech, `unit ${u.id} obsoleteTech`);
    need(D.units, u.upgradesTo, `unit ${u.id} upgradesTo`);
    need(D.resources, u.resource, `unit ${u.id} resource`);
    need(D.factions, u.faction, `unit ${u.id} faction`);
    need(D.units, u.replaces, `unit ${u.id} replaces`);
    need(D.buildings, u.requiresBuilding, `unit ${u.id} requiresBuilding`);
    need(D.projects, u.requiresProject, `unit ${u.id} requiresProject`);
  }
  for (const b of D.buildings.values()) {
    need(D.techs, b.tech, `building ${b.id} tech`);
    need(D.buildings, b.requires.building, `building ${b.id} requires`);
    need(D.factions, b.faction, `building ${b.id} faction`);
    need(D.buildings, b.replaces, `building ${b.id} replaces`);
    need(D.resources, b.requires.resource, `building ${b.id} requires resource`);
  }
  for (const r of D.resources.values()) {
    need(D.improvements, r.improvement, `resource ${r.id} improvement`);
    need(D.techs, r.revealTech, `resource ${r.id} revealTech`);
    for (const t of r.terrains) need(D.terrains, t, `resource ${r.id} terrain`);
    for (const f of r.features) need(D.features, f, `resource ${r.id} feature`);
  }
  for (const i of D.improvements.values()) {
    need(D.techs, i.tech, `improvement ${i.id} tech`);
    for (const t of i.terrains) need(D.terrains, t, `improvement ${i.id} terrain`);
  }
  for (const f of D.features.values()) need(D.techs, f.removeTech, `feature ${f.id} removeTech`);
  for (const p of D.promotions.values()) for (const r of p.requires) need(D.promotions, r, `promotion ${p.id} requires`);
  for (const r of D.ruins.values()) need(D.units, r.unit, `ruin ${r.id} unit`);
  for (const p of D.projects.values()) need(D.techs, p.tech, `project ${p.id} tech`);
  for (const b of D.buildings.values()) {
    need(D.buildings, b.requires.allCities, `building ${b.id} requires allCities`);
    for (const k of Object.keys(b.specialists)) need(D.specialists, k, `building ${b.id} specialist`);
    for (const k of Object.keys(b.greatPeople)) need(D.greatPeople, k, `building ${b.id} greatPeople`);
  }
  for (const g of D.greatPeople.values()) need(D.units, g.unit, `great person ${g.id} unit`);
  for (const u of D.units.values()) need(D.improvements, u.gpImprovement, `unit ${u.id} gpImprovement`);
  for (const t of D.policyTrees.values()) {
    for (const p of t.policies) for (const r of p.requires) if (!t.policies.some((x) => x.id === r)) errs.push(`policy ${p.id}: unknown requirement ${r}`);
    if (t.excludes) need(D.policyTrees, t.excludes, `policy tree ${t.id} excludes`);
  }
  for (const u of D.rules.startUnits) need(D.units, u, 'rules startUnits');
  for (const d of D.difficulty.values()) for (const u of d.aiExtraUnits) need(D.units, u, `difficulty ${d.id}`);
  if (errs.length) throw new Error(`data cross-reference errors:\n${errs.join('\n')}`);
})();

/** The unit a faction actually builds for a base unit id (its unique unit if it has one). */
export function unitForFaction(base: string, faction: string): string {
  for (const u of D.units.values()) if (u.replaces === base && u.faction === faction) return u.id;
  return base;
}

/** Same for buildings. */
export function buildingForFaction(base: string, faction: string): string {
  for (const b of D.buildings.values()) if (b.replaces === base && b.faction === faction) return b.id;
  return base;
}

/** The base id a unique replaces (or the id itself). */
export function baseUnit(id: string): string {
  return D.units.get(id)?.replaces ?? id;
}
export function baseBuilding(id: string): string {
  return D.buildings.get(id)?.replaces ?? id;
}

export const ERA_NAMES = ['Ancient', 'Classical', 'Medieval', 'Renaissance', 'Industrial', 'Modern', 'Atomic', 'Information'];
