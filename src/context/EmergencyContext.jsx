import {
  createContext, useContext, useSyncExternalStore,
  useMemo, useCallback, useEffect, useRef,
} from 'react';
import { App as CapApp } from '@capacitor/app';
import { emergencyManager } from '../services/emergencyManager';
import { emergencyController } from '../services/emergencyController';
import { recordingService }  from '../services/recordingService';
import { locationService }   from '../services/locationService';
import { useContacts } from './ContactsContext';
import { useAuth } from './AuthContext';
import { isNative } from '../platform/platform';

/**
 * EmergencyContext — React bridge to the SOS system.
 *
 * Architecture:
 *   emergencyManager    — session state machine + persisted history
 *   emergencyController — orchestrates recording, GPS, alerts, notification
 *   recordingService    — audio + video MediaRecorder → app-private files
 *   locationService     — @capacitor/geolocation watch
 *
 * All expose subscribe/getSnapshot so React re-renders on any change, the
 * same behaviour SwiftUI's @Observable provided. Because the state lives
 * in those singletons (not in component state) an emergency survives
 * navigation and remounts, and the manager persists it across restarts.
 */

const EmergencyContext = createContext(null);

export function EmergencyProvider({ children }) {
  const { contacts } = useContacts();
  const { currentUser } = useAuth();

  const emergencySnap = useSyncExternalStore(emergencyManager.subscribe, emergencyManager.getSnapshot);
  const recordingSnap = useSyncExternalStore(recordingService.subscribe, recordingService.getSnapshot);
  const locationSnap = useSyncExternalStore(locationService.subscribe, locationService.getSnapshot);

  // Alerts always go to the CURRENT contact list and user.
  useEffect(() => {
    emergencyController.setContext({ contacts, user: currentUser });
  }, [contacts, currentUser]);

  // Restore a session that was active when the app was killed (once).
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    emergencyController.restoreActiveSession();
  }, []);

  // Background / foreground transitions during an emergency.
  useEffect(() => {
    if (!isNative()) return undefined;
    const handle = CapApp.addListener('appStateChange', ({ isActive }) => {
      emergencyController.onAppStateChange(isActive);
    });
    return () => {
      Promise.resolve(handle).then((h) => h.remove()).catch(() => {});
    };
  }, []);

  /**
   * THE single SOS trigger for UI code. Called from:
   *   • SOSConfirmModal "Yes — Send Alert"  → trigger('button')
   *   • useTripleTap in AppShell            → trigger('tripleTap')
   * Both end in emergencyManager.trigger(source).
   */
  const trigger = useCallback((source) => emergencyController.startEmergency(source), []);
  const resolve = useCallback(() => emergencyController.endEmergency('resolve'), []);
  const cancel = useCallback(() => emergencyController.endEmergency('cancel'), []);
  const openSmsComposer = useCallback(() => emergencyController.openSmsComposer(), []);
  const restartRecording = useCallback(() => emergencyController.restartRecording(), []);
  const deleteHistoryItem = useCallback((id) => emergencyManager.deleteHistoryItem(id), []);

  const value = useMemo(
    () => ({
      // Session state
      isActive:      emergencySnap.isActive,
      isEnding:      emergencySnap.activeSession?.status === 'ending',
      activeSession: emergencySnap.activeSession,
      log:           emergencySnap.log,
      history:       emergencySnap.history,
      persistFailed: !!emergencySnap.persistFailed,
      alerts:        emergencySnap.activeSession?.alerts ?? null,

      // Real-time location
      location:       locationSnap.location,
      locationStatus: locationSnap.status,
      locationError:  locationSnap.error,

      // Recording state
      audio: recordingSnap.audio,
      video: recordingSnap.video,
      audioStatus: recordingSnap.audio.status,
      videoStatus: recordingSnap.video.status,
      recordingSupported: recordingSnap.isSupported,

      // Actions
      trigger,
      resolve,
      cancel,
      openSmsComposer,
      restartRecording,
      deleteHistoryItem,
    }),
    [emergencySnap, locationSnap, recordingSnap, trigger, resolve, cancel, openSmsComposer, restartRecording, deleteHistoryItem]
  );

  return <EmergencyContext.Provider value={value}>{children}</EmergencyContext.Provider>;
}

export function useEmergency() {
  const ctx = useContext(EmergencyContext);
  if (!ctx) throw new Error('useEmergency must be used within an EmergencyProvider');
  return ctx;
}
