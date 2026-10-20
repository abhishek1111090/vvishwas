import { useEffect, useState } from 'react';
import { Device } from '@capacitor/device';
import { App as CapApp } from '@capacitor/app';
import { isNative } from '../platform/platform';

// useBattery.js
// -------------
// CONVERSION NOTE (SwiftUI -> React): HomeView.swift used
// `UIDevice.current.batteryLevel` + a 30-second `Timer` to refresh it.
//
// NATIVE APP: @capacitor/device getBatteryInfo() (BatteryManager on
// Android, UIDevice on iOS), refreshed every 60s and on resume.
// BROWSER: the Battery Status API, which only some Chromium browsers have.
// Anywhere the level isn't really known (unsupported browser, emulator
// returning nothing), `supported` is false and `level` is null — the UI
// shows "—", never an invented number.

const POLL_MS = 60_000;

export function useBattery() {
  const [state, setState] = useState({ level: null, charging: false, supported: false });

  useEffect(() => {
    let cancelled = false;

    if (isNative()) {
      const read = async () => {
        try {
          const info = await Device.getBatteryInfo();
          if (cancelled) return;
          const level = typeof info.batteryLevel === 'number' && info.batteryLevel >= 0 ? info.batteryLevel : null;
          setState({ level, charging: !!info.isCharging, supported: level !== null });
        } catch {
          if (!cancelled) setState({ level: null, charging: false, supported: false });
        }
      };
      read();
      const timer = setInterval(read, POLL_MS);
      const handle = CapApp.addListener('appStateChange', ({ isActive }) => { if (isActive) read(); });
      return () => {
        cancelled = true;
        clearInterval(timer);
        Promise.resolve(handle).then((h) => h.remove()).catch(() => {});
      };
    }

    let battery;
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
      }).catch(() => { /* API present but blocked — stays unsupported */ });
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
