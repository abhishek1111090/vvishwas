/**
 * locationService.js — Live GPS tracking with watchPosition
 *
 * Pub-sub singleton compatible with useSyncExternalStore.
 * Uses navigator.geolocation.watchPosition for continuous updates every ~5s
 * (actual frequency depends on device and OS — iOS typically updates every
 * 1–15s depending on accuracy mode and movement).
 *
 * Safari/iOS notes:
 *  • navigator.geolocation works on all iOS Safari versions
 *  • enableHighAccuracy: true activates GPS chip (drains battery but gives
 *    accurate coords during an emergency — correct tradeoff)
 *  • iOS will stop background geolocation when the browser tab is backgrounded
 *    unless the PWA is installed to home screen. We notify the user about this.
 */

function createLocationService() {
  let watchId = null;

  let snapshot = {
    status: 'idle',      // idle | tracking | error
    location: null,      // { latitude, longitude, accuracy, speed, heading, timestamp }
    error: null,
    updateCount: 0,      // increments on each position update (drives log entry on first fix)
  };

  const listeners = new Set();

  function _notify(patch) {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((l) => l());
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSnapshot() {
      return snapshot;
    },

    /** Begin continuous position tracking. Safe to call multiple times — noop if already tracking. */
    start() {
      if (watchId !== null) return; // already watching

      if (!navigator.geolocation) {
        _notify({ status: 'error', error: 'Geolocation is not supported by this browser.' });
        return;
      }

      _notify({ status: 'tracking', error: null });

      watchId = navigator.geolocation.watchPosition(
        (position) => {
          _notify({
            status: 'tracking',
            error: null,
            updateCount: snapshot.updateCount + 1,
            location: {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: Math.round(position.coords.accuracy),   // metres
              speed: position.coords.speed ?? null,             // m/s or null
              heading: position.coords.heading ?? null,         // degrees or null
              altitude: position.coords.altitude ?? null,
              timestamp: new Date(position.timestamp).toISOString(),
            },
          });
        },
        (err) => {
          let friendly;
          switch (err.code) {
            case err.PERMISSION_DENIED:
              friendly = 'Location permission denied. Enable it in Settings → Safari → Location.';
              break;
            case err.POSITION_UNAVAILABLE:
              friendly = 'Location signal unavailable. Move to an open area.';
              break;
            case err.TIMEOUT:
              friendly = 'Location request timed out. Retrying…';
              break;
            default:
              friendly = err.message ?? 'Unknown location error.';
          }
          _notify({ status: 'error', error: friendly });
        },
        {
          enableHighAccuracy: true,   // use GPS chip, not cell-tower triangulation
          timeout: 15_000,            // 15s before error callback fires
          maximumAge: 5_000,          // accept cached position up to 5s old
        }
      );
    },

    /** Stop the position watcher without resetting stored location. */
    stop() {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
      _notify({ status: 'idle' });
    },

    /** Stop + clear all stored location data (used on SOS cancel). */
    reset() {
      this.stop();
      _notify({ status: 'idle', location: null, error: null, updateCount: 0 });
    },
  };
}

export const locationService = createLocationService();
