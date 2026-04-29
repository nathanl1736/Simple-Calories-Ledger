import type { AppState } from './types';
import { DEFAULT, normalizeStateShape } from './state';

const DB_NAME = 'calorie-tracker-db';
const DB_VERSION = 1;
const STORE_NAME = 'kv';
const STATE_KEY = 'state';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function store(mode: IDBTransactionMode) {
  const db = await openDB();
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

export async function readState(): Promise<AppState> {
  try {
    const objectStore = await store('readonly');
    return await new Promise(resolve => {
      const request = objectStore.get(STATE_KEY);
      request.onsuccess = () => resolve(normalizeStateShape(request.result || structuredClone(DEFAULT)));
      request.onerror = () => resolve(structuredClone(DEFAULT));
    });
  } catch {
    return structuredClone(DEFAULT);
  }
}

export async function saveState(state: AppState) {
  const objectStore = await store('readwrite');
  await new Promise<void>((resolve, reject) => {
    const request = objectStore.put(state, STATE_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
