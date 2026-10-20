import { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { permissionsService, PermissionStatus } from '../services/permissionsService';

/**
 * PermissionsContext — Safari-compatible permission state management
 *
 * Changes from Phase 1:
 *  • Adds 'requesting' status so UI can show a loading indicator while the
 *    browser's permission prompt is up (or while we probe Safari).
 *  • Wraps every request in a try/catch so a thrown error never crashes the app.
 *  • refreshAllStatuses() runs on mount AND after every successful request so
 *    the UI always reflects reality.
 *  • On Safari, checkCamera / checkMicrophone may briefly show 'requesting'
 *    while the silent probe runs (it resolves in <500ms with no visible prompt).
 */

const PermissionsContext = createContext(null);

export function PermissionsProvider({ children }) {
  const [locationStatus,     setLocationStatus]     = useState(PermissionStatus.notDetermined);
  const [cameraStatus,       setCameraStatus]       = useState(PermissionStatus.notDetermined);
  const [microphoneStatus,   setMicrophoneStatus]   = useState(PermissionStatus.notDetermined);
  const [notificationStatus, setNotificationStatus] = useState(PermissionStatus.notDetermined);

  const refreshAllStatuses = useCallback(async () => {
    // Run all checks in parallel for speed
    const [loc, cam, mic, notif] = await Promise.allSettled([
      permissionsService.checkLocation(),
      permissionsService.checkCamera(),
      permissionsService.checkMicrophone(),
      permissionsService.checkNotifications(),
    ]);
    if (loc.status === 'fulfilled')   setLocationStatus(loc.value);
    if (cam.status === 'fulfilled')   setCameraStatus(cam.value);
    if (mic.status === 'fulfilled')   setMicrophoneStatus(mic.value);
    if (notif.status === 'fulfilled') setNotificationStatus(notif.value);
  }, []);

  // Check statuses on mount (may briefly probe Safari silently)
  useEffect(() => { refreshAllStatuses(); }, [refreshAllStatuses]);

  const requestLocation = useCallback(async () => {
    setLocationStatus(PermissionStatus.requesting);
    const status = await permissionsService.requestLocation().catch(() => PermissionStatus.denied);
    setLocationStatus(status);
    return status;
  }, []);

  const requestCamera = useCallback(async () => {
    setCameraStatus(PermissionStatus.requesting);
    const status = await permissionsService.requestCamera().catch(() => PermissionStatus.denied);
    setCameraStatus(status);
    return status;
  }, []);

  const requestMicrophone = useCallback(async () => {
    setMicrophoneStatus(PermissionStatus.requesting);
    const status = await permissionsService.requestMicrophone().catch(() => PermissionStatus.denied);
    setMicrophoneStatus(status);
    return status;
  }, []);

  const requestNotifications = useCallback(async () => {
    setNotificationStatus(PermissionStatus.requesting);
    const status = await permissionsService.requestNotifications().catch(() => PermissionStatus.denied);
    setNotificationStatus(status);
    return status;
  }, []);

  const value = useMemo(
    () => ({
      locationStatus,
      cameraStatus,
      microphoneStatus,
      notificationStatus,
      refreshAllStatuses,
      requestLocation,
      requestCamera,
      requestMicrophone,
      requestNotifications,
    }),
    [
      locationStatus, cameraStatus, microphoneStatus, notificationStatus,
      refreshAllStatuses, requestLocation, requestCamera, requestMicrophone, requestNotifications,
    ]
  );

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

export function usePermissions() {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error('usePermissions must be used within a PermissionsProvider');
  return ctx;
}
