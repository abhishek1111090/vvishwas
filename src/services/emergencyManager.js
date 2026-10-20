/**
 * emergencyManager.js — SOS session state machine
 *
 * Responsibilities (Phase 1):
 *   • Own the active session object and activity log
 *   • Expose a stable snapshot for useSyncExternalStore (see getSnapshot fix)
 *   • Accept log entries from external orchestrators (EmergencyContext)
 *
 * NOT responsible for:
 *   • Starting/stopping media recording (→ recordingService)
 *   • Starting/stopping GPS tracking   (→ locationService)
 *   These are wired in EmergencyContext so they stay in the React/user-gesture
 *   call stack, which iOS Safari requires for getUserMedia.
 */

import { generateUUID } from '../utils/uuid';
import { TRIGGER_SOURCE } from '../utils/constants';

function createEmergencyManager() {
  let activeSession = null;
  let log = [];

  // Stable snapshot — only replaced inside _notify(), never mutated in place.
  // React 19 useSyncExternalStore calls getSnapshot() twice per render and
  // uses Object.is() to verify stability. A fresh {} on every call throws:
  // "The result of getSnapshot should be cached to avoid an infinite loop".
  let snapshot = { activeSession: null, log: [], isActive: false };

  const listeners = new Set();

  function _notify() {
    snapshot = { activeSession, log, isActive: activeSession !== null };
    listeners.forEach((l) => l());
  }

  function _appendLog(message) {
    log = [
      ...log,
      { id: generateUUID(), timestamp: new Date().toISOString(), message },
    ];
    _notify();
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
     * Start an emergency session. No-op if one is already active.
     * Real side-effects (recording, GPS) are started by EmergencyContext
     * immediately after this returns, so they're still in the user-gesture stack.
     */
    trigger(source) {
      if (activeSession !== null) {
        _appendLog(
          `⚠️ Trigger from ${TRIGGER_SOURCE[source] ?? source} ignored — session already active`
        );
        return;
      }

      activeSession = {
        id: generateUUID(),
        startedAt: new Date().toISOString(),
        endedAt: null,
        status: 'active',
        triggerSource: source,
      };
      log = [];
      _notify();

      _appendLog(`🚨 Emergency activated via ${TRIGGER_SOURCE[source] ?? source}`);
    },

    /**
     * Append a log entry from external code (EmergencyContext reports real
     * service statuses here so they appear in the EmergencyActiveOverlay).
     * No-op when no session is active.
     */
    appendLog(message) {
      if (activeSession === null) return;
      _appendLog(message);
    },

    /** Resolve — the "I'm safe now" path. EmergencyContext stops services first. */
    resolve() {
      if (activeSession === null) return;
      _appendLog('✅ Emergency resolved');
      activeSession = { ...activeSession, endedAt: new Date().toISOString(), status: 'resolved' };
      _notify();
      // Small delay so the overlay can show "resolved" before we clear state
      setTimeout(() => {
        activeSession = null;
        _notify();
      }, 800);
    },

    /** Cancel — false alarm path. EmergencyContext resets services first. */
    cancel() {
      if (activeSession === null) return;
      _appendLog('🚫 Emergency cancelled — false alarm');
      activeSession = null;
      _notify();
    },
  };
}

export const emergencyManager = createEmergencyManager();
