import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { isNative } from '../platform/platform';

// hapticService.js
// ----------------
// CONVERSION NOTE (SwiftUI -> React): HapticManager.swift wrapped
// UIFeedbackGenerator (Apple's Taptic Engine API).
//
// MOBILE: inside the Capacitor app we use @capacitor/haptics, which drives
// UIFeedbackGenerator on iOS and the Vibrator service on Android — the real
// equivalent of the Swift original. In a plain browser we fall back to the
// Vibration API (Android Chrome only; iOS Safari has none). Every call is
// fire-and-forget: haptics must never block or break an SOS flow, so a
// failing plugin call is caught and ignored (haptics are cosmetic).

function vibrate(pattern) {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try { navigator.vibrate(pattern); } catch { /* unsupported — cosmetic only */ }
  }
}

function run(nativeCall, webPattern) {
  if (isNative()) {
    nativeCall().catch(() => { /* cosmetic only */ });
  } else {
    vibrate(webPattern);
  }
}

export const haptics = {
  success: () => run(() => Haptics.notification({ type: NotificationType.Success }), 15),
  warning: () => run(() => Haptics.notification({ type: NotificationType.Warning }), [20, 60, 20]),
  error: () => run(() => Haptics.notification({ type: NotificationType.Error }), [30, 80, 30, 80, 30]),
  light: () => run(() => Haptics.impact({ style: ImpactStyle.Light }), 8),
  medium: () => run(() => Haptics.impact({ style: ImpactStyle.Medium }), 18),
  selection: () => run(() => Haptics.selectionChanged(), 6),

  /** Distinct, attention-grabbing pattern reserved for SOS activation. */
  emergencyTrigger: () =>
    run(() => Haptics.vibrate({ duration: 400 }), [40, 150, 40, 200, 80]),
};
