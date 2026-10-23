import { createVoiceActivationService, matchesPhrase, validatePhrase, normalizeSpeech, VoiceStatus } from '../services/voiceActivationService';
import { createEmergencyManager } from '../services/emergencyManager';
import { createEmergencyController } from '../services/emergencyController';
import { memoryStorage, fakeLocation, fakeRecording, fakeAlerts, fakeNotifications, fakePermissions, noHaptics, waitFor } from '../test/fakes';

// Voice SOS: custom phrase → the same SOS as the button.

function fakeSpeech({ granted = true } = {}) {
  const handlers = {};
  return {
    handlers,
    start: jest.fn(),
    stop: jest.fn(),
    abort: jest.fn(),
    getPermissionsAsync: jest.fn(async () => ({ granted })),
    requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
    supportsOnDeviceRecognition: jest.fn(() => true),
    addListener: jest.fn((name, cb) => { handlers[name] = cb; return { remove: jest.fn() }; }),
    say: (text, isFinal = false) => handlers.result?.({ isFinal, results: [{ transcript: text, confidence: 0.9 }] }),
    emit: (name, payload) => handlers[name]?.(payload),
  };
}

function setup(saved = { enabled: true, phrase: 'Anshu activate' }, speechOpts) {
  const native = fakeSpeech(speechOpts);
  let stored = saved;
  let clock = 1_000_000;
  const svc = createVoiceActivationService({
    native,
    storage: { read: () => stored, write: (v) => { stored = v; } },
    now: () => clock,
  });
  const trigger = jest.fn();
  return { svc, native, trigger, advance: (ms) => { clock += ms; }, stored: () => stored };
}

const flush = () => new Promise((r) => setImmediate(r));

describe('phrase rules', () => {
  it('matches the exact words in order, as whole words, ignoring case and punctuation', () => {
    expect(matchesPhrase('okay ANSHU, activate!', 'Anshu activate')).toBe(true);
    expect(matchesPhrase('anshu activated the alarm', 'Anshu activate')).toBe(false);
    expect(matchesPhrase('activate anshu', 'Anshu activate')).toBe(false);
    expect(matchesPhrase('help them now', 'help me')).toBe(false);
    expect(matchesPhrase('please help me', 'help me')).toBe(true);
    expect(normalizeSpeech('  Hélp,  ME! ')).toBe('help me');
  });

  it('rejects phrases that would trigger by accident', () => {
    expect(validatePhrase('help')).toMatch(/at least 2 words/);
    expect(validatePhrase('a b')).toMatch(/too short/);
    expect(validatePhrase('one two three four five six seven')).toMatch(/6 words/);
    expect(validatePhrase('Anshu activate')).toBeNull();
  });
});

describe('voiceActivationService', () => {
  it('listens with the saved phrase as a hint, preferring on-device recognition', async () => {
    const t = setup();
    t.svc.init(t.trigger);
    await flush();
    expect(t.native.start).toHaveBeenCalledWith(expect.objectContaining({
      continuous: true, interimResults: true, contextualStrings: ['Anshu activate'], requiresOnDeviceRecognition: true,
    }));
    t.native.emit('start');
    expect(t.svc.getSnapshot().status).toBe(VoiceStatus.listening);
  });

  it('hearing the phrase triggers SOS once, frees the mic, and ignores repeats', async () => {
    const t = setup();
    t.svc.init(t.trigger);
    await flush();
    t.native.say('hello there');
    expect(t.trigger).not.toHaveBeenCalled();
    t.native.say('anshu activate');
    t.native.say('anshu activate');
    expect(t.trigger).toHaveBeenCalledTimes(1);
    expect(t.trigger).toHaveBeenCalledWith('voice');
    expect(t.native.abort).toHaveBeenCalled();
  });

  it('practice mode reports the phrase without starting SOS', async () => {
    const t = setup();
    t.svc.init(t.trigger);
    await flush();
    t.svc.setTestMode(true);
    t.native.say('Anshu activate');
    expect(t.trigger).not.toHaveBeenCalled();
    expect(t.svc.getSnapshot().testHeard).toBe(true);
  });

  it('pauses during an SOS / in background and resumes after', async () => {
    const t = setup();
    t.svc.init(t.trigger);
    await flush();
    t.svc.pause('sos');
    expect(t.svc.getSnapshot().status).toBe(VoiceStatus.paused);
    t.native.start.mockClear();
    t.svc.resume('sos');
    await flush();
    expect(t.native.start).toHaveBeenCalled();
  });

  it('asks for permission instead of pretending to listen', async () => {
    const t = setup(undefined, { granted: false });
    t.svc.init(t.trigger);
    await flush();
    expect(t.native.start).not.toHaveBeenCalled();
    expect(t.svc.getSnapshot().status).toBe(VoiceStatus.needsPermission);
  });

  it('saving validates and persists the phrase', async () => {
    const t = setup({ enabled: false, phrase: '' });
    t.svc.init(t.trigger);
    expect(t.svc.save({ enabled: true, phrase: 'help' })).toMatch(/at least 2 words/);
    expect(t.svc.save({ enabled: true, phrase: 'Vishwas help me now' })).toBeNull();
    expect(t.stored()).toEqual({ enabled: true, phrase: 'Vishwas help me now' });
  });

  it('is honestly unavailable without the native recognizer (Expo Go)', () => {
    const svc = createVoiceActivationService({ native: null, storage: { read: () => ({ enabled: true, phrase: 'Anshu activate' }), write: jest.fn() } });
    svc.init(jest.fn());
    expect(svc.isAvailable()).toBe(false);
    expect(svc.getSnapshot().status).toBe(VoiceStatus.unavailable);
  });
});

describe('voice → the existing SOS workflow', () => {
  it('starts the same emergency as the button (alerts, location, recording) with source "voice"', async () => {
    const manager = createEmergencyManager({ storage: memoryStorage() });
    const alerts = fakeAlerts();
    const location = fakeLocation({ fix: { latitude: 26.9, longitude: 75.8, accuracy: 8, timestamp: '2026-10-22T05:00:00.000Z' } });
    const recording = fakeRecording();
    const controller = createEmergencyController({
      manager, alerts, location, recording, notifications: fakeNotifications(), permissions: fakePermissions(), haptics: noHaptics, platform: 'android',
    });
    controller.setContext({ contacts: [{ id: 'c1', name: 'Asha', phoneNumber: '+919876543210', priority: 0 }], user: { id: 'u', fullName: 'Anshu' } });

    const t = setup();
    t.svc.init((source) => controller.startEmergency(source));
    await flush();
    t.native.say('anshu activate');

    expect(manager.getSnapshot().activeSession.triggerSource).toBe('voice');
    expect(recording.startAudio).toHaveBeenCalled();
    await waitFor(() => expect(location.start).toHaveBeenCalled());
    await waitFor(() => expect(alerts.sendAutomatic).toHaveBeenCalledTimes(1));
    await controller.endEmergency('resolve');
  });
});
