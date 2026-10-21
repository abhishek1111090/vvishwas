import * as Location from 'expo-location';

/**
 * locationService.js — live GPS tracking (expo-location)
 *
 * Pub-sub singleton compatible with useSyncExternalStore.
 *
 * Honesty rules:
 *  • `location` is only ever set from a real position fix.
 *  • An error never clears the last real fix, but `status` becomes 'error'.
 *  • FOREGROUND ONLY — background location is blocked in app.json and not
 *    available in Expo Go, so it is never claimed.
 *
 * Battery: high-accuracy watching only runs during an active emergency;
 * the dashboard uses one balanced-accuracy fix (last known if recent).
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
  servicesDisabled: 'Location services are turned off. Turn on Location in your phone settings.',
  unavailable: 'Location signal unavailable. Move to an open area.',
  timeout: 'Location request timed out. Still trying…',
  unsupported: 'Location is not supported on this device.',
  unknown: 'Could not get your location.',
};

export function classifyLocationError(err) {
  const code = String(err?.code ?? '');
  const msg = String(err?.message ?? '').toLowerCase();
  if (code.includes('UNAUTHORIZED') || code.includes('PERMISSION') || msg.includes('denied') || msg.includes('not authorized')) {
    return LocationErrorKind.permissionDenied;
  }
  if (code.includes('SERVICES_DISABLED') || msg.includes('services are disabled') || msg.includes('turned off') || msg.includes('not enabled')) {
    return LocationErrorKind.servicesDisabled;
  }
  if (code.includes('TIMEOUT') || msg.includes('timeout') || msg.includes('timed out')) return LocationErrorKind.timeout;
  if (code.includes('UNAVAILABLE') || msg.includes('unavailable')) return LocationErrorKind.unavailable;
  return LocationErrorKind.unknown;
}

function toLocation(position) {
  const c = position?.coords;
  if (!c || !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return null;
  return {
    latitude: c.latitude,
    longitude: c.longitude,
    accuracy: Number.isFinite(c.accuracy) ? Math.round(c.accuracy) : null,
    speed: c.speed ?? null,
    heading: c.heading ?? null,
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
  location: null,
  error: null,
  errorKind: null,
  updateCount: 0,
  lastFixAt: null,
};

export function createLocationService(loc = Location) {
  let subscription = null;
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

  function _fail(kind) {
    _notify({ status: 'error', errorKind: kind, error: FRIENDLY[kind] });
  }

  /** Clear reasons up front instead of a vague plugin error. Returns an error kind or null. */
  async function preflight() {
    try {
      const perm = await loc.getForegroundPermissionsAsync();
      if (perm.status !== 'granted') return LocationErrorKind.permissionDenied;
      const enabled = await loc.hasServicesEnabledAsync();
      if (!enabled) return LocationErrorKind.servicesDisabled;
      return null;
    } catch (err) {
      return classifyLocationError(err);
    }
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
      return subscription !== null || starting;
    },

    /** Begin continuous high-accuracy tracking. No-op if already tracking. */
    async start() {
      if (subscription !== null || starting) return;
      starting = true;
      _notify({ status: snapshot.location ? 'tracking' : 'acquiring', error: null, errorKind: null });
      try {
        const problem = await preflight();
        if (problem) {
          _fail(problem);
          return;
        }
        const sub = await loc.watchPositionAsync(
          { accuracy: loc.Accuracy.BestForNavigation ?? loc.Accuracy.High, timeInterval: 3000, distanceInterval: 0 },
          _onFix,
          (reason) => _fail(classifyLocationError({ message: String(reason) }))
        );
        if (!starting) {
          sub.remove(); // stop() ran while we were starting
          return;
        }
        subscription = sub;
      } catch (err) {
        _fail(classifyLocationError(err));
      } finally {
        starting = false;
      }
    },

    async stop() {
      starting = false;
      if (subscription) {
        try { subscription.remove(); } catch { /* already removed */ }
        subscription = null;
      }
      _notify({ status: 'idle' });
    },

    async reset() {
      await this.stop();
      _notify({ ...INITIAL });
    },

    /** One-shot, battery-friendly fix for the dashboard. Never throws. */
    async getCurrent() {
      const problem = await preflight();
      if (problem) return { errorKind: problem, error: FRIENDLY[problem] };
      try {
        const recent = await loc.getLastKnownPositionAsync({ maxAge: 5 * 60_000, requiredAccuracy: 200 });
        const position = recent ?? (await loc.getCurrentPositionAsync({ accuracy: loc.Accuracy.Balanced }));
        const location = toLocation(position);
        if (!location) return { errorKind: LocationErrorKind.unavailable, error: FRIENDLY.unavailable };
        return { location };
      } catch (err) {
        const kind = classifyLocationError(err);
        return { errorKind: kind, error: FRIENDLY[kind] };
      }
    },

    /**
     * Wait (up to timeoutMs) for the first real fix. Gives up immediately
     * when location can't work at all, so an SOS alert isn't held back.
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
            resolve(snapshot.location);
          }
        });
      });
    },
  };
}

export const locationService = createLocationService();
