import { Platform } from 'react-native';
import { emergencyManager as defaultManager, SessionStatus } from './emergencyManager';
import { recordingService as defaultRecording } from './recordingService';
import { locationService as defaultLocation, LocationErrorKind } from './locationService';
import { alertService as defaultAlerts, buildAlertPayload, AlertStatus, ALERT_STATUS_LABEL, CONFIRMED_STATUSES, SKIPPED_STATUSES } from './alertService';
import { notificationService as defaultNotifications } from './notificationService';
import { permissionsService as defaultPermissions, PermissionStatus } from './permissionsService';
import { haptics as defaultHaptics } from './hapticService';
import { geoService as defaultGeo } from './geoService';
import { floorService as defaultFloor, floorLabel } from './floorService';
import { createEvidenceService } from './evidenceService';
import { cloudSync as defaultCloud, recordingsSoFar } from './cloudSync';

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
 *        └─ alerts, sent automatically to EVERY valid saved contact:
 *           server + SMS provider if configured (no tap needed, delivery
 *           reports polled); otherwise / for contacts the server couldn't
 *           reach, the Messages composer (opened automatically on iOS, by
 *           button on Android — neither OS lets an app send SMS silently)
 *
 *   endEmergency → stop GPS → stop recorders & save files → clear
 *                  notification → record REAL outcomes → resolve/cancel
 */

const RECORDING_LABEL = { audio: '🎙 Audio', video: '📹 Video' };
const ALERT_WAIT_FOR_FIX_MS = 15_000;
const DELIVERY_POLL_MS = 5_000;
const DELIVERY_POLL_FOR_MS = 3 * 60_000;
const LIVE_BACKUP_MS = 60_000; // save + upload the recording so far, so the emergency link shows it during the SOS

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
  geo = defaultGeo,
  floors = defaultFloor,
  platform = Platform.OS,
  waitForFixMs = ALERT_WAIT_FOR_FIX_MS,
  deliveryPollMs = DELIVERY_POLL_MS,
  evidenceFactory = createEvidenceService,
  cloud = defaultCloud,
  liveBackupMs = LIVE_BACKUP_MS,
} = {}) {
  let context = { contacts: [], user: null };
  let watchers = [];
  let alertPromise = null;
  let endingPromise = null;
  let composerOpen = false;
  let cameraAllowed = false;
  const cameraListeners = new Set();

  const log = (message, level) => manager.appendLog(message, level);
  // Audio/video clips → contacts on WhatsApp (only when the server has WhatsApp).
  const evidence = evidenceFactory({ recording, log });

  // ─── Live server backup of recordings (signed-in server accounts) ────────
  // Every liveBackupMs the recording so far is saved as a part (recording
  // continues) and queued for upload, so the emergency link shows video and
  // audio while the SOS is still running. WhatsApp evidence already saves a
  // part every 30 s; then only the upload is queued.
  let backupTimer = null;
  let backupTick = null;
  const canRotate = () => typeof recording.rotate === 'function' && typeof recording.getSnapshot === 'function';

  function backupFilesSoFar(id) {
    if (canRotate()) cloud.filesSaved?.(id, recordingsSoFar(recording.getSnapshot()));
  }

  function startLiveBackup(id) {
    if (!canRotate() || !cloud.filesSaved) return;
    clearInterval(backupTimer);
    backupTimer = setInterval(() => {
      if (activeId() !== id || backupTick) return;
      backupTick = (async () => {
        try {
          if (!evidence.isRunning()) await recording.rotate(id);
          if (activeId() === id) backupFilesSoFar(id);
        } catch {
          // A failed part save is logged by the recorder; the final save still runs.
        } finally {
          backupTick = null;
        }
      })();
    }, liveBackupMs);
  }

  async function stopLiveBackup() {
    clearInterval(backupTimer);
    backupTimer = null;
    if (backupTick) await backupTick;
  }

  // ─── Address (OpenStreetMap) + floor (barometer) ─────────────────────────
  let addressFor = null;      // location the current address was looked up for
  let addressLookupAt = 0;
  let addressInFlight = null;

  const metres = (a, b) => {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.latitude - a.latitude);
    const dLon = toRad(b.longitude - a.longitude);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };

  function lookupAddress(sessionId, loc) {
    if (addressInFlight) return addressInFlight;
    addressLookupAt = Date.now();
    addressInFlight = geo.reverseGeocode(loc).then((res) => {
      addressInFlight = null;
      if (activeId() !== sessionId) return;
      if (res.address) {
        const prev = manager.getSnapshot().activeSession?.address?.label;
        addressFor = loc;
        manager.update({ address: res.address });
        if (res.address.label !== prev) {
          log(`🏠 Address${res.address.source === 'openstreetmap' ? ' (OpenStreetMap)' : ''}: ${res.address.label}`);
        }
      } else if (!manager.getSnapshot().activeSession?.address) {
        log(`🏠 Address not available: ${res.error}`, 'warning');
      }
    });
    return addressInFlight;
  }

  /** Re-look-up the address when the person has moved, or the fix got much more precise. */
  function maybeRefreshAddress(sessionId, loc) {
    const since = Date.now() - addressLookupAt;
    const moved = !addressFor || metres(addressFor, loc) > 40;
    // The first fix is often rough; once GPS locks on, look the address up again.
    const sharper = !!addressFor && (addressFor.accuracy ?? Infinity) > 50 && (loc.accuracy ?? Infinity) <= (addressFor.accuracy ?? Infinity) / 2;
    if ((moved && since > 30_000) || (sharper && since > 5_000)) lookupAddress(sessionId, loc);
  }

  async function estimateFloor(sessionId, loc) {
    const res = await floors.estimate(loc);
    if (activeId() !== sessionId) return;
    const current = manager.getSnapshot().activeSession?.floor ?? {};
    if (res.estimate) {
      manager.update({ floor: { ...current, estimate: res.estimate, unavailable: null } });
      log(`🏢 Estimated ${floorLabel(res.estimate.floor)} (barometer, ±${res.estimate.uncertainty}). Confirm the floor on this screen for accuracy.`);
    } else {
      manager.update({ floor: { ...current, unavailable: res.unavailable } });
      log(`🏢 Floor not detected automatically: ${res.unavailable}. Set it on this screen.`, 'warning');
    }
  }
  const activeId = () => manager.getSnapshot().activeSession?.id ?? null;

  function setCameraAllowed(value) {
    cameraAllowed = value;
    cameraListeners.forEach((l) => l());
  }

  function attachWatchers(sessionId) {
    detachWatchers();
    addressFor = null;
    addressLookupAt = 0;
    addressInFlight = null;

    let lastLocKey = null;
    let firstFixLogged = false;
    watchers.push(
      location.subscribe(() => {
        if (activeId() !== sessionId) return;
        const s = location.getSnapshot();
        if (s.location && s.status === 'tracking') {
          const loc = s.location;
          const prev = manager.getSnapshot().activeSession?.location;
          if (!prev || prev.timestamp !== loc.timestamp) {
            manager.update({ location: loc });
            cloud.location(sessionId, loc); // throttled server backup (signed-in server accounts)
          }
          if (!firstFixLogged) {
            firstFixLogged = true;
            log(`📍 Location fixed: ${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)} (±${loc.accuracy}m)`);
          } else {
            maybeRefreshAddress(sessionId, loc);
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
    if (result.method === 'none') {
      log(`📡 Nobody alerted: ${result.error ?? 'no valid phone numbers'}. Check the numbers in the Contacts tab.`, 'error');
      return;
    }
    for (const r of result.recipients ?? []) {
      if (SKIPPED_STATUSES.includes(r.status)) log(`📡 ${r.name}: ${ALERT_STATUS_LABEL[r.status]} (${r.phoneNumber || 'no number'})`, 'warning');
    }
    if (result.method === 'server') {
      const live = result.recipients.filter((r) => !SKIPPED_STATUSES.includes(r.status));
      const sent = live.filter((r) => CONFIRMED_STATUSES.includes(r.status));
      log(`📡 Emergency SMS sent automatically to ${sent.length} of ${live.length} contact${live.length === 1 ? '' : 's'}`, sent.length === live.length ? 'success' : 'warning');
      live.filter((r) => r.status === AlertStatus.failed).forEach((r) => log(`📡 ${r.name}: not sent — ${r.error ?? 'failed'}`, 'error'));
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

    // Address + floor make the alert actionable; each step has its own
    // timeout, and together they never hold the alert back more than ~6 s.
    if (fix) {
      await Promise.race([
        Promise.all([lookupAddress(sessionId, fix), estimateFloor(sessionId, fix)]),
        new Promise((r) => setTimeout(r, 6000)),
      ]);
      if (activeId() !== sessionId) return;
    }

    const session = manager.getSnapshot().activeSession;
    const payload = buildAlertPayload({ session, location: fix, contacts, user: context.user });
    manager.update({
      alerts: {
        method: 'pending',
        status: AlertStatus.sending,
        recipients: [
          ...payload.contacts.map((c) => ({ contactId: c.id, name: c.name, phoneNumber: c.phoneNumber, status: AlertStatus.sending })),
          ...payload.skipped.map((c) => ({ contactId: c.id, name: c.name, phoneNumber: c.phoneNumber, status: c.status })),
        ],
        message: payload.message,
      },
    });

    const result = await alerts.sendAutomatic(payload);
    if (activeId() !== sessionId) return;
    manager.update({ alerts: result });
    logAlertResult(result);

    if (result.method === 'server') watchDelivery(sessionId);
    if (result.method === 'server' && result.whatsapp) evidence.start(sessionId);

    // Anyone still not reached (no server, server down, or a provider
    // failure for some contacts) gets the Messages fallback. iOS shows it as
    // a sheet over VISHWAS (recording continues), so open it straight away;
    // on Android it would background the app, so the user taps "Text contacts".
    if (platform === 'ios' && unreached(result.recipients).length > 0) {
      await controller.openSmsComposer();
    }
  }

  const unreached = (recipients = []) =>
    recipients.filter((r) => !CONFIRMED_STATUSES.includes(r.status) && !SKIPPED_STATUSES.includes(r.status));

  /** Poll the server for carrier delivery reports while the SOS is active. */
  function watchDelivery(sessionId) {
    const startedAt = Date.now();
    let busy = false;
    const id = setInterval(async () => {
      const current = manager.getSnapshot().activeSession?.alerts;
      const pending = (current?.recipients ?? []).some((r) => r.status === AlertStatus.sent);
      if (activeId() !== sessionId || !pending || Date.now() - startedAt > DELIVERY_POLL_FOR_MS) {
        clearInterval(id);
        return;
      }
      if (busy) return;
      busy = true;
      try {
        const res = await alerts.checkDelivery(sessionId, current.recipients);
        if (!res || activeId() !== sessionId) return;
        const before = new Map(current.recipients.map((r) => [r.contactId, r.status]));
        manager.update({ alerts: { ...manager.getSnapshot().activeSession.alerts, recipients: res.recipients, status: res.status } });
        for (const r of res.recipients) {
          if (before.get(r.contactId) === r.status) continue;
          if (r.status === AlertStatus.delivered) log(`📬 Delivered to ${r.name}`, 'success');
          else if (r.status === AlertStatus.failed) log(`📬 Not delivered to ${r.name}: ${r.error ?? 'carrier rejected it'}`, 'error');
        }
      } finally {
        busy = false;
      }
    }, deliveryPollMs);
    watchers.push(() => clearInterval(id));
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
      // Server backup; never delays the SOS. Its emergency link goes into the alert text.
      const backup = cloud.sosStarted(session, context.contacts ?? []);
      if (backup?.shareUrl) manager.update({ shareUrl: backup.shareUrl });
      if (backup) startLiveBackup(session.id);
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

    /** The person confirmed (or corrected) the floor they are on. null clears it. */
    setConfirmedFloor(value) {
      const session = manager.getSnapshot().activeSession;
      if (!session) return;
      manager.update({ floor: { ...(session.floor ?? {}), confirmed: value } });
      log(value === null ? '🏢 Floor confirmation cleared' : `🏢 Floor confirmed: ${floorLabel(value)}`, 'success');
    },

    /** The overlay's CameraView is mounted and ready. */
    onCameraReady() {
      const id = activeId();
      if (!id || manager.getSnapshot().activeSession?.status !== SessionStatus.active) return;
      const status = recording.getSnapshot().video.status;
      if (status === 'recording' || status === 'stopping') return;
      recording.startVideo(id);
    },

    /**
     * Switch camera (front/back or lens). A running video clip is saved
     * first; `apply` then changes the camera, and the new camera's
     * onCameraReady starts the next clip.
     */
    async changeCamera(apply, description) {
      const id = activeId();
      if (id && recording.getSnapshot().video.status === 'recording') {
        const clip = await recording.cutVideoClip();
        if (clip.status === 'saved') log(`📹 Switching to ${description} — video continues`, 'success');
        else if (clip.status === 'error') log(`📹 Video before the switch not saved: ${clip.error}`, 'error');
      } else if (id) {
        log(`📹 Switching to ${description}`);
      }
      apply();
    },

    /** Silent photo from the evidence camera. */
    async takePhoto() {
      const id = activeId();
      if (!id) return { status: 'error', error: 'No active emergency.' };
      const res = await recording.takePhoto(id);
      if (res.status === 'saved') {
        log(`📸 Photo saved privately (${formatBytes(res.bytes)}, ${res.facing} camera)`, 'success');
        backupFilesSoFar(id);
      }
      else if (res.status === 'error') log(`📸 Photo not taken: ${res.error}`, 'error');
      return res;
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
      // Only text the people who haven't been reached yet.
      const prevRecipients = session.alerts?.recipients;
      const todo = prevRecipients ? new Set(unreached(prevRecipients).map((r) => r.contactId)) : null;
      const targets = todo ? contacts.filter((c) => todo.has(c.id)) : contacts;
      if (targets.length === 0) {
        log('✉️ Every contact has already been sent the alert.', 'success');
        return;
      }
      composerOpen = true;
      try {
        const payload = buildAlertPayload({ session, location: location.getSnapshot?.().location ?? session.location, contacts: targets, user: context.user });
        log(`✉️ Opening Messages with the alert for ${payload.contacts.length} contact${payload.contacts.length === 1 ? '' : 's'}…`);
        const result = await alerts.sendViaComposer(payload);
        if (activeId() !== session.id) return;
        const prev = manager.getSnapshot().activeSession.alerts;
        let merged = result;
        if (prev?.recipients?.length) {
          // Match on contact id, or on the number when a result carries no id.
          const found = (r) => result.recipients.find((x) => (x.contactId != null ? x.contactId === r.contactId : x.phoneNumber === r.phoneNumber));
          const recipients = prev.recipients.map((r) => (todo?.has(r.contactId) && found(r) ? { ...r, ...found(r), contactId: r.contactId } : r));
          merged = { ...prev, recipients, smsStatus: result.status, status: prev.method === 'server' ? prev.status : result.status, method: prev.method === 'server' ? 'server' : result.method };
        }
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

          await stopLiveBackup();
          await evidence.stop();
          const results = await recording.stopAll();
          const recordings = {};
          for (const k of ['audio', 'video']) {
            const r = results[k];
            recordings[k] = { status: r.status, uri: r.uri ?? null, bytes: r.bytes ?? 0, error: r.error ?? null, interrupted: !!r.interrupted };
            if (k === 'audio' && (r.parts ?? []).length > 1) recordings.audio.parts = r.parts;
            if (k === 'video' && r.front) {
              recordings.video.front = (r.frontClips ?? []).length > 1 ? { ...r.front, status: 'saved', clips: r.frontClips } : r.front;
              if (r.front.status === 'saved') log(`🤳 Front-camera video saved privately (${formatBytes(r.front.bytes)})`, 'success');
              else log(`🤳 Front-camera video not saved: ${r.front.error}`, 'error');
            }
            if (k === 'video' && (r.clips ?? []).length > 0) {
              recordings.video.clips = r.clips;
              // An earlier clip was saved even if the last one failed.
              if (recordings.video.status !== 'saved') recordings.video = { ...recordings.video, status: 'saved', uri: r.clips[r.clips.length - 1].uri };
            }
            const label = RECORDING_LABEL[k];
            if (r.status === 'saved') log(`${label} saved privately on this phone (${formatBytes(r.bytes)})`, 'success');
            else if (r.status === 'error') log(`${label} not saved: ${r.error}`, 'error');
          }
          recordings.photos = results.photos ?? [];
          if (evidence.isRunning()) {
            const saved = (r) => (r?.status === 'saved' && r.uri ? { uri: r.uri, bytes: r.bytes ?? 0 } : null);
            await evidence.finish({ audio: saved(results.audio), video: saved(results.video), front: saved(results.video?.front) });
          }
          if (recordings.photos.length) log(`📸 ${recordings.photos.length} photo${recordings.photos.length === 1 ? '' : 's'} saved privately on this phone`, 'success');
          manager.update({ recordings });
          const endedSession = manager.getSnapshot().activeSession;
          cloud.sosEnded({
            clientId: endedSession.id,
            status: kind === 'resolve' ? 'resolved' : 'cancelled',
            endedAt: new Date().toISOString(),
            alertSummary: (endedSession.alerts?.recipients ?? []).map((r) => ({ contactId: r.contactId, status: r.status, whatsapp: r.whatsapp?.status ?? null })),
            recordings,
          });
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
