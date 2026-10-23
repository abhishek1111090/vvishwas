import { requireOptionalNativeModule } from 'expo-modules-core';
import { readJSON, writeJSON } from '../utils/storage';
import { STORAGE_KEYS } from '../utils/constants';

/**
 * voiceActivationService.js — custom wake phrase → SOS ("Hey Siri"-style)
 *
 * Listens with the phone's speech recognizer (expo-speech-recognition,
 * on-device when supported) and, when the person's saved phrase is heard,
 * calls onTrigger('voice') — the SAME emergencyController.startEmergency
 * path the SOS button uses, so alerts, location, recording and duplicate
 * protection are the existing ones.
 *
 * Accuracy rules (to avoid false SOS):
 *  • the phrase must be 2–6 words;
 *  • it must be heard as the exact words, in order, as whole words
 *    ("help me" does not match "helping me" or "help them");
 *  • one detection = one trigger; then a cooldown, and nothing while an
 *    SOS is already active.
 *
 * Honesty: status is what the recognizer reports. In Expo Go the native
 * module doesn't exist → 'unavailable'. Listening runs while VISHWAS is open
 * (foreground); iOS and Android stop app speech recognition in the
 * background, so it pauses there and resumes on return.
 */

export const VoiceStatus = {
  unavailable: 'unavailable',       // no speech recognizer in this build (Expo Go)
  off: 'off',                       // disabled by the user
  needsPhrase: 'needsPhrase',
  needsPermission: 'needsPermission',
  starting: 'starting',
  listening: 'listening',
  paused: 'paused',                 // SOS active / app in background
  error: 'error',
};

const COOLDOWN_MS = 15_000;
const BENIGN_ERRORS = ['no-speech', 'speech-timeout', 'aborted', 'interrupted'];

export function normalizeSpeech(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** null when OK, else a reason the phrase can't be used. */
export function validatePhrase(phrase) {
  const words = normalizeSpeech(phrase).split(' ').filter(Boolean);
  if (words.length === 0) return 'Enter a phrase.';
  if (words.length < 2) return 'Use at least 2 words, e.g. "Anshu activate", so everyday words don’t trigger SOS.';
  if (words.length > 6) return 'Keep it to 6 words or fewer.';
  if (words.join('').length < 6) return 'That phrase is too short to recognise reliably.';
  return null;
}

/** Exact phrase as whole words, in order, anywhere in what was heard. */
export function matchesPhrase(transcript, phrase) {
  const p = normalizeSpeech(phrase);
  const t = normalizeSpeech(transcript);
  if (!p || !t) return false;
  return ` ${t} `.includes(` ${p} `);
}

function deviceLocale() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || 'en-US';
  } catch {
    return 'en-US';
  }
}

export function createVoiceActivationService({
  native = requireOptionalNativeModule('ExpoSpeechRecognition'),
  storage = { read: () => readJSON(STORAGE_KEYS.voiceActivation, null), write: (v) => writeJSON(STORAGE_KEYS.voiceActivation, v) },
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let settings = { enabled: false, phrase: '' };
  let snapshot = { status: native ? VoiceStatus.off : VoiceStatus.unavailable, error: null, heard: null, testHeard: false, ...settings };
  const listeners = new Set();
  const pauses = new Set();     // reasons we must not listen ('sos', 'background')
  let onTrigger = null;
  let subs = [];
  let running = false;
  let restartTimer = null;
  let failures = 0;
  let lastFiredAt = 0;
  let testMode = false;

  function set(patch) {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((l) => l());
  }

  const shouldListen = () => !!native && settings.enabled && !validatePhrase(settings.phrase) && pauses.size === 0;

  function idleStatus() {
    if (!native) return VoiceStatus.unavailable;
    if (!settings.enabled) return VoiceStatus.off;
    if (validatePhrase(settings.phrase)) return VoiceStatus.needsPhrase;
    if (pauses.size) return VoiceStatus.paused;
    return snapshot.status;
  }

  function stopNative() {
    clearTimer(restartTimer);
    restartTimer = null;
    if (running) {
      running = false;
      try { native.abort(); } catch { /* already stopped */ }
    }
  }

  function scheduleRestart(delay) {
    clearTimer(restartTimer);
    restartTimer = setTimer(() => { restartTimer = null; start(); }, delay);
  }

  function onResult(event) {
    if (!running) return;
    const transcripts = (event?.results ?? []).map((r) => r?.transcript).filter(Boolean);
    if (transcripts.length) set({ heard: transcripts[0] });
    if (!transcripts.some((t) => matchesPhrase(t, settings.phrase))) return;

    if (testMode) {
      set({ testHeard: true });
      return;
    }
    if (now() - lastFiredAt < COOLDOWN_MS) return;
    lastFiredAt = now();
    // Free the microphone for the SOS audio recording, then trigger once.
    stopNative();
    set({ status: VoiceStatus.paused, heard: null });
    onTrigger?.('voice');
  }

  function onError(event) {
    const code = event?.error;
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      running = false;
      set({ status: VoiceStatus.needsPermission, error: event?.message ?? 'Speech recognition permission denied.' });
      return;
    }
    if (BENIGN_ERRORS.includes(code)) return; // 'end' follows; we restart there
    failures += 1;
    set({ status: VoiceStatus.error, error: event?.message ?? `Speech recognition error (${code})` });
  }

  function onEnd() {
    running = false;
    if (!shouldListen()) return;
    // The recognizer stops after silence / time limits; keep listening.
    scheduleRestart(Math.min(5000, 400 * 2 ** Math.min(failures, 4)));
  }

  function attach() {
    if (subs.length || !native?.addListener) return;
    subs = [
      native.addListener('result', onResult),
      native.addListener('error', onError),
      native.addListener('end', onEnd),
      native.addListener('start', () => { failures = 0; set({ status: VoiceStatus.listening, error: null }); }),
    ];
  }

  async function start() {
    if (!shouldListen()) {
      stopNative();
      set({ status: idleStatus() });
      return;
    }
    if (running) return;
    attach();
    try {
      const perm = await native.getPermissionsAsync();
      if (!perm?.granted) {
        set({ status: VoiceStatus.needsPermission, error: null });
        return;
      }
      if (!shouldListen()) return;
      running = true;
      set({ status: VoiceStatus.starting, error: null });
      const onDevice = (() => { try { return native.supportsOnDeviceRecognition(); } catch { return false; } })();
      native.start({
        lang: deviceLocale(),
        interimResults: true,
        continuous: true,
        maxAlternatives: 3,
        contextualStrings: [settings.phrase],
        requiresOnDeviceRecognition: onDevice,
        addsPunctuation: false,
        androidIntentOptions: { EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 10_000 },
      });
    } catch (err) {
      running = false;
      failures += 1;
      set({ status: VoiceStatus.error, error: err?.message ?? 'Could not start listening.' });
      scheduleRestart(5000);
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    isAvailable: () => !!native,

    /** Called once by the app with the SOS trigger (emergencyController.startEmergency). */
    init(trigger) {
      onTrigger = trigger;
      // Read saved settings now: app storage is loaded by the time init runs.
      const saved = storage.read() ?? {};
      settings = { enabled: !!saved.enabled, phrase: typeof saved.phrase === 'string' ? saved.phrase : '' };
      set({ ...settings, status: idleStatus() });
      start();
    },

    async requestPermission() {
      if (!native) return false;
      const res = await native.requestPermissionsAsync();
      if (res?.granted) start();
      else set({ status: VoiceStatus.needsPermission });
      return !!res?.granted;
    },

    /** Save the phrase and on/off switch; returns an error string or null. */
    save({ enabled, phrase }) {
      const next = { enabled: !!enabled, phrase: String(phrase ?? '').trim() };
      if (next.enabled) {
        const problem = validatePhrase(next.phrase);
        if (problem) return problem;
      }
      settings = next;
      storage.write(settings);
      stopNative();
      set({ ...settings, heard: null, testHeard: false, status: idleStatus() });
      start();
      return null;
    },

    /** Practice mode: shows when the phrase is heard, WITHOUT starting an SOS. */
    setTestMode(on) {
      testMode = !!on;
      set({ testHeard: false, heard: null });
    },

    pause(reason) {
      pauses.add(reason);
      stopNative();
      set({ status: idleStatus() });
    },

    resume(reason) {
      pauses.delete(reason);
      set({ status: idleStatus() });
      start();
    },
  };
}

export const voiceActivationService = createVoiceActivationService();
