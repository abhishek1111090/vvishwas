import { useCallback, useEffect, useState } from 'react';
import * as Battery from 'expo-battery';
import { locationService } from '../services/locationService';
import { PermissionStatus } from '../services/permissionsService';

/**
 * useBattery — real battery level via expo-battery (event-driven).
 * Where the level isn't known (simulator, unsupported) `level` is null and
 * the UI shows "—", never an invented number.
 */
export function useBattery() {
  const [state, setState] = useState({ level: null, charging: false });

  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      try {
        const [level, batteryState] = await Promise.all([Battery.getBatteryLevelAsync(), Battery.getBatteryStateAsync()]);
        if (cancelled) return;
        setState({
          level: typeof level === 'number' && level >= 0 ? level : null,
          charging: batteryState === Battery.BatteryState.CHARGING || batteryState === Battery.BatteryState.FULL,
        });
      } catch {
        if (!cancelled) setState({ level: null, charging: false });
      }
    };
    read();
    const subs = [];
    try {
      subs.push(Battery.addBatteryLevelListener(({ batteryLevel }) => {
        setState((s) => ({ ...s, level: batteryLevel >= 0 ? batteryLevel : null }));
      }));
      subs.push(Battery.addBatteryStateListener(({ batteryState }) => {
        setState((s) => ({ ...s, charging: batteryState === Battery.BatteryState.CHARGING || batteryState === Battery.BatteryState.FULL }));
      }));
    } catch {
      // Listeners unsupported — the one-off read above still applies.
    }
    return () => {
      cancelled = true;
      subs.forEach((s) => s?.remove?.());
    };
  }, []);

  return state;
}

/**
 * Dashboard location status. Permission alone isn't proof that location
 * works, so when granted this takes a real high-accuracy fix, refreshes it
 * every 20 s while the screen is mounted, and reports what actually happened.
 * state: 'off' | 'checking' | 'ok' | 'error'
 */
const REFRESH_MS = 20_000;

export function useLocationStatus(permissionStatus) {
  const granted = permissionStatus === PermissionStatus.granted;
  const [result, setResult] = useState({ state: 'checking', location: null, error: null });

  const apply = useCallback((res) => {
    setResult(res.location ? { state: 'ok', location: res.location, error: null } : { state: 'error', location: null, error: res.error });
  }, []);

  const recheck = useCallback(async () => {
    setResult((r) => ({ ...r, state: 'checking' }));
    apply(await locationService.getCurrent());
  }, [apply]);

  useEffect(() => {
    if (!granted) return undefined;
    let cancelled = false;
    const refresh = () => locationService.getCurrent().then((res) => {
      if (cancelled) return;
      // A failed refresh keeps showing the last good fix rather than flickering to an error.
      setResult((prev) => (res.location || !prev.location ? (res.location ? { state: 'ok', location: res.location, error: null } : { state: 'error', location: null, error: res.error }) : prev));
    });
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [granted]);

  if (!granted) return { state: 'off', location: null, error: null, recheck };
  return { ...result, recheck };
}
