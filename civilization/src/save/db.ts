// Saves in IndexedDB (database "hexborne", store "saves", keyed by name). Each record keeps a
// small summary for the load list plus the whole GameState as JSON.
import type { GameState } from '../core/state';
import { migrate } from '../core/migrate';

export interface SaveSummary {
  name: string;
  date: number;
  turn: number;
  faction: string;
  mapSize: string;
}

interface SaveRecord extends SaveSummary {
  state: string;
}

const DB = 'hexborne';
const STORE = 'saves';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'name' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        t.onerror = () => {
          db.close();
          reject(t.error);
        };
      }),
  );
}

export async function saveGame(name: string, s: GameState): Promise<void> {
  const human = s.players[Math.max(0, s.human)];
  const rec: SaveRecord = { name, date: Date.now(), turn: s.turn, faction: human.name, mapSize: s.settings.mapSize, state: JSON.stringify(s) };
  await tx('readwrite', (st) => st.put(rec));
}

export async function loadGame(name: string): Promise<GameState | null> {
  const rec = await tx<SaveRecord | undefined>('readonly', (st) => st.get(name));
  if (!rec) return null;
  const s = JSON.parse(rec.state) as GameState;
  if (s.version !== 1 || !s.map || !Array.isArray(s.players)) throw new Error('This save is from an incompatible version.');
  return migrate(s);
}

export async function listSaves(): Promise<SaveSummary[]> {
  const all = await tx<SaveRecord[]>('readonly', (st) => st.getAll());
  return all.map(({ name, date, turn, faction, mapSize }) => ({ name, date, turn, faction, mapSize })).sort((a, b) => b.date - a.date);
}

export async function deleteSave(name: string): Promise<void> {
  await tx('readwrite', (st) => st.delete(name));
}
