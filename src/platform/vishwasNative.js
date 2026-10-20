import { registerPlugin } from '@capacitor/core';

// vishwasNative.js
// ----------------
// JS side of the small app-local native plugin shipped inside the Android
// and iOS projects:
//   android/app/src/main/java/com/vishwas/safety/VishwasNativePlugin.java
//   ios/App/App/VishwasNativePlugin.swift
//
// It covers the gaps the official Capacitor plugins leave:
//   • camera / microphone permission status + request (official
//     @capacitor/camera only knows about the camera, not the microphone)
//   • SEND_SMS permission and SmsManager sending with real per-recipient
//     "sent" / "delivered" results from the carrier (Android only — iOS
//     does not allow apps to send SMS without the user pressing Send)
//   • opening this app's page in system Settings after a permanent denial
//
// On the web there is no native side, so the web implementation reports
// everything as unavailable and callers fall back to browser APIs.

const unavailable = () => {
  const err = new Error('VishwasNative is not available on this platform.');
  err.code = 'UNAVAILABLE';
  return Promise.reject(err);
};

export const VishwasNative = registerPlugin('VishwasNative', {
  web: () => ({
    checkMediaPermissions: unavailable,
    requestMediaPermissions: unavailable,
    checkSmsPermission: unavailable,
    requestSmsPermission: unavailable,
    sendSms: unavailable,
    openAppSettings: unavailable,
    addListener: () => Promise.resolve({ remove: () => Promise.resolve() }),
  }),
});
