import AsyncStorage from '@react-native-async-storage/async-storage';

// storage.js
// ----------
// AsyncStorage (app-private, not readable by other apps) with an in-memory
// cache. initStorage() loads every VISHWAS key once at launch; after that
// reads are synchronous (the services were designed around synchronous
// reads), and writes update the cache immediately and persist in the
// background.
//
// writeJSONOrThrow() awaits the disk write and rejects with a StorageError,
// for data where silently losing the write would mislead the user.
// Nothing secret is stored here — password hashes and the session live in
// SecureStore (see secureStorage.js).

const PREFIX = 'vishwas.';
const cache = new Map();
let ready = false;

export class StorageError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'StorageError';
    this.cause = cause;
  }
}

export async function initStorage(backend = AsyncStorage) {
  const keys = (await backend.getAllKeys()).filter((k) => k.startsWith(PREFIX));
  const pairs = keys.length ? await backend.multiGet(keys) : [];
  cache.clear();
  for (const [k, v] of pairs) if (v !== null) cache.set(k, v);
  ready = true;
}

export function isStorageReady() {
  return ready;
}

export function readJSON(key, fallback) {
  const raw = cache.get(key);
  if (raw === undefined) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** Updates the cache now; persists in the background. Resolves true/false. */
export function writeJSON(key, value) {
  const raw = JSON.stringify(value);
  cache.set(key, raw);
  return AsyncStorage.setItem(key, raw).then(() => true, () => false);
}

export async function writeJSONOrThrow(key, value) {
  const raw = JSON.stringify(value);
  const previous = cache.get(key);
  cache.set(key, raw);
  try {
    await AsyncStorage.setItem(key, raw);
  } catch (err) {
    if (previous === undefined) cache.delete(key);
    else cache.set(key, previous);
    throw new StorageError('Could not save to device storage. Free up space and try again.', err);
  }
}

export function remove(key) {
  cache.delete(key);
  return AsyncStorage.removeItem(key).catch(() => {});
}

/** Test helper. */
export function __resetStorageCache() {
  cache.clear();
  ready = false;
}
