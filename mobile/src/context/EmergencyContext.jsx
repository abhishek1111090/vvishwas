import {
  createContext, useContext, useSyncExternalStore, useMemo, useCallback, useEffect, useRef, useState,
} from 'react';
import { AppState } from 'react-native';
import { useAudioRecorder, RecordingPresets } from 'expo-audio';
import { emergencyManager } from '../services/emergencyManager';
import { emergencyController } from '../services/emergencyController';
import { recordingService } from '../services/recordingService';
import { locationService } from '../services/locationService';
import { voiceActivationService } from '../services/voiceActivationService';
import { cloudSync } from '../services/cloudSync';
import { contactsService } from '../services/contactsService';
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
  const { contacts, restoreContacts } = useContacts();
  const { currentUser } = useAuth();

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  useEffect(() => {
    recordingService.attachAudioRecorder(audioRecorder);
  }, [audioRecorder]);

  const emergencySnap = useSyncExternalStore(emergencyManager.subscribe, emergencyManager.getSnapshot);
  const recordingSnap = useSyncExternalStore(recordingService.subscribe, recordingService.getSnapshot);
  const locationSnap = useSyncExternalStore(locationService.subscribe, locationService.getSnapshot);
  const cameraAllowed = useSyncExternalStore(emergencyController.subscribeCamera, emergencyController.isCameraAllowed);
  const voice = useSyncExternalStore(voiceActivationService.subscribe, voiceActivationService.getSnapshot);

  // Voice SOS: the saved phrase triggers the SAME path as the SOS button.
  useEffect(() => {
    voiceActivationService.init((source) => emergencyController.startEmergency(source));
  }, []);

  // Server backup: send anything left over (app was closed or offline) once
  // signed in, plus past SOS events (and their recordings) kept only on this phone.
  // On a new phone, contacts and Voice SOS settings come back from the server.
  const serverUserId = currentUser?.authProvider === 'server' ? currentUser.id : null;
  const restoredFor = useRef(null);
  const [appDataReady, setAppDataReady] = useState(false);
  useEffect(() => {
    if (!currentUser) return;
    cloudSync.process();
    if (!serverUserId) return;
    cloudSync.backfillHistory(emergencyManager.getSnapshot().history);
    if (restoredFor.current === serverUserId) return;
    restoredFor.current = serverUserId;
    setAppDataReady(false);
    let alive = true;
    (async () => {
      const saved = await cloudSync.fetchAppData();
      if (!alive) return;
      if (saved?.contacts?.length && contactsService.getAll().length === 0) await restoreContacts(saved.contacts);
      const voiceSaved = saved?.settings?.voiceActivation;
      const voiceNow = voiceActivationService.getSnapshot();
      if (voiceSaved?.phrase && !voiceNow.phrase) voiceActivationService.save(voiceSaved);
      if (alive) setAppDataReady(true);
    })();
    return () => { alive = false; };
  }, [currentUser, serverUserId, restoreContacts]);

  // Keep the server copy of contacts + Voice SOS settings current (only sent when changed).
  useEffect(() => {
    if (!serverUserId || !appDataReady) return;
    cloudSync.backupAppData({ contacts, settings: { voiceActivation: { enabled: !!voice.enabled, phrase: voice.phrase ?? '' } } });
  }, [serverUserId, appDataReady, contacts, voice.enabled, voice.phrase]);

  // The SOS audio recording needs the microphone, so stop listening during an
  // emergency; resume a moment after it ends (the recorder releases the mic).
  useEffect(() => {
    if (emergencySnap.isActive) {
      voiceActivationService.pause('sos');
      return undefined;
    }
    const t = setTimeout(() => voiceActivationService.resume('sos'), 2500);
    return () => clearTimeout(t);
  }, [emergencySnap.isActive]);

  useEffect(() => {
    if (currentUser) voiceActivationService.resume('signedOut');
    else voiceActivationService.pause('signedOut');
  }, [currentUser]);

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
      if (state === 'background' && last !== 'background') {
        emergencyController.onAppStateChange(false);
        voiceActivationService.pause('background'); // the OS stops app speech recognition in the background
      }
      if (state === 'active' && last === 'background') {
        emergencyController.onAppStateChange(true);
        cloudSync.process();
        voiceActivationService.resume('background');
      }
      last = state;
    });
    return () => sub.remove();
  }, []);

  /**
   * THE single SOS trigger for UI code:
   *   • SOS confirm sheet "Yes — Send Alert" → trigger('button')
   *   • triple-tap in the tab shell           → trigger('tripleTap')
   *   • saved voice phrase heard              → startEmergency('voice')
   * All end in emergencyManager.trigger(source).
   */
  const trigger = useCallback((source) => emergencyController.startEmergency(source), []);
  const resolve = useCallback(() => emergencyController.endEmergency('resolve'), []);
  const cancel = useCallback(() => emergencyController.endEmergency('cancel'), []);
  const openSmsComposer = useCallback(() => emergencyController.openSmsComposer(), []);
  const restartRecording = useCallback(() => emergencyController.restartRecording(), []);
  const deleteHistoryItem = useCallback((id) => emergencyManager.deleteHistoryItem(id), []);
  const setConfirmedFloor = useCallback((value) => emergencyController.setConfirmedFloor(value), []);
  const changeCamera = useCallback((apply, description) => emergencyController.changeCamera(apply, description), []);
  const takePhoto = useCallback(() => emergencyController.takePhoto(), []);
  const saveVoice = useCallback((settings) => voiceActivationService.save(settings), []);
  const requestVoicePermission = useCallback(() => voiceActivationService.requestPermission(), []);
  const setVoiceTestMode = useCallback((on) => voiceActivationService.setTestMode(on), []);

  const value = useMemo(
    () => ({
      isActive: emergencySnap.isActive,
      isEnding: emergencySnap.activeSession?.status === 'ending',
      activeSession: emergencySnap.activeSession,
      log: emergencySnap.log,
      history: emergencySnap.history,
      persistFailed: !!emergencySnap.persistFailed,
      alerts: emergencySnap.activeSession?.alerts ?? null,

      address: emergencySnap.activeSession?.address ?? null,
      floor: emergencySnap.activeSession?.floor ?? null,
      location: locationSnap.location,
      locationStatus: locationSnap.status,
      locationError: locationSnap.error,

      audio: recordingSnap.audio,
      video: recordingSnap.video,
      photos: recordingSnap.photos ?? [],
      cameraAllowed,

      trigger,
      resolve,
      cancel,
      openSmsComposer,
      restartRecording,
      deleteHistoryItem,
      setConfirmedFloor,
      changeCamera,
      takePhoto,

      voice,
      voiceAvailable: voiceActivationService.isAvailable(),
      saveVoice,
      requestVoicePermission,
      setVoiceTestMode,
    }),
    [emergencySnap, locationSnap, recordingSnap, cameraAllowed, voice, trigger, resolve, cancel, openSmsComposer, restartRecording, deleteHistoryItem, setConfirmedFloor, changeCamera, takePhoto, saveVoice, requestVoicePermission, setVoiceTestMode]
  );

  return <EmergencyContext.Provider value={value}>{children}</EmergencyContext.Provider>;
}

export function useEmergency() {
  const ctx = useContext(EmergencyContext);
  if (!ctx) throw new Error('useEmergency must be used within an EmergencyProvider');
  return ctx;
}
