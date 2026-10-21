import { Linking } from 'react-native';
import * as Location from 'expo-location';
import { Camera } from 'expo-camera';
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import { loadNotifications } from '../utils/optionalModules';

/**
 * permissionsService.js — real OS permission state via Expo modules
 *
 * Checking never prompts. Requesting shows the real OS dialog. When the OS
 * won't show the dialog again (iOS after one denial, Android after
 * "Don't ask again") the status is 'blocked' and the UI offers Settings.
 */

export const PermissionStatus = {
  notDetermined: 'notDetermined', // never asked — show "Allow"
  granted: 'granted',
  denied: 'denied',               // denied but the OS will ask again — show "Retry"
  blocked: 'blocked',             // denied, OS won't ask again — show "Settings"
  requesting: 'requesting',
  unavailable: 'unavailable',
};

/** Expo PermissionResponse → PermissionStatus */
export function fromExpoPermission(response) {
  if (!response) return PermissionStatus.unavailable;
  if (response.status === 'granted' || response.granted) return PermissionStatus.granted;
  if (response.status === 'undetermined') return PermissionStatus.notDetermined;
  if (response.status === 'denied') {
    return response.canAskAgain === false ? PermissionStatus.blocked : PermissionStatus.denied;
  }
  return PermissionStatus.unavailable;
}

async function safe(fn) {
  try {
    return fromExpoPermission(await fn());
  } catch {
    return PermissionStatus.unavailable;
  }
}

export const KINDS = ['location', 'camera', 'microphone', 'notifications'];

export function createPermissionsService({
  location = Location,
  camera = Camera,
  recording = { getRecordingPermissionsAsync, requestRecordingPermissionsAsync },
  notifications = loadNotifications(),
  linking = Linking,
} = {}) {
  const check = {
    location: () => safe(() => location.getForegroundPermissionsAsync()),
    camera: () => safe(() => camera.getCameraPermissionsAsync()),
    microphone: () => safe(() => recording.getRecordingPermissionsAsync()),
    notifications: () => (notifications ? safe(() => notifications.getPermissionsAsync()) : Promise.resolve(PermissionStatus.unavailable)),
  };
  const request = {
    location: () => safe(() => location.requestForegroundPermissionsAsync()),
    camera: () => safe(() => camera.requestCameraPermissionsAsync()),
    microphone: () => safe(() => recording.requestRecordingPermissionsAsync()),
    notifications: () => (notifications ? safe(() => notifications.requestPermissionsAsync()) : Promise.resolve(PermissionStatus.unavailable)),
  };

  return {
    check: (kind) => check[kind](),
    request: (kind) => request[kind](),
    async checkAll() {
      const values = await Promise.all(KINDS.map((k) => check[k]()));
      return Object.fromEntries(KINDS.map((k, i) => [k, values[i]]));
    },
    openAppSettings: () => linking.openSettings(),
  };
}

export const permissionsService = createPermissionsService();
