import {
  createContext, useContext, useSyncExternalStore,
  useMemo, useCallback, useRef, useEffect,
} from 'react';
import { emergencyManager } from '../services/emergencyManager';
import { recordingService }  from '../services/recordingService';
import { locationService }   from '../services/locationService';
import { haptics }           from '../services/hapticService';

/**
 * EmergencyContext — orchestrates the SOS session, recording, and GPS.
 *
 * Architecture:
 *   emergencyManager  — pure session state machine (active/log/isActive)
 *   recordingService  — audio + video MediaRecorder
 *   locationService   — GPS watchPosition
 *
 * All three expose the same pub-sub interface (subscribe / getSnapshot) so
 * they can be consumed with useSyncExternalStore, giving the same "any
 * mutation triggers a re-render" behaviour SwiftUI's @Observable provided.
 *
 * WHY orchestration lives here (not in emergencyManager):
 *   iOS Safari requires getUserMedia to be called within a user-gesture call
 *   stack. trigger() is called directly from onClick handlers, so calling
 *   recordingService.startAudio/Video() from here — synchronously after
 *   emergencyManager.trigger() — keeps them in the same user-gesture context.
 *   Moving this into a plain JS service would break iOS camera/mic access.
 */

const EmergencyContext = createContext(null);

export function EmergencyProvider({ children }) {
  // Subscribe to all three services with stable snapshots
  const emergencySnap = useSyncExternalStore(
    emergencyManager.subscribe,
    emergencyManager.getSnapshot
  );
  const recordingSnap = useSyncExternalStore(
    recordingService.subscribe,
    recordingService.getSnapshot
  );
  const locationSnap = useSyncExternalStore(
    locationService.subscribe,
    locationService.getSnapshot
  );

  // Track whether services are currently active so resolve/cancel
  // know to clean them up, even if the snapshot flickers.
  const servicesRunningRef = useRef(false);

  // Log the first GPS fix to the emergency activity log so the user
  // sees real coordinates appear in the EmergencyActiveOverlay.
  const firstLocationLoggedRef = useRef(false);

  useEffect(() => {
    if (!emergencySnap.isActive) {
      firstLocationLoggedRef.current = false;
      return;
    }
    if (locationSnap.location && !firstLocationLoggedRef.current) {
      firstLocationLoggedRef.current = true;
      const { latitude, longitude, accuracy } = locationSnap.location;
      emergencyManager.appendLog(
        `📍 Location: ${latitude.toFixed(5)}, ${longitude.toFixed(5)} (±${accuracy}m)`
      );
    }
    if (locationSnap.error) {
      emergencyManager.appendLog(`📍 GPS: ${locationSnap.error}`);
    }
  }, [locationSnap, emergencySnap.isActive]);

  // Log audio recording status changes
  const prevAudioStatus = useRef('idle');
  useEffect(() => {
    if (!emergencySnap.isActive) return;
    const s = recordingSnap.audioStatus;
    if (s === prevAudioStatus.current) return;
    prevAudioStatus.current = s;
    if (s === 'recording') emergencyManager.appendLog('🎙 Audio recording active');
    if (s === 'stopped')   emergencyManager.appendLog('🎙 Audio recording saved');
    if (s === 'error')     emergencyManager.appendLog(`🎙 Audio error: ${recordingSnap.audioError}`);
  }, [recordingSnap.audioStatus, recordingSnap.audioError, emergencySnap.isActive]);

  // Log video recording status changes
  const prevVideoStatus = useRef('idle');
  useEffect(() => {
    if (!emergencySnap.isActive) return;
    const s = recordingSnap.videoStatus;
    if (s === prevVideoStatus.current) return;
    prevVideoStatus.current = s;
    if (s === 'recording') emergencyManager.appendLog('📹 Video recording active');
    if (s === 'stopped')   emergencyManager.appendLog('📹 Video recording saved');
    if (s === 'error')     emergencyManager.appendLog(`📹 Video unavailable: ${recordingSnap.videoError}`);
  }, [recordingSnap.videoStatus, recordingSnap.videoError, emergencySnap.isActive]);

  /**
   * THE single SOS trigger. Called from:
   *   • SOSConfirmModal "Yes — Send Alert" button  (manual, with confirmation)
   *   • useTripleTap callback in HomePage          (direct, no confirmation)
   *
   * Must remain synchronous up to the point of calling getUserMedia so iOS
   * Safari's user-gesture requirement is satisfied.
   */
  const trigger = useCallback((source) => {
    haptics.emergencyTrigger();

    // 1. Update session state machine (synchronous)
    emergencyManager.trigger(source);

    // 2. Start GPS (synchronous — watchPosition doesn't require user gesture)
    locationService.start();
    emergencyManager.appendLog('📍 GPS tracking started');

    // 3. Start audio recording (async but MUST be called in same user-gesture
    //    stack. Do NOT await — let it proceed while UI updates.)
    emergencyManager.appendLog('🎙 Requesting microphone…');
    recordingService.startAudio(); // Promise — result logged via useEffect above

    // 4. Start video recording (same user-gesture requirement)
    emergencyManager.appendLog('📹 Requesting camera…');
    recordingService.startVideo(); // Promise — result logged via useEffect above

    // 5. TODO (Phase 3): alertService.notifyContacts(session)
    emergencyManager.appendLog('📡 Contacts will be notified (Phase 3)');

    servicesRunningRef.current = true;
  }, []);

  /** "I'm Safe" — stop recording gracefully (onstop fires, creates download URL) */
  const resolve = useCallback(() => {
    if (servicesRunningRef.current) {
      recordingService.stopAll();   // triggers onstop → creates blob URLs
      locationService.stop();
      servicesRunningRef.current = false;
    }
    emergencyManager.resolve();
  }, []);

  /** "False Alarm" — discard recordings, reset everything */
  const cancel = useCallback(() => {
    if (servicesRunningRef.current) {
      recordingService.reset();   // revokes blob URLs + stops streams
      locationService.reset();
      servicesRunningRef.current = false;
    }
    // Reset status refs so next session starts clean
    prevAudioStatus.current = 'idle';
    prevVideoStatus.current = 'idle';
    emergencyManager.cancel();
  }, []);

  const value = useMemo(
    () => ({
      // Session state
      isActive:      emergencySnap.isActive,
      activeSession: emergencySnap.activeSession,
      log:           emergencySnap.log,

      // Real-time location
      location:      locationSnap.location,
      locationStatus: locationSnap.status,
      locationError:  locationSnap.error,

      // Recording state
      audioStatus: recordingSnap.audioStatus,
      videoStatus: recordingSnap.videoStatus,
      audioUrl:    recordingSnap.audioUrl,
      videoUrl:    recordingSnap.videoUrl,
      audioMime:   recordingSnap.audioMime,
      videoMime:   recordingSnap.videoMime,
      audioError:  recordingSnap.audioError,
      videoError:  recordingSnap.videoError,
      recordingSupported: recordingSnap.isSupported,

      // Actions
      trigger,
      resolve,
      cancel,
    }),
    [emergencySnap, locationSnap, recordingSnap, trigger, resolve, cancel]
  );

  return <EmergencyContext.Provider value={value}>{children}</EmergencyContext.Provider>;
}

export function useEmergency() {
  const ctx = useContext(EmergencyContext);
  if (!ctx) throw new Error('useEmergency must be used within an EmergencyProvider');
  return ctx;
}
