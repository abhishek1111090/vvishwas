import { useCallback, useEffect, useState } from 'react';
import { locationService } from '../services/locationService';
import { PermissionStatus } from '../services/permissionsService';

/**
 * Dashboard location status. Permission alone isn't proof that location
 * works (services can be switched off, no signal indoors), so when
 * permission is granted this takes ONE low-accuracy fix (cached up to
 * 5 minutes — cheap on battery) and reports what actually happened.
 *
 * state: 'off' (no permission) | 'checking' | 'ok' | 'error'
 */
export function useLocationStatus(permissionStatus) {
  const [result, setResult] = useState({ state: 'checking', location: null, error: null });
  const granted = permissionStatus === PermissionStatus.granted;

  const check = useCallback(async () => {
    setResult((r) => ({ ...r, state: 'checking' }));
    const res = await locationService.getCurrent();
    setResult(res.location
      ? { state: 'ok', location: res.location, error: null }
      : { state: 'error', location: null, error: res.error });
  }, []);

  useEffect(() => {
    if (!granted) return;
    let cancelled = false;
    locationService.getCurrent().then((res) => {
      if (cancelled) return;
      setResult(res.location
        ? { state: 'ok', location: res.location, error: null }
        : { state: 'error', location: null, error: res.error });
    });
    return () => { cancelled = true; };
  }, [granted]);

  if (!granted) return { state: 'off', location: null, error: null, recheck: check };
  return { ...result, recheck: check };
}
