// hapticService.js
// ----------------
// CONVERSION NOTE (SwiftUI -> React): HapticManager.swift wrapped
// UIFeedbackGenerator (Apple's Taptic Engine API). The closest web
// equivalent is the Vibration API (`navigator.vibrate`), which only works
// on Android Chrome over HTTP(S) in response to a user gesture — iOS Safari
// doesn't expose it at all. Every function here is intentionally a safe
// no-op everywhere else, mirroring how the Swift version is also silently
// a no-op on devices without the Taptic Engine (e.g. some iPads). The
// *call sites* (SOS button, sign-up success, etc.) stay identical either way
// — exactly the same "doesn't matter where you call it from" design as the
// original.

function vibrate(pattern) {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(pattern);
  }
}

export const haptics = {
  success: () => vibrate(15),
  warning: () => vibrate([20, 60, 20]),
  error: () => vibrate([30, 80, 30, 80, 30]),
  light: () => vibrate(8),
  medium: () => vibrate(18),
  selection: () => vibrate(6),

  /** Distinct, attention-grabbing pattern reserved for SOS activation. */
  emergencyTrigger: () => vibrate([40, 150, 40, 200, 80]),
};
