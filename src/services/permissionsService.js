import { Geolocation } from '@capacitor/geolocation';
import { LocalNotifications } from '@capacitor/local-notifications';
import { isNative, isAndroid } from '../platform/platform';
import { VishwasNative } from '../platform/vishwasNative';

/**
 * permissionsService.js — permission checking and requesting
 *
 * NATIVE APP (Capacitor):
 *   • Location       → @capacitor/geolocation check/requestPermissions
 *   • Notifications  → @capacitor/local-notifications (POST_NOTIFICATIONS on Android 13+)
 *   • Camera / Mic   → app-local VishwasNative plugin (AVCaptureDevice on iOS,
 *                      CAMERA / RECORD_AUDIO runtime permissions on Android)
 *   • SMS (Android)  → VishwasNative (SEND_SMS) for automatic alert texts
 *   Checking never prompts. Requests show the real OS dialog. After a
 *   permanent denial the OS won't show the dialog again, so the UI offers
 *   openAppSettings() instead.
 *
 * BROWSER (development / optional PWA):
 *   • Permissions API where it exists. Where it doesn't (iOS Safari for
 *     camera/mic), we report notDetermined instead of probing with
 *     getUserMedia — probing used to pop up a permission prompt on page
 *     load, which is exactly when we should NOT ask.
 */

export const PermissionStatus = {
  notDetermined: 'notDetermined',  // never asked (or can ask again) — show "Allow"
  granted: 'granted',
  denied: 'denied',                // denied — on native, must go to Settings
  requesting: 'requesting',        // request in progress
  unavailable: 'unavailable',      // not supported on this platform / no hardware
};

/** Capacitor PermissionState → PermissionStatus */
export function fromCapacitorState(state) {
  switch (state) {
    case 'granted': return PermissionStatus.granted;
    case 'denied': return PermissionStatus.denied;
    case 'prompt':
    case 'prompt-with-rationale': return PermissionStatus.notDetermined;
    default: return PermissionStatus.unavailable;
  }
}

const SESSION_KEY_CAMERA = 'vishwas.perm.camera';
const SESSION_KEY_MIC    = 'vishwas.perm.microphone';

function readCache(key) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function writeCache(key, value) {
  try { sessionStorage.setItem(key, value); } catch { /* storage unavailable — cache is optional */ }
}

/** Try the Permissions API; return null if unsupported or throws. */
async function tryPermissionsQuery(name) {
  if (!navigator.permissions?.query) return null;
  try {
    const result = await navigator.permissions.query({ name });
    if (result.state === 'granted') return PermissionStatus.granted;
    if (result.state === 'denied')  return PermissionStatus.denied;
    return PermissionStatus.notDetermined;
  } catch {
    return null;  // Safari throws for unsupported names
  }
}

function mediaErrorToStatus(err) {
  if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError' || err?.name === 'SecurityError') {
    return PermissionStatus.denied;
  }
  if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') return PermissionStatus.unavailable;
  return PermissionStatus.notDetermined;
}

async function webRequestMedia(kind) {
  const key = kind === 'camera' ? SESSION_KEY_CAMERA : SESSION_KEY_MIC;
  if (!navigator.mediaDevices?.getUserMedia) return PermissionStatus.unavailable;
  try {
    const stream = await navigator.mediaDevices.getUserMedia(
      kind === 'camera' ? { video: { facingMode: { ideal: 'environment' } }, audio: false } : { audio: true, video: false }
    );
    stream.getTracks().forEach((t) => t.stop());
    writeCache(key, PermissionStatus.granted);
    return PermissionStatus.granted;
  } catch (err) {
    const status = mediaErrorToStatus(err);
    writeCache(key, status);
    return status;
  }
}

async function webCheckMedia(kind) {
  const key = kind === 'camera' ? SESSION_KEY_CAMERA : SESSION_KEY_MIC;
  if (!navigator.mediaDevices?.getUserMedia) return PermissionStatus.unavailable;
  const fromApi = await tryPermissionsQuery(kind === 'camera' ? 'camera' : 'microphone');
  if (fromApi) return fromApi;
  return readCache(key) ?? PermissionStatus.notDetermined;
}

async function nativeMedia(method, kind) {
  try {
    const result = await VishwasNative[method]({ permissions: [kind] });
    return fromCapacitorState(result?.[kind]);
  } catch {
    return PermissionStatus.unavailable;
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export const permissionsService = {
  // ─── Checks (never prompt) ────────────────────────────────────────────────

  async checkLocation() {
    try {
      const result = await Geolocation.checkPermissions();
      return fromCapacitorState(result.location);
    } catch (err) {
      // Web: thrown when the Permissions API or geolocation is missing.
      if (!isNative() && navigator.geolocation) return PermissionStatus.notDetermined;
      return String(err?.message ?? '').toLowerCase().includes('disabled')
        ? PermissionStatus.denied
        : PermissionStatus.unavailable;
    }
  },

  async checkCamera() {
    return isNative() ? nativeMedia('checkMediaPermissions', 'camera') : webCheckMedia('camera');
  },

  async checkMicrophone() {
    return isNative() ? nativeMedia('checkMediaPermissions', 'microphone') : webCheckMedia('microphone');
  },

  async checkNotifications() {
    if (isNative()) {
      try {
        return fromCapacitorState((await LocalNotifications.checkPermissions()).display);
      } catch {
        return PermissionStatus.unavailable;
      }
    }
    if (typeof Notification === 'undefined') return PermissionStatus.unavailable;
    const p = Notification.permission;
    if (p === 'granted') return PermissionStatus.granted;
    if (p === 'denied')  return PermissionStatus.denied;
    return PermissionStatus.notDetermined;
  },

  /** Automatic SMS alerts exist only in the Android app. */
  async checkSms() {
    if (!isAndroid()) return PermissionStatus.unavailable;
    try {
      return fromCapacitorState((await VishwasNative.checkSmsPermission()).sms);
    } catch {
      return PermissionStatus.unavailable;
    }
  },

  // ─── Requests (call from a user action) ───────────────────────────────────

  async requestLocation() {
    if (isNative()) {
      try {
        const result = await Geolocation.requestPermissions({ permissions: ['location'] });
        return fromCapacitorState(result.location);
      } catch (err) {
        // Thrown on Android when Location services are switched off entirely.
        return String(err?.message ?? '').toLowerCase().includes('disabled')
          ? PermissionStatus.denied
          : PermissionStatus.unavailable;
      }
    }
    // Browser: the only way to trigger the prompt is to ask for a position.
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(PermissionStatus.unavailable);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        () => resolve(PermissionStatus.granted),
        (err) => resolve(err.code === err.PERMISSION_DENIED ? PermissionStatus.denied : PermissionStatus.granted),
        { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 }
      );
    });
  },

  async requestCamera() {
    return isNative() ? nativeMedia('requestMediaPermissions', 'camera') : webRequestMedia('camera');
  },

  async requestMicrophone() {
    return isNative() ? nativeMedia('requestMediaPermissions', 'microphone') : webRequestMedia('microphone');
  },

  async requestNotifications() {
    if (isNative()) {
      try {
        return fromCapacitorState((await LocalNotifications.requestPermissions()).display);
      } catch {
        return PermissionStatus.unavailable;
      }
    }
    if (typeof Notification === 'undefined') return PermissionStatus.unavailable;
    try {
      const result = await Notification.requestPermission();
      if (result === 'granted') return PermissionStatus.granted;
      if (result === 'denied')  return PermissionStatus.denied;
      return PermissionStatus.notDetermined;
    } catch {
      return PermissionStatus.notDetermined;
    }
  },

  async requestSms() {
    if (!isAndroid()) return PermissionStatus.unavailable;
    try {
      return fromCapacitorState((await VishwasNative.requestSmsPermission()).sms);
    } catch {
      return PermissionStatus.unavailable;
    }
  },

  /** True when the app can send the user to its own page in system Settings. */
  canOpenSettings() {
    return isNative();
  },

  async openAppSettings() {
    await VishwasNative.openAppSettings();
  },
};
