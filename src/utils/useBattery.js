import { useEffect, useState } from 'react';

// CONVERSION NOTE (SwiftUI -> React): HomeView.swift used
// `UIDevice.current.batteryLevel` + a 30-second `Timer` to refresh it. The
// web equivalent, the Battery Status API (`navigator.getBattery()`), was
// removed from Firefox and Safari over fingerprinting concerns and is only
// available in some Chromium browsers — so this hook feature-detects it and
// falls back to a clearly-labeled "Unknown" state rather than faking a
// number. Where it IS available, it listens for the API's own
// `levelchange`/`chargingchange` events instead of polling, since the
// browser already pushes updates — the 30s polling timer from the Swift
// version isn't needed on the web.

export function useBattery() {
  const [state, setState] = useState({ level: null, charging: false, supported: false });

  useEffect(() => {
    let battery;
    let cancelled = false;

    const sync = () => {
      if (!battery || cancelled) return;
      setState({ level: battery.level, charging: battery.charging, supported: true });
    };

    if (typeof navigator !== 'undefined' && typeof navigator.getBattery === 'function') {
      navigator.getBattery().then((b) => {
        if (cancelled) return;
        battery = b;
        sync();
        battery.addEventListener('levelchange', sync);
        battery.addEventListener('chargingchange', sync);
      });
    }

    return () => {
      cancelled = true;
      if (battery) {
        battery.removeEventListener('levelchange', sync);
        battery.removeEventListener('chargingchange', sync);
      }
    };
  }, []);

  return state; // { level: 0-1 | null, charging: bool, supported: bool }
}
