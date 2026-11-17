// Tiny promise wrapper around the IndexedDB database `twinfold` (saves, campaign progress, editor
// drafts, challenge leaderboards). One object store per kind, keyed by a string `key` field.
import { SHELL } from '../core/shellConfig';

export type StoreName = 'saves' | 'progress' | 'drafts' | 'leaderboard';
const STORES: StoreName[] = ['saves', 'progress', 'drafts', 'leaderboard'];

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB is not available'));
    const req = indexedDB.open(SHELL.storage.db, SHELL.storage.dbVersion);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('could not open IndexedDB'));
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function dbGet<T extends { key: string }>(store: StoreName, key: string): Promise<T | null> {
  const db = await open();
  const r = await done(db.transaction(store, 'readonly').objectStore(store).get(key));
  return (r as T | undefined) ?? null;
}

export async function dbPut<T extends { key: string }>(store: StoreName, value: T): Promise<void> {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function dbDelete(store: StoreName, key: string): Promise<void> {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function dbAll<T>(store: StoreName): Promise<T[]> {
  const db = await open();
  return (await done(db.transaction(store, 'readonly').objectStore(store).getAll())) as T[];
}

export async function dbClear(store: StoreName): Promise<void> {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).clear();
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
