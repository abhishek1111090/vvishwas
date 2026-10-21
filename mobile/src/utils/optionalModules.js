// optionalModules.js
// ------------------
// expo-notifications throws at import time inside Expo Go on Android
// ("Cannot find native module 'ExpoTopicSubscriptionModule'" — Expo Go for
// Android no longer ships the push parts of that module). Importing it at the
// top of a file would crash the whole app at launch, so it is loaded lazily
// here; callers treat `null` as "notifications unavailable on this build".

let notificationsModule;

export function loadNotifications() {
  if (notificationsModule !== undefined) return notificationsModule;
  try {
    notificationsModule = require('expo-notifications');
  } catch (err) {
    console.warn('[VISHWAS] notifications unavailable in this build:', err?.message);
    notificationsModule = null;
  }
  return notificationsModule;
}
