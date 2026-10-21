import { Platform } from 'react-native';
import { emergencyManager as defaultManager, SessionStatus } from './emergencyManager';
import { recordingService as defaultRecording } from './recordingService';
import { locationService as defaultLocation, LocationErrorKind } from './locationService';
import { alertService as defaultAlerts, buildAlertPayload, AlertStatus, ALERT_STATUS_LABEL, CONFIRMED_STATUSES } from './alertService';
import { notificationService as defaultNotifications } from './notificationService';
import { permissionsService as defaultPermissions, PermissionStatus } from './permissionsService';
import { haptics as defaultHaptics } from './hapticService';

/**
 * emergencyController.js — orchestrates one SOS session
 *
 *   UI (SOS confirm / triple-tap)
 *        │  startEmergency(source)
 *        ▼
 *   emergencyManager.trigger(source)   ← canonical, refuses duplicates
 *        │ started?
 *        ├─ recordingService.startAudio
 *        ├─ camera permission → overlay mounts CameraView → onCameraReady → startVideo
 *        ├─ locationService.start()                  (high accuracy, foreground)
 *        ├─ notificationService.showEmergencyActive()
 *        └─ alerts: server if configured; otherwise Messages composer
 *           (opened automatically on iOS, by button on Android)
 *
 *   endEmergency → stop GPS → stop recorders & save files → clear
 *                  notification → record REAL outcomes → resolve/cancel
 */

const RECORDING_LABEL = { audio: '🎙 Audio', video: '📹 Video' };
const ALERT_WAIT_FOR_FIX_MS = 15_000;

function formatBytes(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function createEmergencyController({
  manager = defaultManager,
  recording = defaultRecording,
  location = defaultLocation,
  alerts = defaultAlerts,
  notifications = defaultNotifications,
  permissions = defaultPermissions,
  haptics = defaultHaptics,
  platform = Platform.OS,
  waitForFixMs = ALERT_WAIT_FOR_FIX_MS,
} = {}) {
  let context = { contacts: [], user: null };
  let watchers = [];
  let alertPromise = null;
  let endingPromise = null;
  let composerOpen = false;
  let cameraAllowed = false;
  const cameraListeners = new Set();

  const log = (message, level) => manager.appendLog(message, level);
  const activeId = () => manager.getSnapshot().activeSession?.id ?? null;

  function setCameraAllowed(value) {
    cameraAllowed = value;
    cameraListeners.forEach((l) => l());
  }

  function attachWatchers(sessionId) {
    detachWatchers();

    let lastLocKey = null;
    let firstFixLogged = false;
    watchers.push(
      location.subscribe(() => {
        if (activeId() !== sessionId) return;
        const s = location.getSnapshot();
        if (s.location && s.status === 'tracking') {
          const loc = s.location;
          const prev = manager.getSnapshot().activeSession?.location;
          if (!prev || prev.timestamp !== loc.timestamp) manager.update({ location: loc });
          if (!firstFixLogged) {
            firstFixLogged = true;
            log(`📍 Location fixed: ${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)} (±${loc.accuracy}m)`);
          }
          lastLocKey = null;
        } else if (s.status === 'error' && s.errorKind !== lastLocKey) {
          lastLocKey = s.errorKind;
          log(`📍 ${s.error}`, s.errorKind === LocationErrorKind.timeout ? 'warning' : 'error');
        }
      })
    );

    const lastRec = { audio: null, video: null };
    watchers.push(
      recording.subscribe(() => {
        if (activeId() !== sessionId) return;
        const snap = recording.getSnapshot();
        for (const kind of ['audio', 'video']) {
          const k = snap[kind];
          const key = `${k.status}|${k.interrupted}`;
          if (key === lastRec[kind]) continue;
          lastRec[kind] = key;
          const label = RECORDING_LABEL[kind];
          if (k.status === 'recording') log(`${label} recording started`);
          if (k.status === 'error') log(`${label} not recording: ${k.error}`, 'error');
          if (k.interrupted && k.status !== 'recording') log(`${label} recording was interrupted by the system`, 'warning');
        }
      })
    );
  }

  function detachWatchers() {
    watchers.forEach((unsub) => { try { unsub(); } catch { /* already detached */ } });
    watchers = [];
  }

  function logAlertResult(result) {
    if (result.serverError) log(`📡 Server alert failed: ${result.serverError}`, 'error');
    if (result.status === AlertStatus.noContacts) {
      log('📡 No emergency contacts saved — nobody could be alerted. Add contacts in the Contacts tab.', 'error');
      return;
    }
    if (result.method === 'manual') {
      log(platform === 'ios'
        ? '📡 Contacts not alerted yet — opening Messages so you can send the alert.'
        : '📡 Contacts NOT alerted yet. Tap "Text contacts" to send the SMS.', 'error');
      return;
    }
    const label = ALERT_STATUS_LABEL[result.status] ?? result.status;
    const ok = CONFIRMED_STATUSES.includes(result.status);
    log(`📡 ${result.method === 'server' ? 'Server' : 'SMS'}: ${label}`, ok ? 'success' : 'warning');
  }

  async function runAlerts(sessionId) {
    const contacts = context.contacts ?? [];
    if (contacts.length === 0) {
      const result = { method: 'none', status: AlertStatus.noContacts, recipients: [] };
      manager.update({ alerts: result });
      logAlertResult(result);
      return;
    }

    log(`📡 Preparing alert for ${contacts.length} contact${contacts.length === 1 ? '' : 's'}…`);
    const fix = await location.waitForFix(waitForFixMs);
    if (activeId() !== sessionId) return;
    if (!fix) log('📡 No GPS fix yet — alert will not include a location', 'warning');

    const session = manager.getSnapshot().activeSession;
    const payload = buildAlertPayload({ session, location: fix, contacts, user: context.user });
    manager.update({
      alerts: {
        method: 'pending',
        status: AlertStatus.sending,
        recipients: payload.contacts.map((c) => ({ contactId: c.id, name: c.name, phoneNumber: c.phoneNumber, status: AlertStatus.sending })),
        message: payload.message,
      },
    });

    const result = await alerts.sendAutomatic(payload);
    if (activeId() !== sessionId) return;
    manager.update({ alerts: result });
    logAlertResult(result);

    // iOS shows Messages as a sheet over VISHWAS (recording continues), so
    // open it straight away. On Android it would background the app, so the
    // user taps "Text contacts" instead.
    if (result.method === 'manual' && platform === 'ios') {
      await controller.openSmsComposer();
    }
  }

  const controller = {
    setContext(next) {
      context = { ...context, ...next };
    },

    /** Whether the overlay should mount the evidence camera. */
    isCameraAllowed: () => cameraAllowed,
    subscribeCamera(listener) {
      cameraListeners.add(listener);
      return () => cameraListeners.delete(listener);
    },

    startEmergency(source) {
      const result = manager.trigger(source);
      if (!result.started) return result;

      const { session } = result;
      haptics.emergencyTrigger();
      attachWatchers(session.id);

      log('🎙 Requesting microphone…');
      recording.startAudio(session.id);

      log('📹 Requesting camera…');
      permissions.request('camera').then((status) => {
        if (activeId() !== session.id) return;
        if (status === PermissionStatus.granted) setCameraAllowed(true);
        else log(`📹 Video not recording: camera permission ${status === PermissionStatus.unavailable ? 'unavailable' : 'denied'}`, 'error');
      });

      log('📍 Starting live location…');
      location.reset().then(() => location.start());

      notifications.showEmergencyActive(session).then((n) => {
        if (!n.shown && n.reason === 'permission') log('🔔 Status notification off (notification permission not granted)', 'warning');
      });

      alertPromise = runAlerts(session.id).catch((err) => {
        log(`📡 Alert error: ${err?.message ?? err}`, 'error');
      });

      return result;
    },

    /** The overlay's CameraView is mounted and ready. */
    onCameraReady() {
      const id = activeId();
      if (!id || manager.getSnapshot().activeSession?.status !== SessionStatus.active) return;
      const status = recording.getSnapshot().video.status;
      if (status === 'recording' || status === 'stopping') return;
      recording.startVideo(id);
    },

    onCameraError(message) {
      if (activeId()) log(`📹 Camera error: ${message}`, 'error');
    },

    restoreActiveSession() {
      const session = manager.restore();
      if (!session) return null;
      attachWatchers(session.id);
      location.start();
      notifications.showEmergencyActive(session);
      permissions.check('camera').then((s) => setCameraAllowed(s === PermissionStatus.granted));
      log('🎙 Recording stopped when the app closed. Tap "Restart recording" to capture more evidence.', 'warning');
      return session;
    },

    restartRecording() {
      const id = activeId();
      if (!id) return;
      const snap = recording.getSnapshot();
      log('🎙 Restarting recording…');
      if (snap.audio.status !== 'recording') recording.startAudio(id);
      if (snap.video.status !== 'recording' && recording.isCameraAttached()) recording.startVideo(id);
    },

    /** Open Messages prefilled for all contacts and record the REAL outcome. */
    async openSmsComposer() {
      const session = manager.getSnapshot().activeSession;
      if (!session || composerOpen) return;
      const contacts = context.contacts ?? [];
      if (contacts.length === 0) {
        log('📡 No emergency contacts to text.', 'error');
        return;
      }
      composerOpen = true;
      try {
        const payload = buildAlertPayload({ session, location: session.location, contacts, user: context.user });
        log('✉️ Opening Messages with the alert…');
        const result = await alerts.sendViaComposer(payload);
        if (activeId() !== session.id) return;
        const prev = manager.getSnapshot().activeSession.alerts;
        const merged = prev?.method === 'server' && prev.status === AlertStatus.accepted
          ? { ...prev, smsStatus: result.status }
          : result;
        manager.update({ alerts: merged });
        const label = ALERT_STATUS_LABEL[result.status] ?? result.status;
        log(`✉️ SMS: ${label}`, result.status === AlertStatus.sentByUser ? 'success' : 'warning');
      } finally {
        composerOpen = false;
      }
    },

    endEmergency(kind) {
      if (endingPromise) return endingPromise;
      if (!manager.beginEnding()) return Promise.resolve(null);

      endingPromise = (async () => {
        try {
          log(kind === 'resolve' ? 'Ending emergency — saving recordings…' : 'Cancelling — stopping recording and tracking…');
          await location.stop();

          const results = await recording.stopAll();
          const recordings = {};
          for (const k of ['audio', 'video']) {
            const r = results[k];
            recordings[k] = { status: r.status, uri: r.uri ?? null, bytes: r.bytes ?? 0, error: r.error ?? null, interrupted: !!r.interrupted };
            const label = RECORDING_LABEL[k];
            if (r.status === 'saved') log(`${label} saved privately on this phone (${formatBytes(r.bytes)})`, 'success');
            else if (r.status === 'error') log(`${label} not saved: ${r.error}`, 'error');
          }
          manager.update({ recordings });
          setCameraAllowed(false);

          await notifications.clearEmergencyActive();
          if (alertPromise) await Promise.race([alertPromise, new Promise((r) => setTimeout(r, 3000))]);
        } catch (err) {
          log(`Cleanup error: ${err?.message ?? err}`, 'error');
        } finally {
          detachWatchers();
          alertPromise = null;
        }
        const ended = kind === 'resolve' ? manager.resolve() : manager.cancel();
        recording.reset();
        endingPromise = null;
        return ended;
      })();
      return endingPromise;
    },

    onAppStateChange(isActive) {
      if (!activeId()) return;
      if (!isActive) {
        log('App moved to background — the phone may pause camera and microphone until you return', 'warning');
      } else {
        log('App back in foreground');
        const snap = recording.getSnapshot();
        if (snap.audio.status !== 'recording' || snap.video.status !== 'recording') {
          log('Some recording is not running — tap "Restart recording" if needed', 'warning');
        }
      }
    },
  };

  return controller;
}

export const emergencyController = createEmergencyController();
