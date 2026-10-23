// constants.js
// ------------
// CONVERSION NOTE: mirrors KeychainKey (KeychainService.swift) and the
// scattered UserDefaults string keys (AppState.swift, AuthService.swift) —
// keeping every storage key in one place avoids typos scattered across
// the app, same rationale as the Swift original.

export const STORAGE_KEYS = {
  onboardingComplete: 'vishwas.onboarding.complete.v1',
  localUsers: 'vishwas.local.users.v1',
  passwordPrefix: 'vishwas.pw.', // SecureStore key: `${passwordPrefix}${userId}`
  sessionUserId: 'vishwas.session.user_id', // SecureStore
  serverSession: 'vishwas.server.session.v1', // SecureStore: { token, user } of a server account
  contacts: 'vishwas.contacts.v1',
  emergencyActive: 'vishwas.emergency.active.v1',   // in-progress session (survives app restarts)
  emergencyHistory: 'vishwas.emergency.history.v1', // ended sessions, newest first
  cloudQueue: 'vishwas.cloud.queue.v1',             // pending server backups (SOS, locations, files)
  cloudUploads: 'vishwas.cloud.uploads.v1',         // local file uri → 'pending' | 'uploaded' | 'failed'
  voiceActivation: 'vishwas.voice.activation.v1',   // { enabled, phrase } for Voice SOS
};

export const EMERGENCY_HISTORY_LIMIT = 50;

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

/** Display label + colour for an emergency session's final status. */
export const SESSION_STATUS = {
  resolved: { text: 'Resolved', color: '#34c759' },
  cancelled: { text: 'Cancelled', color: '#8e8e93' },
  active: { text: 'Active', color: '#e0203a' },
  ending: { text: 'Ending', color: '#ff9500' },
};
