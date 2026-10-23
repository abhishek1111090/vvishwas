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
 * Battery: continuous high-accuracy watching only runs during an active
 * emergency; the dashboard takes a fresh high-accuracy fix now and then.
 *
 * Accuracy: a phone's FIRST fix is often a rough Wi-Fi/cell estimate
 * (±65 m to several km). Anything that has to be precise waits a few
 * seconds for a GPS-grade fix and otherwise uses the best one it saw.
 */

/** A fix at or below this radius is treated as GPS-grade. */
export const GOOD_ACCURACY_M = 25;
/** Above this radius the phone is probably giving an approximate location (iOS "Precise Location" off). */
export const COARSE_ACCURACY_M = 200;

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
  // 6 decimals ≈ 0.1 m — more digits only make the SMS longer.
  const r = (n) => Number(n.toFixed(6));
  return `https://www.google.com/maps/search/?api=1&query=${r(location.latitude)},${r(location.longitude)}`;
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

    /**
     * One-shot fix for the dashboard. Uses the last known position only if
     * it is under a minute old AND precise; otherwise asks for a fresh
     * high-accuracy fix. Never throws.
     */
    async getCurrent() {
      const problem = await preflight();
      if (problem) return { errorKind: problem, error: FRIENDLY[problem] };
      try {
        const recent = await loc.getLastKnownPositionAsync({ maxAge: 60_000, requiredAccuracy: 50 });
        const position = recent ?? (await loc.getCurrentPositionAsync({ accuracy: loc.Accuracy.High }));
        const location = toLocation(position);
        if (!location) return { errorKind: LocationErrorKind.unavailable, error: FRIENDLY.unavailable };
        return { location };
      } catch (err) {
        const kind = classifyLocationError(err);
        return { errorKind: kind, error: FRIENDLY[kind] };
      }
    },

    /**
     * Wait for a usable fix for the SOS alert:
     *  • resolves at once with a GPS-grade fix (±GOOD_ACCURACY_M or better);
     *  • otherwise keeps the most accurate fix seen and resolves with it
     *    `settleMs` after the first fix (a rough first fix is not sent while
     *    GPS is still locking on);
     *  • resolves with whatever exists after `timeoutMs`, and immediately
     *    when location can't work at all, so the alert is never held back.
     */
    waitForFix(timeoutMs = 15_000, { settleMs = 6000 } = {}) {
      const hopeless = () =>
        snapshot.status === 'error' &&
        [LocationErrorKind.permissionDenied, LocationErrorKind.servicesDisabled, LocationErrorKind.unsupported]
          .includes(snapshot.errorKind);
      const precise = (l) => l && Number.isFinite(l.accuracy) && l.accuracy <= GOOD_ACCURACY_M;
      const better = (a, b) => (!b ? a : (a.accuracy ?? Infinity) <= (b.accuracy ?? Infinity) ? a : b);
      const fresh = () => (snapshot.status === 'tracking' ? snapshot.location : null);

      if (precise(fresh())) return Promise.resolve(snapshot.location);
      if (hopeless()) return Promise.resolve(snapshot.location);
      return new Promise((resolve) => {
        let best = fresh();
        let settle = null;
        const finish = (value) => {
          clearTimeout(timer);
          clearTimeout(settle);
          unsub();
          resolve(value);
        };
        const armSettle = () => {
          if (!settle) settle = setTimeout(() => finish(best), settleMs);
        };
        const timer = setTimeout(() => finish(best ?? snapshot.location), timeoutMs);
        const unsub = this.subscribe(() => {
          if (hopeless()) return finish(best ?? snapshot.location);
          const l = fresh();
          if (!l) return undefined;
          best = better(l, best);
          if (precise(l)) return finish(l);
          armSettle();
          return undefined;
        });
        if (best) armSettle();
      });
    },
  };
}

export const locationService = createLocationService();
