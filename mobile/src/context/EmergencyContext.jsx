import {
  createContext, useContext, useSyncExternalStore, useMemo, useCallback, useEffect, useRef,
} from 'react';
import { AppState } from 'react-native';
import { useAudioRecorder, RecordingPresets } from 'expo-audio';
import { emergencyManager } from '../services/emergencyManager';
import { emergencyController } from '../services/emergencyController';
import { recordingService } from '../services/recordingService';
import { locationService } from '../services/locationService';
import { useContacts } from './ContactsContext';
import { useAuth } from './AuthContext';

/**
 * EmergencyContext — React bridge to the SOS system.
 *
 * The state lives in plain singletons (emergencyManager, recordingService,
 * locationService) so an emergency survives navigation and remounts;
 * emergencyManager also persists it across app restarts. This provider
 * owns the expo-audio recorder (a hook) and hands it to recordingService.
 */

const EmergencyContext = createContext(null);

export function EmergencyProvider({ children }) {
  const { contacts } = useContacts();
  const { currentUser } = useAuth();

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  useEffect(() => {
    recordingService.attachAudioRecorder(audioRecorder);
  }, [audioRecorder]);

  const emergencySnap = useSyncExternalStore(emergencyManager.subscribe, emergencyManager.getSnapshot);
  const recordingSnap = useSyncExternalStore(recordingService.subscribe, recordingService.getSnapshot);
  const locationSnap = useSyncExternalStore(locationService.subscribe, locationService.getSnapshot);
  const cameraAllowed = useSyncExternalStore(emergencyController.subscribeCamera, emergencyController.isCameraAllowed);

  useEffect(() => {
    emergencyController.setContext({ contacts, user: currentUser });
  }, [contacts, currentUser]);

  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    emergencyController.restoreActiveSession();
  }, []);

  // Only real background/foreground moves — 'inactive' also fires when the
  // Messages sheet or a permission dialog is shown over the app.
  useEffect(() => {
    let last = AppState.currentState;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' && last !== 'background') emergencyController.onAppStateChange(false);
      if (state === 'active' && last === 'background') emergencyController.onAppStateChange(true);
      last = state;
    });
    return () => sub.remove();
  }, []);

  /**
   * THE single SOS trigger for UI code:
   *   • SOS confirm sheet "Yes — Send Alert" → trigger('button')
   *   • triple-tap in the tab shell           → trigger('tripleTap')
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
      isActive: emergencySnap.isActive,
      isEnding: emergencySnap.activeSession?.status === 'ending',
      activeSession: emergencySnap.activeSession,
      log: emergencySnap.log,
      history: emergencySnap.history,
      persistFailed: !!emergencySnap.persistFailed,
      alerts: emergencySnap.activeSession?.alerts ?? null,

      location: locationSnap.location,
      locationStatus: locationSnap.status,
      locationError: locationSnap.error,

      audio: recordingSnap.audio,
      video: recordingSnap.video,
      cameraAllowed,

      trigger,
      resolve,
      cancel,
      openSmsComposer,
      restartRecording,
      deleteHistoryItem,
    }),
    [emergencySnap, locationSnap, recordingSnap, cameraAllowed, trigger, resolve, cancel, openSmsComposer, restartRecording, deleteHistoryItem]
  );

  return <EmergencyContext.Provider value={value}>{children}</EmergencyContext.Provider>;
}

export function useEmergency() {
  const ctx = useContext(EmergencyContext);
  if (!ctx) throw new Error('useEmergency must be used within an EmergencyProvider');
  return ctx;
}
