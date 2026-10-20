import { Geolocation } from '@capacitor/geolocation';

/**
 * locationService.js — Live GPS tracking
 *
 * Pub-sub singleton compatible with useSyncExternalStore.
 *
 * MOBILE: uses @capacitor/geolocation, which talks to the Fused Location
 * Provider on Android and CLLocationManager on iOS inside the native app,
 * and falls back to navigator.geolocation in a plain browser — so the same
 * calls work everywhere and only the error codes differ (classifyError()).
 *
 * Honesty rules:
 *  • `location` is only ever set from a real position fix.
 *  • An error never clears the last real fix, but `status` becomes 'error'
 *    and `lastFixAt` lets the UI show how old the coordinates are.
 *  • Tracking is FOREGROUND ONLY. Background tracking would need a
 *    foreground service (Android) and the "Always" permission + background
 *    mode (iOS) — neither is configured, so we never claim it.
 *
 * Battery: high-accuracy tracking only runs during an active emergency;
 * the dashboard uses a single low-accuracy fix with a cached position.
 */

export const LocationErrorKind = {
  permissionDenied: 'permissionDenied',
  servicesDisabled: 'servicesDisabled',
  unavailable: 'unavailable',
  timeout: 'timeout',
  unsupported: 'unsupported',
  unknown: 'unknown',
};

const FRIENDLY = {
  permissionDenied: 'Location permission denied. Allow location for VISHWAS in Settings.',
  servicesDisabled: 'Location services are turned off. Turn on Location in your device settings.',
  unavailable: 'Location signal unavailable. Move to an open area.',
  timeout: 'Location request timed out. Still trying…',
  unsupported: 'Location is not supported on this device.',
  unknown: 'Could not get your location.',
};

/** Map native plugin errors (OS-PLUG-GLOC-xxxx) and browser GeolocationPositionError codes. */
export function classifyLocationError(err) {
  const code = err?.code;
  const msg = String(err?.message ?? '').toLowerCase();
  if (code === 1 || code === 'OS-PLUG-GLOC-0003' || code === 'OS-PLUG-GLOC-0008' || msg.includes('denied')) {
    return LocationErrorKind.permissionDenied;
  }
  if (
    code === 'OS-PLUG-GLOC-0007' || code === 'OS-PLUG-GLOC-0009' || code === 'OS-PLUG-GLOC-0017' ||
    msg.includes('not enabled') || msg.includes('turned off') || msg.includes('disabled')
  ) {
    return LocationErrorKind.servicesDisabled;
  }
  if (code === 3 || code === 'OS-PLUG-GLOC-0010' || msg.includes('timeout') || msg.includes('in time')) {
    return LocationErrorKind.timeout;
  }
  if (code === 2 || code === 'OS-PLUG-GLOC-0002') return LocationErrorKind.unavailable;
  if (msg.includes('not supported') || msg.includes('not implemented')) return LocationErrorKind.unsupported;
  return LocationErrorKind.unknown;
}

function toLocation(position) {
  const c = position?.coords;
  if (!c || !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return null;
  return {
    latitude: c.latitude,
    longitude: c.longitude,
    accuracy: Number.isFinite(c.accuracy) ? Math.round(c.accuracy) : null, // metres
    speed: c.speed ?? null,           // m/s or null
    heading: c.heading ?? null,       // degrees or null
    altitude: c.altitude ?? null,
    timestamp: new Date(position.timestamp ?? Date.now()).toISOString(),
  };
}

export function mapsUrl(location) {
  if (!location) return null;
  return `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`;
}

const INITIAL = {
  status: 'idle',      // idle | acquiring | tracking | error
  location: null,      // last REAL fix only
  error: null,         // friendly message
  errorKind: null,
  updateCount: 0,
  lastFixAt: null,
};

export function createLocationService(geo = Geolocation) {
  let watchId = null;
  let starting = false;
  let snapshot = { ...INITIAL };
  const listeners = new Set();

  function _notify(patch) {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((l) => l());
  }

  function _onFix(position) {
    const location = toLocation(position);
    if (!location) return;
    _notify({
      status: 'tracking',
      error: null,
      errorKind: null,
      updateCount: snapshot.updateCount + 1,
      location,
      lastFixAt: location.timestamp,
    });
  }

  function _onError(err) {
    const kind = classifyLocationError(err);
    _notify({ status: 'error', errorKind: kind, error: FRIENDLY[kind] });
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSnapshot() {
      return snapshot;
    },

    isTracking() {
      return watchId !== null || starting;
    },

    /** Begin continuous high-accuracy tracking. No-op if already tracking. */
    async start() {
      if (watchId !== null || starting) return;
      starting = true;
      _notify({ status: snapshot.location ? 'tracking' : 'acquiring', error: null, errorKind: null });
      try {
        const id = await geo.watchPosition(
          { enableHighAccuracy: true, timeout: 20_000, maximumAge: 5_000, minimumUpdateInterval: 5_000 },
          (position, err) => {
            if (err) _onError(err);
            else if (position) _onFix(position);
          }
        );
        // stop() may have been called while watchPosition was resolving.
        if (!starting) {
          await geo.clearWatch({ id }).catch(() => {});
          return;
        }
        watchId = id;
      } catch (err) {
        _onError(err);
      } finally {
        starting = false;
      }
    },

    /** Stop the watcher; keeps the last fix so history/overlay can still show it. */
    async stop() {
      starting = false;
      const id = watchId;
      watchId = null;
      if (id !== null) {
        try {
          await geo.clearWatch({ id });
        } catch {
          // Watch already gone (e.g. plugin restarted) — nothing left to release.
        }
      }
      _notify({ status: 'idle' });
    },

    /** Stop + clear all stored location data. */
    async reset() {
      await this.stop();
      _notify({ ...INITIAL });
    },

    /**
     * One-shot, battery-friendly fix for the dashboard. Resolves to
     * { location } or { errorKind, error } — never throws.
     */
    async getCurrent({ highAccuracy = false } = {}) {
      try {
        const position = await geo.getCurrentPosition({
          enableHighAccuracy: highAccuracy,
          timeout: 15_000,
          maximumAge: 5 * 60_000,
        });
        const location = toLocation(position);
        if (!location) return { errorKind: LocationErrorKind.unavailable, error: FRIENDLY.unavailable };
        return { location };
      } catch (err) {
        const kind = classifyLocationError(err);
        return { errorKind: kind, error: FRIENDLY[kind] };
      }
    },

    /**
     * Wait (up to timeoutMs) for the first real fix of the current tracking
     * session. Gives up immediately when location can't work at all
     * (permission denied, services off, unsupported) so an SOS alert isn't
     * held back waiting for a fix that will never come.
     */
    waitForFix(timeoutMs = 15_000) {
      const hopeless = () =>
        snapshot.status === 'error' &&
        [LocationErrorKind.permissionDenied, LocationErrorKind.servicesDisabled, LocationErrorKind.unsupported]
          .includes(snapshot.errorKind);
      if (snapshot.location && snapshot.status === 'tracking') return Promise.resolve(snapshot.location);
      if (hopeless()) return Promise.resolve(snapshot.location);
      return new Promise((resolve) => {
        const timer = setTimeout(() => { unsub(); resolve(snapshot.location); }, timeoutMs);
        const unsub = this.subscribe(() => {
          if ((snapshot.location && snapshot.status === 'tracking') || hopeless()) {
            clearTimeout(timer);
            unsub();
            resolve(snapshot.location); // last real fix, or null
          }
        });
      });
    },
  };
}

export const locationService = createLocationService();
