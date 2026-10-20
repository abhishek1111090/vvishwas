import { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { App as CapApp } from '@capacitor/app';
import { permissionsService, PermissionStatus } from '../services/permissionsService';
import { isNative } from '../platform/platform';

/**
 * PermissionsContext — app-wide permission state
 *
 *  • Statuses come from the real OS (native) or browser — never assumed.
 *  • 'requesting' while an OS dialog is up, so the UI can show a spinner.
 *  • Every request is wrapped so a thrown plugin error can't crash the app.
 *  • Statuses are re-checked on mount AND whenever the app returns to the
 *    foreground, which is how we notice a permission the user granted or
 *    revoked in system Settings.
 */

const PermissionsContext = createContext(null);

const KINDS = ['location', 'camera', 'microphone', 'notifications', 'sms'];

const CHECK = {
  location: () => permissionsService.checkLocation(),
  camera: () => permissionsService.checkCamera(),
  microphone: () => permissionsService.checkMicrophone(),
  notifications: () => permissionsService.checkNotifications(),
  sms: () => permissionsService.checkSms(),
};

const REQUEST = {
  location: () => permissionsService.requestLocation(),
  camera: () => permissionsService.requestCamera(),
  microphone: () => permissionsService.requestMicrophone(),
  notifications: () => permissionsService.requestNotifications(),
  sms: () => permissionsService.requestSms(),
};

export function PermissionsProvider({ children }) {
  const [statuses, setStatuses] = useState(() =>
    Object.fromEntries(KINDS.map((k) => [k, PermissionStatus.notDetermined]))
  );
  const [lastError, setLastError] = useState(null);

  const refreshAllStatuses = useCallback(async () => {
    const results = await Promise.allSettled(KINDS.map((k) => CHECK[k]()));
    setStatuses((prev) => {
      const next = { ...prev };
      results.forEach((r, i) => {
        // Don't overwrite an in-flight request's spinner with a stale check.
        if (r.status === 'fulfilled' && prev[KINDS[i]] !== PermissionStatus.requesting) next[KINDS[i]] = r.value;
      });
      return next;
    });
  }, []);

  useEffect(() => { refreshAllStatuses(); }, [refreshAllStatuses]);

  // Re-check when returning from Settings (native) or switching back to the tab (web).
  useEffect(() => {
    if (isNative()) {
      const handle = CapApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) refreshAllStatuses();
      });
      return () => { Promise.resolve(handle).then((h) => h.remove()).catch(() => {}); };
    }
    const onVisible = () => { if (document.visibilityState === 'visible') refreshAllStatuses(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refreshAllStatuses]);

  const request = useCallback(async (kind) => {
    setLastError(null);
    setStatuses((s) => ({ ...s, [kind]: PermissionStatus.requesting }));
    let status;
    try {
      status = await REQUEST[kind]();
    } catch (err) {
      setLastError(err?.message ?? 'Permission request failed.');
      status = await CHECK[kind]().catch(() => PermissionStatus.unavailable);
    }
    setStatuses((s) => ({ ...s, [kind]: status }));
    return status;
  }, []);

  const openAppSettings = useCallback(async () => {
    try {
      await permissionsService.openAppSettings();
    } catch (err) {
      setLastError(err?.message ?? 'Could not open Settings. Open it manually and find VISHWAS.');
    }
  }, []);

  const value = useMemo(
    () => ({
      statuses,
      locationStatus: statuses.location,
      cameraStatus: statuses.camera,
      microphoneStatus: statuses.microphone,
      notificationStatus: statuses.notifications,
      smsStatus: statuses.sms,
      lastError,
      canOpenSettings: permissionsService.canOpenSettings(),
      refreshAllStatuses,
      request,
      requestLocation: () => request('location'),
      requestCamera: () => request('camera'),
      requestMicrophone: () => request('microphone'),
      requestNotifications: () => request('notifications'),
      requestSms: () => request('sms'),
      openAppSettings,
    }),
    [statuses, lastError, refreshAllStatuses, request, openAppSettings]
  );

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

export function usePermissions() {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error('usePermissions must be used within a PermissionsProvider');
  return ctx;
}
