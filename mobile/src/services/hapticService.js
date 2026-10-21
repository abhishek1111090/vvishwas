import * as Haptics from 'expo-haptics';

// hapticService.js
// ----------------
// Mirrors HapticManager.swift via expo-haptics (Taptic Engine on iPhone,
// vibrator on Android). Fire-and-forget: haptics are cosmetic and must
// never block or break an SOS flow.

function run(promiseFactory) {
  try {
    promiseFactory().catch(() => {});
  } catch {
    // Module unavailable — cosmetic only.
  }
}

export const haptics = {
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
  light: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  medium: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  selection: () => run(() => Haptics.selectionAsync()),
  emergencyTrigger: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
