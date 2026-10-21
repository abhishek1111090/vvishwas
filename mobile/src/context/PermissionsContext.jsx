import { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { AppState } from 'react-native';
import { permissionsService, PermissionStatus, KINDS } from '../services/permissionsService';

// PermissionsContext — real OS permission state, re-checked on launch and
// whenever the app returns to the foreground (catches changes made in
// Settings, including revoked permissions).

const PermissionsContext = createContext(null);

export function PermissionsProvider({ children, service = permissionsService }) {
  const [statuses, setStatuses] = useState(() => Object.fromEntries(KINDS.map((k) => [k, PermissionStatus.notDetermined])));
  const [lastError, setLastError] = useState(null);

  const applyChecked = useCallback((next) => {
    setStatuses((prev) => {
      const merged = { ...prev };
      for (const k of KINDS) if (prev[k] !== PermissionStatus.requesting) merged[k] = next[k];
      return merged;
    });
  }, []);

  const refreshAllStatuses = useCallback(
    () => service.checkAll().then(applyChecked),
    [service, applyChecked]
  );

  useEffect(() => {
    service.checkAll().then(applyChecked);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') service.checkAll().then(applyChecked);
    });
    return () => sub.remove();
  }, [service, applyChecked]);

  const request = useCallback(async (kind) => {
    setLastError(null);
    setStatuses((s) => ({ ...s, [kind]: PermissionStatus.requesting }));
    const status = await service.request(kind);
    setStatuses((s) => ({ ...s, [kind]: status }));
    return status;
  }, [service]);

  const openAppSettings = useCallback(async () => {
    try {
      await service.openAppSettings();
    } catch {
      setLastError('Could not open Settings. Open the Settings app and find VISHWAS.');
    }
  }, [service]);

  const value = useMemo(
    () => ({ statuses, lastError, refreshAllStatuses, request, openAppSettings }),
    [statuses, lastError, refreshAllStatuses, request, openAppSettings]
  );

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

export function usePermissions() {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error('usePermissions must be used within a PermissionsProvider');
  return ctx;
}
