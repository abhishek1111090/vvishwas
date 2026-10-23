import { requireOptionalNativeModule, requireNativeViewManager } from 'expo-modules-core';

// Front + back recording at the same time (iOS, custom build only).
// In Expo Go the native module doesn't exist: everything here reports
// "not available" and the app keeps using the single expo-camera view.

const Native = requireOptionalNativeModule('VishwasDualCamera');

export function isDualCameraAvailable() {
  try {
    return !!Native && Native.isSupported() === true;
  } catch {
    return false;
  }
}

/** Native view: back camera full-size, front camera in a corner. Ref methods: startRecording, stopRecording, takePicture. */
export const DualCameraNativeView = Native ? requireNativeViewManager('VishwasDualCamera') : null;
