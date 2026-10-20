// storage.js
// ----------
// CONVERSION NOTE (SwiftUI -> React): this is the one shared low-level
// primitive that both UserDefaults (AppState's onboarding flag, AuthService's
// local user cache) and SwiftData (EmergencyContact persistence) get
// replaced by on the web: localStorage. Wrapping it once here means every
// service gets the same try/catch safety (private browsing mode, storage
// quota, or a corrupted value can all make localStorage throw or return
// unparseable JSON — none of those should crash the app).
//
// MOBILE NOTE: inside the Capacitor app, localStorage belongs to the app's
// private WebView data directory (not readable by other apps, and Android
// backup is disabled in AndroidManifest.xml). It is still not encrypted at
// rest beyond the OS's own device encryption, so nothing secret (plaintext
// passwords, API keys) is ever written here — only salted password hashes.

export class StorageError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'StorageError';
    this.cause = cause;
  }
}

export function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * Same as writeJSON, but throws a StorageError instead of returning false.
 * Use this wherever silently losing the write would mislead the user
 * (contacts, accounts, emergency history).
 */
export function writeJSONOrThrow(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    const quota = err?.name === 'QuotaExceededError';
    throw new StorageError(
      quota
        ? 'Device storage is full — could not save. Free up space and try again.'
        : 'Could not save to device storage.',
      err
    );
  }
}

export function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* no-op — nothing useful to do if storage is unavailable */
  }
}
