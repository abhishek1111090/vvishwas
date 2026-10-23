/* global jest */
// Jest setup — in-memory stand-ins for native storage/crypto so services
// can be tested without a phone. Everything else comes from jest-expo.

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    getItemAsync: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    setItemAsync: jest.fn(async (k, v) => { store.set(k, v); }),
    deleteItemAsync: jest.fn(async (k) => { store.delete(k); }),
    __store: store,
  };
});

jest.mock('expo-crypto', () => {
  const nodeCrypto = require('crypto');
  return {
    randomUUID: () => nodeCrypto.randomUUID(),
    getRandomBytes: (n) => new Uint8Array(nodeCrypto.randomBytes(n)),
  };
});

// expo-audio's JS entry touches native classes at import time; tests inject
// their own recorder/permission fakes, so a thin stub is enough here.
jest.mock('expo-audio', () => ({
  setAudioModeAsync: jest.fn(async () => {}),
  getRecordingPermissionsAsync: jest.fn(async () => ({ status: 'undetermined', granted: false, canAskAgain: true })),
  requestRecordingPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true, canAskAgain: true })),
  useAudioRecorder: jest.fn(() => ({
    uri: null,
    prepareToRecordAsync: jest.fn(async () => {}),
    record: jest.fn(),
    stop: jest.fn(async () => {}),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  })),
  useAudioPlayer: jest.fn(() => ({ play: jest.fn(), pause: jest.fn(), seekTo: jest.fn(async () => {}) })),
  useAudioPlayerStatus: jest.fn(() => ({ isLoaded: true, playing: false, currentTime: 0, duration: 12.8, didJustFinish: false, error: null })),
  RecordingPresets: { HIGH_QUALITY: {} },
}));

// Animations: Reanimated's official Jest mock (animations complete instantly).
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
// Fonts load instantly in tests.
jest.mock('expo-font', () => ({ useFonts: () => [true, null], isLoaded: () => true, loadAsync: async () => {} }));
jest.mock('@expo-google-fonts/inter', () => ({
  useFonts: () => [true, null],
  Inter_400Regular: 1, Inter_500Medium: 1, Inter_600SemiBold: 1, Inter_700Bold: 1, Inter_800ExtraBold: 1,
}));

// No real network in tests: anything that isn't explicitly faked fails fast.
global.fetch = jest.fn(async () => { throw new Error('Network disabled in tests'); });

// Barometer: a phone without one, unless a test fakes it.
jest.mock('expo-sensors', () => ({
  Barometer: {
    isAvailableAsync: jest.fn(async () => false),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    setUpdateInterval: jest.fn(),
  },
}));
jest.mock('@expo-google-fonts/archivo-black', () => ({ ArchivoBlack_400Regular: 1 }));
