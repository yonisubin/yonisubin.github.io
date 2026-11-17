// Puzzle-maker drafts in IndexedDB (database `twinfold`, store `drafts`).
import type { LevelData } from '../levels/level';
import { dbAll, dbDelete, dbGet, dbPut } from '../save/db';

export interface Draft {
  key: string;
  name: string;
  updated: number;
  level: LevelData;
}

export const newDraftKey = () => `draft-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

export async function saveDraft(key: string, level: LevelData): Promise<Draft> {
  const d: Draft = { key, name: level.name, updated: Date.now(), level: JSON.parse(JSON.stringify(level)) as LevelData };
  await dbPut('drafts', d);
  return d;
}

export async function listDrafts(): Promise<Draft[]> {
  return (await dbAll<Draft>('drafts')).sort((a, b) => b.updated - a.updated);
}

export const loadDraft = (key: string) => dbGet<Draft>('drafts', key);
export const deleteDraft = (key: string) => dbDelete('drafts', key);
