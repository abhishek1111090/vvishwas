// constants.js
// ------------
// CONVERSION NOTE: mirrors KeychainKey (KeychainService.swift) and the
// scattered UserDefaults string keys (AppState.swift, AuthService.swift) —
// keeping every storage key in one place avoids typos scattered across
// the app, same rationale as the Swift original.

export const STORAGE_KEYS = {
  onboardingComplete: 'vishwas.onboarding.complete.v1',
  localUsers: 'vishwas.local.users.v1',
  passwordPrefix: 'vishwas.pw.', // password hash storage: `${passwordPrefix}${userId}`
  sessionUserId: 'vishwas.session.user_id',
  contacts: 'vishwas.contacts.v1',
};

export const PRIORITY = {
  primary: 0,
  secondary: 1,
  backup: 2,
};

export const PRIORITY_LABEL = {
  [PRIORITY.primary]: 'Primary',
  [PRIORITY.secondary]: 'Secondary',
  [PRIORITY.backup]: 'Backup',
};

export const TRIGGER_SOURCE = {
  button: 'SOS Button',
  tripleTap: 'Triple Tap',
  voice: 'Voice Activation',
  siri: 'Siri Shortcut',
  watch: 'Apple Watch',
  safetyTimer: 'Safety Timer',
};
