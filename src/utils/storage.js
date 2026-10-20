// storage.js
// ----------
// CONVERSION NOTE (SwiftUI -> React): this is the one shared low-level
// primitive that both UserDefaults (AppState's onboarding flag, AuthService's
// local user cache) and SwiftData (EmergencyContact persistence) get
// replaced by on the web: localStorage. Wrapping it once here means every
// service gets the same try/catch safety (private browsing mode, storage
// quota, or a corrupted value can all make localStorage throw or return
// unparseable JSON — none of those should crash the app).

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

export function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* no-op — nothing useful to do if storage is unavailable */
  }
}
