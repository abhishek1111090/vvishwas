/** In-memory replacement for the storage helpers used by emergencyManager. */
export function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    readJSON: (k, fallback) => (k in data ? JSON.parse(JSON.stringify(data[k])) : fallback),
    writeJSON: jest.fn((k, v) => { data[k] = JSON.parse(JSON.stringify(v)); return Promise.resolve(true); }),
    remove: (k) => { delete data[k]; return Promise.resolve(); },
  };
}

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
    start: jest.fn(async () => { s.set({ status: 'acquiring' }); }),
    stop: jest.fn(async () => { s.set({ status: 'idle' }); }),
    reset: jest.fn(async () => { s.set({ status: 'idle', location: null }); }),
    waitForFix: jest.fn(async () => fix),
  };
}

export function fakeRecording({ stopResult } = {}) {
  const idle = { status: 'idle', error: null, interrupted: false };
  const s = store({ audio: { ...idle }, video: { ...idle } });
  return {
    subscribe: s.subscribe,
    getSnapshot: s.get,
    set: s.set,
    startAudio: jest.fn(async () => { s.set({ audio: { ...idle, status: 'recording' } }); return { success: true }; }),
    startVideo: jest.fn(async () => { s.set({ video: { ...idle, status: 'recording' } }); return { success: true }; }),
    stopAll: jest.fn(async () => stopResult ?? {
      audio: { status: 'saved', uri: 'file:///docs/recordings/x/audio.m4a', bytes: 2048 },
      video: { status: 'error', error: 'Camera permission denied.', bytes: 0 },
    }),
    isBusy: jest.fn(() => false),
    isCameraAttached: jest.fn(() => true),
    reset: jest.fn(),
  };
}

export function fakeAlerts({ automatic, composer } = {}) {
  return {
    sendAutomatic: jest.fn(async (payload) => automatic ?? {
      method: 'manual',
      status: 'manualRequired',
      recipients: payload.contacts.map((c) => ({ name: c.name, phoneNumber: c.phoneNumber, status: 'manualRequired' })),
      message: payload.message,
    }),
    sendViaComposer: jest.fn(async (payload) => composer ?? {
      method: 'sms',
      status: 'sentByUser',
      recipients: payload.contacts.map((c) => ({ name: c.name, phoneNumber: c.phoneNumber, status: 'sentByUser' })),
      message: payload.message,
    }),
  };
}

export function fakeNotifications() {
  return {
    showEmergencyActive: jest.fn(async () => ({ shown: true })),
    clearEmergencyActive: jest.fn(async () => {}),
  };
}

export function fakePermissions(camera = 'granted') {
  return {
    request: jest.fn(async () => camera),
    check: jest.fn(async () => camera),
  };
}

export const noHaptics = {
  emergencyTrigger: jest.fn(), success: jest.fn(), warning: jest.fn(), error: jest.fn(),
  light: jest.fn(), medium: jest.fn(), selection: jest.fn(),
};

export const flush = () => new Promise((r) => setTimeout(r, 0));

export async function waitFor(check, timeoutMs = 2000) {
  const start = Date.now();
  for (;;) {
    try {
      check();
      return;
    } catch (err) {
      if (Date.now() - start > timeoutMs) throw err;
      await new Promise((r) => setTimeout(r, 10));
    }
  }
}
