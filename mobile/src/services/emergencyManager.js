/**
 * emergencyManager.js — SOS session state machine
 *
 * The ONE canonical entry point for starting an emergency is
 * emergencyManager.trigger(source). Every UI path (SOS button after
 * confirmation, triple-tap, restored session) funnels through it via
 * emergencyController, so there is exactly one SOS implementation.
 *
 * Responsibilities:
 *   • Own the active session and its timeline (log)
 *   • Refuse duplicate sessions (trigger while active → ignored)
 *   • Persist the active session on every change so it survives a crash,
 *     an OS kill, or a WebView reload, and is restored on next launch
 *   • Move ended sessions into a persisted history (newest first)
 *   • Expose a stable snapshot for useSyncExternalStore
 *
 * NOT responsible for device side-effects (recording, GPS, alerts,
 * notifications) — emergencyController orchestrates those and reports
 * real outcomes back here via appendLog()/update().
 */

import { generateUUID } from '../utils/uuid';
import { TRIGGER_SOURCE, STORAGE_KEYS, EMERGENCY_HISTORY_LIMIT } from '../utils/constants';
import { readJSON, writeJSON, remove } from '../utils/storage';

const DUPLICATE_LOG_INTERVAL_MS = 5000;

export const SessionStatus = {
  active: 'active',
  ending: 'ending',         // resolve/cancel in progress (stopping recorders)
  resolved: 'resolved',
  cancelled: 'cancelled',
};

export function createEmergencyManager({ storage = { readJSON, writeJSON, remove }, now = () => new Date() } = {}) {
  let activeSession = null;
  let history = storage.readJSON(STORAGE_KEYS.emergencyHistory, []);
  if (!Array.isArray(history)) history = [];
  let lastDuplicateLogAt = 0;
  let persistFailed = false;

  let snapshot = { activeSession: null, log: [], isActive: false, history };
  const listeners = new Set();

  function _markPersist(result) {
    // Storage writes are async on mobile; a failure flips persistFailed so
    // the UI can warn instead of silently losing emergency state.
    Promise.resolve(result).then(
      (ok) => { if (ok === false) _flagPersistFailure(); },
      () => _flagPersistFailure()
    );
  }

  function _flagPersistFailure() {
    if (persistFailed) return;
    persistFailed = true;
    snapshot = { ...snapshot, persistFailed: true };
    listeners.forEach((l) => l());
  }

  function _persistActive() {
    if (activeSession) _markPersist(storage.writeJSON(STORAGE_KEYS.emergencyActive, activeSession));
    else storage.remove(STORAGE_KEYS.emergencyActive);
  }

  function _notify() {
    _persistActive();
    snapshot = {
      activeSession,
      log: activeSession?.log ?? [],
      isActive: activeSession !== null,
      history,
      persistFailed,
    };
    listeners.forEach((l) => l());
  }

  function _entry(message, level = 'info') {
    return { id: generateUUID(), timestamp: now().toISOString(), message, level };
  }

  function _appendLog(message, level) {
    activeSession = { ...activeSession, log: [...activeSession.log, _entry(message, level)] };
    _notify();
  }

  function _end(status, message) {
    if (activeSession === null) return null;
    const ended = {
      ...activeSession,
      status,
      endedAt: now().toISOString(),
      log: [...activeSession.log, _entry(message, status === SessionStatus.resolved ? 'success' : 'warning')],
    };
    history = [ended, ...history.filter((s) => s.id !== ended.id)].slice(0, EMERGENCY_HISTORY_LIMIT);
    _markPersist(storage.writeJSON(STORAGE_KEYS.emergencyHistory, history));
    activeSession = null;
    _notify();
    return ended;
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSnapshot() {
      return snapshot;
    },

    /**
     * Start an emergency session.
     * Returns { started: true, session } or { started: false, reason }.
     * A trigger while a session is active (or ending) never creates a
     * second session; it is logged at most once every 5 seconds so
     * repeated taps can't flood the timeline.
     */
    trigger(source) {
      if (activeSession !== null) {
        const t = now().getTime();
        if (t - lastDuplicateLogAt > DUPLICATE_LOG_INTERVAL_MS) {
          lastDuplicateLogAt = t;
          _appendLog(`Trigger from ${TRIGGER_SOURCE[source] ?? source} ignored — emergency already active`, 'warning');
        }
        return { started: false, reason: 'alreadyActive', session: activeSession };
      }

      const startedAt = now().toISOString();
      activeSession = {
        id: generateUUID(),
        startedAt,
        endedAt: null,
        status: SessionStatus.active,
        triggerSource: source,
        log: [_entry(`🚨 Emergency activated via ${TRIGGER_SOURCE[source] ?? source}`, 'critical')],
        location: null,       // last real fix during this session
        address: null,        // reverse-geocoded address (OpenStreetMap / device)
        floor: null,          // { confirmed, estimate, unavailable }
        alerts: null,         // filled by alertService with REAL per-contact outcomes
        recordings: null,     // filled when recorders stop
        restoredAfterRestart: false,
      };
      lastDuplicateLogAt = 0;
      _notify();
      return { started: true, session: activeSession };
    },

    /** Append a timeline entry. No-op when no session is active. */
    appendLog(message, level = 'info') {
      if (activeSession === null) return;
      _appendLog(message, level);
    },

    /** Merge structured data (location, alerts, recordings) into the active session. */
    update(patch) {
      if (activeSession === null) return;
      activeSession = { ...activeSession, ...patch };
      _notify();
    },

    /** Mark the session as ending (recorders flushing). Returns false if not active. */
    beginEnding() {
      if (activeSession === null || activeSession.status !== SessionStatus.active) return false;
      activeSession = { ...activeSession, status: SessionStatus.ending };
      _notify();
      return true;
    },

    /** "I'm safe" — ends the session and moves it into history. */
    resolve() {
      return _end(SessionStatus.resolved, '✅ Emergency resolved — marked safe');
    },

    /** False alarm — ends the session and moves it into history. */
    cancel() {
      return _end(SessionStatus.cancelled, '🚫 Emergency cancelled — false alarm');
    },

    /**
     * Restore a session that was active when the app was killed/reloaded.
     * Returns the restored session or null.
     */
    restore() {
      if (activeSession !== null) return activeSession;
      const saved = storage.readJSON(STORAGE_KEYS.emergencyActive, null);
      if (!saved || !saved.id || !Array.isArray(saved.log)) return null;
      activeSession = {
        ...saved,
        status: SessionStatus.active, // an interrupted "ending" must still be ended by the user
        restoredAfterRestart: true,
        log: [...saved.log, _entry('↻ App was restarted — emergency session restored', 'warning')],
      };
      _notify();
      return activeSession;
    },

    /**
     * Load persisted history once storage is ready (the singleton is created
     * at import time, before AsyncStorage has been read). Does not touch the
     * persisted active session — restore() handles that.
     */
    hydrate() {
      const saved = storage.readJSON(STORAGE_KEYS.emergencyHistory, []);
      history = Array.isArray(saved) ? saved : [];
      snapshot = { ...snapshot, history };
      listeners.forEach((l) => l());
    },

    getHistory() {
      return history;
    },

    deleteHistoryItem(id) {
      history = history.filter((s) => s.id !== id);
      storage.writeJSON(STORAGE_KEYS.emergencyHistory, history);
      _notify();
    },
  };
}

export const emergencyManager = createEmergencyManager();
