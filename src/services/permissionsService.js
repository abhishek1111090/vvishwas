/**
 * permissionsService.js — Safari-compatible permission checking and requesting
 *
 * THE CORE SAFARI PROBLEM:
 *   navigator.permissions.query({name:'camera'})  → throws NotSupportedError on all iOS Safari
 *   navigator.permissions.query({name:'microphone'}) → throws on all iOS Safari
 *   navigator.permissions.query({name:'notifications'}) → throws on some iOS Safari versions
 *   Only 'geolocation' works reliably across browsers.
 *
 * SOLUTION:
 *   Camera / Microphone:
 *     • There is NO way to silently check these on Safari without asking the user.
 *     • We cache the result in sessionStorage after each request so subsequent
 *       checks within the same session return the cached result immediately.
 *     • On page reload, we attempt a silent probe using a 0-second getUserMedia
 *       call — if it rejects with NotAllowedError, permission is denied; if it
 *       resolves, permission is granted (stream is stopped immediately).
 *
 *   Geolocation:
 *     • Use Permissions API where supported, probe via getCurrentPosition elsewhere.
 *
 *   Notifications:
 *     • Read Notification.permission directly (works cross-browser).
 */

export const PermissionStatus = {
  notDetermined: 'notDetermined',  // never asked — show "Allow" button
  granted: 'granted',
  denied: 'denied',
  requesting: 'requesting',        // async check / request in progress
};

const SESSION_KEY_CAMERA = 'vishwas.perm.camera';
const SESSION_KEY_MIC    = 'vishwas.perm.microphone';

function readCache(key) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function writeCache(key, value) {
  try { sessionStorage.setItem(key, value); } catch { /* ignore */ }
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

/**
 * Silently probe camera or microphone by briefly calling getUserMedia.
 * Stops the stream immediately — user never sees a live feed.
 */
async function probeMediaPermission(kind) {
  if (!navigator.mediaDevices?.getUserMedia) return PermissionStatus.notDetermined;
  const constraints = kind === 'camera'
    ? { video: { width: 1, height: 1 }, audio: false }
    : { audio: true, video: false };
  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    stream.getTracks().forEach((t) => t.stop());
    return PermissionStatus.granted;
  } catch (err) {
    if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
      return PermissionStatus.denied;
    }
    // NotFoundError (no camera) or other — treat as not determined
    return PermissionStatus.notDetermined;
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export const permissionsService = {

  async checkCamera() {
    const cached = readCache(SESSION_KEY_CAMERA);
    if (cached) return cached;

    // Try standard Permissions API (works in Chrome/Firefox)
    const fromApi = await tryPermissionsQuery('camera');
    if (fromApi) { writeCache(SESSION_KEY_CAMERA, fromApi); return fromApi; }

    // Safari fallback: silent probe
    // NOTE: this may show a permission prompt on some iOS versions if never asked.
    // We only call this on initial status check — if it prompts, it prompts once.
    const probed = await probeMediaPermission('camera');
    writeCache(SESSION_KEY_CAMERA, probed);
    return probed;
  },

  async checkMicrophone() {
    const cached = readCache(SESSION_KEY_MIC);
    if (cached) return cached;

    const fromApi = await tryPermissionsQuery('microphone');
    if (fromApi) { writeCache(SESSION_KEY_MIC, fromApi); return fromApi; }

    const probed = await probeMediaPermission('microphone');
    writeCache(SESSION_KEY_MIC, probed);
    return probed;
  },

  async checkLocation() {
    const fromApi = await tryPermissionsQuery('geolocation');
    if (fromApi) return fromApi;

    // Fallback: if geolocation exists assume notDetermined (can't probe without prompting)
    return navigator.geolocation ? PermissionStatus.notDetermined : PermissionStatus.denied;
  },

  async checkNotifications() {
    if (typeof Notification === 'undefined') return PermissionStatus.denied;
    const p = Notification.permission;
    if (p === 'granted') return PermissionStatus.granted;
    if (p === 'denied')  return PermissionStatus.denied;
    return PermissionStatus.notDetermined;
  },

  // ─── Request methods (must be called from a user-gesture handler) ─────────

  /**
   * Request camera permission via getUserMedia. Shows the browser's permission
   * prompt on first call; on subsequent calls returns the cached result immediately.
   */
  async requestCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      stream.getTracks().forEach((t) => t.stop());
      writeCache(SESSION_KEY_CAMERA, PermissionStatus.granted);
      return PermissionStatus.granted;
    } catch (err) {
      const status = (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError')
        ? PermissionStatus.denied
        : PermissionStatus.notDetermined;
      writeCache(SESSION_KEY_CAMERA, status);
      return status;
    }
  },

  async requestMicrophone() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      stream.getTracks().forEach((t) => t.stop());
      writeCache(SESSION_KEY_MIC, PermissionStatus.granted);
      return PermissionStatus.granted;
    } catch (err) {
      const status = (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError')
        ? PermissionStatus.denied
        : PermissionStatus.notDetermined;
      writeCache(SESSION_KEY_MIC, status);
      return status;
    }
  },

  requestLocation() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(PermissionStatus.denied);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        () => resolve(PermissionStatus.granted),
        (err) => {
          if (err.code === err.PERMISSION_DENIED) resolve(PermissionStatus.denied);
          else resolve(PermissionStatus.notDetermined);
        },
        { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 }
      );
    });
  },

  async requestNotifications() {
    if (typeof Notification === 'undefined') return PermissionStatus.denied;
    try {
      const result = await Notification.requestPermission();
      if (result === 'granted') return PermissionStatus.granted;
      if (result === 'denied')  return PermissionStatus.denied;
      return PermissionStatus.notDetermined;
    } catch {
      return PermissionStatus.notDetermined;
    }
  },
};
