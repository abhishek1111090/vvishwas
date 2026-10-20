import { vi } from 'vitest';

/** In-memory replacement for the storage helpers used by emergencyManager. */
export function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    readJSON: (k, fallback) => (k in data ? JSON.parse(JSON.stringify(data[k])) : fallback),
    writeJSON: vi.fn((k, v) => { data[k] = JSON.parse(JSON.stringify(v)); return true; }),
    remove: (k) => { delete data[k]; },
  };
}

/** Minimal pub-sub fake with the same shape as our singleton services. */
function store(initial) {
  let snapshot = initial;
  const listeners = new Set();
  return {
    get: () => snapshot,
    set: (patch) => { snapshot = { ...snapshot, ...patch }; listeners.forEach((l) => l()); },
    subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
  };
}

export function fakeLocation({ fix = null } = {}) {
  const s = store({ status: 'idle', location: null, error: null, errorKind: null });
  return {
    subscribe: s.subscribe,
    getSnapshot: s.get,
    set: s.set,
    start: vi.fn(async () => { s.set({ status: 'acquiring' }); }),
    stop: vi.fn(async () => { s.set({ status: 'idle' }); }),
    reset: vi.fn(async () => { s.set({ status: 'idle', location: null }); }),
    waitForFix: vi.fn(async () => fix),
  };
}

export function fakeRecording({ stopResult } = {}) {
  const idle = { status: 'idle', error: null, interrupted: false };
  const s = store({ audio: { ...idle }, video: { ...idle }, isSupported: true });
  return {
    subscribe: s.subscribe,
    getSnapshot: s.get,
    set: s.set,
    startAudio: vi.fn(async () => { s.set({ audio: { ...idle, status: 'recording' } }); return { success: true }; }),
    startVideo: vi.fn(async () => { s.set({ video: { ...idle, status: 'recording' } }); return { success: true }; }),
    stopAll: vi.fn(async () => stopResult ?? {
      audio: { status: 'saved', path: 'recordings/x/audio.m4a', bytes: 2048, mime: 'audio/mp4' },
      video: { status: 'error', error: 'Camera permission denied.', bytes: 0 },
    }),
    isBusy: vi.fn(() => false),
  };
}

export function fakeAlerts(result) {
  return {
    sendAutomatic: vi.fn(async (payload) => result ?? {
      method: 'manual',
      status: 'manualRequired',
      recipients: payload.contacts.map((c) => ({ name: c.name, phoneNumber: c.phoneNumber, status: 'manualRequired' })),
      message: payload.message,
    }),
    openComposer: vi.fn(() => 'composerOpened'),
    onSmsStatus: vi.fn(() => () => {}),
  };
}

export function fakeNotifications() {
  return {
    showEmergencyActive: vi.fn(async () => ({ shown: true })),
    clearEmergencyActive: vi.fn(async () => {}),
  };
}

export function fakePermissions(sms = 'unavailable') {
  return { checkSms: vi.fn(async () => sms) };
}

export const noHaptics = {
  emergencyTrigger: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn(),
  light: vi.fn(), medium: vi.fn(), selection: vi.fn(),
};
