import { emergencyManager as defaultManager, SessionStatus } from './emergencyManager';
import { recordingService as defaultRecording } from './recordingService';
import { locationService as defaultLocation, LocationErrorKind } from './locationService';
import { alertService as defaultAlerts, buildAlertPayload, AlertStatus, ALERT_STATUS_LABEL } from './alertService';
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
 *        ├─ recordingService.startAudio/startVideo   (same call stack as the tap)
 *        ├─ locationService.start()                  (high-accuracy watch)
 *        ├─ notificationService.showEmergencyActive()
 *        └─ alertService.sendAutomatic()             (after first GPS fix or 15s)
 *
 *   resolve/cancel → stop GPS → flush + stop recorders → clear notification
 *                  → record REAL outcomes → manager.resolve()/cancel()
 *
 * Every device outcome is written to the session timeline as it really
 * happened (failures included). Nothing is marked successful on a guess.
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
  waitForFixMs = ALERT_WAIT_FOR_FIX_MS,
} = {}) {
  let context = { contacts: [], user: null };
  let watchers = [];
  let alertPromise = null;
  let endingPromise = null;

  function log(message, level) {
    manager.appendLog(message, level);
  }

  function activeId() {
    return manager.getSnapshot().activeSession?.id ?? null;
  }

  // ─── Watch device services and mirror real outcomes into the timeline ────

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

    watchers.push(
      alerts.onSmsStatus((evt) => {
        const session = manager.getSnapshot().activeSession;
        if (!session || evt?.requestId !== session.id || !session.alerts) return;
        const status = evt.status === 'delivered' ? AlertStatus.delivered : evt.status === 'deliveryFailed' ? AlertStatus.failed : null;
        if (!status) return;
        const recipients = session.alerts.recipients.map((r) =>
          r.phoneNumber === evt.phoneNumber ? { ...r, status, error: evt.error } : r
        );
        manager.update({ alerts: { ...session.alerts, recipients } });
        const name = recipients.find((r) => r.phoneNumber === evt.phoneNumber)?.name ?? evt.phoneNumber;
        log(status === AlertStatus.delivered ? `✉️ SMS delivered to ${name}` : `✉️ SMS delivery to ${name} failed`, status === AlertStatus.delivered ? 'success' : 'error');
      })
    );
  }

  function detachWatchers() {
    watchers.forEach((unsub) => { try { unsub(); } catch { /* already detached */ } });
    watchers = [];
  }

  // ─── Alerts ────────────────────────────────────────────────────────────────

  async function runAlerts(sessionId) {
    const contacts = context.contacts ?? [];
    if (contacts.length === 0) {
      manager.update({ alerts: { method: 'none', status: AlertStatus.noContacts, recipients: [] } });
      log('📡 No emergency contacts saved — nobody could be alerted. Add contacts in the Contacts tab.', 'error');
      return;
    }

    log(`📡 Preparing alert for ${contacts.length} contact${contacts.length === 1 ? '' : 's'}…`);
    const fix = await location.waitForFix(waitForFixMs);
    if (activeId() !== sessionId) return;
    if (!fix) log('📡 No GPS fix yet — sending alert without location', 'warning');

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

    const smsGranted = (await permissions.checkSms().catch(() => PermissionStatus.unavailable)) === PermissionStatus.granted;
    const result = await alerts.sendAutomatic(payload, { smsGranted });
    if (activeId() !== sessionId) return;

    manager.update({ alerts: result });
    if (result.serverError) log(`📡 Server alert failed: ${result.serverError}`, 'error');

    if (result.method === 'manual') {
      log('📡 Contacts NOT alerted automatically on this device. Tap "Text contacts" to send the SMS yourself.', 'error');
      return;
    }
    for (const r of result.recipients) {
      const label = ALERT_STATUS_LABEL[r.status] ?? r.status;
      const ok = r.status === AlertStatus.sent || r.status === AlertStatus.accepted || r.status === AlertStatus.delivered;
      log(`📡 ${r.name}: ${label}${r.error ? ` — ${r.error}` : ''}`, ok ? 'success' : 'error');
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  return {
    /** Keep the latest contacts/user so alerts use current data. */
    setContext(next) {
      context = { ...context, ...next };
    },

    /**
     * Start an emergency from a user action. Recording is started before
     * any await so iOS keeps the user-gesture context for getUserMedia.
     */
    startEmergency(source) {
      const result = manager.trigger(source);
      if (!result.started) return result;

      const { session } = result;
      haptics.emergencyTrigger();
      attachWatchers(session.id);

      log('🎙 Requesting microphone…');
      recording.startAudio(session.id);
      log('📹 Requesting camera…');
      recording.startVideo(session.id);

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

    /** Restore a session that was active when the app was killed. */
    restoreActiveSession() {
      const session = manager.restore();
      if (!session) return null;
      attachWatchers(session.id);
      location.start();
      notifications.showEmergencyActive(session);
      if (!recording.isBusy()) {
        log('🎙 Recording stopped when the app closed. Tap "Restart recording" to capture more evidence.', 'warning');
      }
      return session;
    },

    /** Restart recorders for the active session (e.g. after an interruption). */
    restartRecording() {
      const id = activeId();
      if (!id) return;
      const snap = recording.getSnapshot();
      if (snap.audio.status !== 'recording') recording.startAudio(id);
      if (snap.video.status !== 'recording') recording.startVideo(id);
      log('🎙 Restarting recording…');
    },

    /** Open the SMS composer prefilled for all contacts (user must press Send). */
    openSmsComposer(openUrl) {
      const session = manager.getSnapshot().activeSession;
      if (!session) return;
      const contacts = context.contacts ?? [];
      if (contacts.length === 0) {
        log('📡 No emergency contacts to text.', 'error');
        return;
      }
      const payload = buildAlertPayload({ session, location: session.location, contacts, user: context.user });
      alerts.openComposer(payload, openUrl);
      const prev = session.alerts?.recipients ?? [];
      manager.update({
        alerts: {
          ...(session.alerts ?? {}),
          method: session.alerts?.method === 'sms' || session.alerts?.method === 'server' ? session.alerts.method : 'composer',
          status: session.alerts?.status === AlertStatus.sent ? session.alerts.status : AlertStatus.composerOpened,
          message: payload.message,
          recipients: payload.contacts.map((c) => {
            const old = prev.find((r) => r.phoneNumber === c.phoneNumber);
            const keep = old && [AlertStatus.sent, AlertStatus.delivered, AlertStatus.accepted].includes(old.status);
            return keep ? old : { contactId: c.id, name: c.name, phoneNumber: c.phoneNumber, status: AlertStatus.composerOpened };
          }),
        },
      });
      log('✉️ SMS app opened with the alert — sending is only confirmed if you press Send there', 'warning');
    },

    /**
     * End the session. kind = 'resolve' (I'm safe) | 'cancel' (false alarm).
     * Recordings are kept in both cases — evidence is never deleted silently.
     */
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
            recordings[k] = { status: r.status, path: r.path ?? null, url: r.url ?? null, bytes: r.bytes ?? 0, mime: r.mime ?? '', error: r.error ?? null, interrupted: !!r.interrupted };
            const label = RECORDING_LABEL[k];
            if (r.status === 'saved') log(`${label} saved privately on this device (${formatBytes(r.bytes)})`, 'success');
            else if (r.status === 'ready') log(`${label} captured (${formatBytes(r.bytes)}) — browser only: download it before closing`, 'warning');
            else if (r.status === 'error') log(`${label} not saved: ${r.error}`, 'error');
          }
          manager.update({ recordings });

          await notifications.clearEmergencyActive();

          // Give an in-flight alert a moment to report its real outcome.
          if (alertPromise) await Promise.race([alertPromise, new Promise((r) => setTimeout(r, 3000))]);
        } catch (err) {
          log(`Cleanup error: ${err?.message ?? err}`, 'error');
        } finally {
          detachWatchers();
          alertPromise = null;
        }
        const ended = kind === 'resolve' ? manager.resolve() : manager.cancel();
        endingPromise = null;
        return ended;
      })();
      return endingPromise;
    },

    isEnding() {
      return manager.getSnapshot().activeSession?.status === SessionStatus.ending;
    },

    /** App lifecycle hook (background/foreground). */
    onAppStateChange(isActive) {
      if (!activeId()) return;
      if (!isActive) {
        log('App moved to background — the OS may pause camera recording until you return', 'warning');
      } else {
        log('App back in foreground');
        const snap = recording.getSnapshot();
        if (snap.audio.status !== 'recording' || snap.video.status !== 'recording') {
          log('Some recording is not running — tap "Restart recording" if needed', 'warning');
        }
      }
    },
  };
}

export const emergencyController = createEmergencyController();
