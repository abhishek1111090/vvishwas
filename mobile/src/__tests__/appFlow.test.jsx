import AsyncStorage from '@react-native-async-storage/async-storage';
import { renderRouter } from 'expo-router/testing-library';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { __resetStorageCache } from '../utils/storage';
import { emergencyManager } from '../services/emergencyManager';
import { emergencyController } from '../services/emergencyController';
import { STORAGE_KEYS } from '../utils/constants';
const SecureStore = jest.requireMock('expo-secure-store');

// Device modules are replaced with deterministic fakes: no GPS fix, no
// camera, no SMS — the UI must report that honestly.
jest.mock('expo-location', () => ({
  Accuracy: { High: 4, Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true, canAskAgain: true })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true, canAskAgain: true })),
  hasServicesEnabledAsync: jest.fn(async () => true),
  watchPositionAsync: jest.fn(async (_o, cb) => {
    setTimeout(() => cb({ coords: { latitude: 26.9, longitude: 75.8, accuracy: 8 }, timestamp: Date.now() }), 0);
    return { remove: jest.fn() };
  }),
  getLastKnownPositionAsync: jest.fn(async () => ({ coords: { latitude: 26.9, longitude: 75.8, accuracy: 20 }, timestamp: Date.now() })),
  getCurrentPositionAsync: jest.fn(),
}));
jest.mock('expo-camera', () => ({
  Camera: {
    getCameraPermissionsAsync: jest.fn(async () => ({ status: 'denied', granted: false, canAskAgain: false })),
    requestCameraPermissionsAsync: jest.fn(async () => ({ status: 'denied', granted: false, canAskAgain: false })),
  },
  CameraView: () => null,
}));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: 'undetermined', granted: false, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true, canAskAgain: true })),
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  dismissNotificationAsync: jest.fn(),
}));
jest.mock('expo-sms', () => ({ isAvailableAsync: jest.fn(async () => true), sendSMSAsync: jest.fn(async () => ({ result: 'unknown' })) }));
jest.mock('expo-battery', () => ({
  getBatteryLevelAsync: jest.fn(async () => 0.73),
  getBatteryStateAsync: jest.fn(async () => 1),
  addBatteryLevelListener: jest.fn(() => ({ remove: jest.fn() })),
  addBatteryStateListener: jest.fn(() => ({ remove: jest.fn() })),
  BatteryState: { CHARGING: 2, FULL: 3 },
}));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(async () => {}), impactAsync: jest.fn(async () => {}), selectionAsync: jest.fn(async () => {}),
  NotificationFeedbackType: {}, ImpactFeedbackStyle: {},
}));
jest.mock('expo-video', () => ({ useVideoPlayer: jest.fn(() => ({})), VideoView: () => null }));
jest.mock('expo-contacts', () => ({ Contact: { presentPicker: jest.fn(async () => null) } }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('expo-file-system', () => ({ File: class {}, Directory: class {}, Paths: {} }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
// Icons are irrelevant to these flows (and ship as .mjs, which Jest won't load).
jest.mock('lucide-react-native', () => new Proxy({ __esModule: true }, { get: (t, k) => (k in t ? t[k] : () => null) }));

const routes = {
  _layout: require('../app/_layout'),
  index: require('../app/index'),
  onboarding: require('../app/onboarding'),
  auth: require('../app/auth'),
  '(tabs)/_layout': require('../app/(tabs)/_layout'),
  '(tabs)/home': require('../app/(tabs)/home'),
  '(tabs)/contacts': require('../app/(tabs)/contacts'),
  '(tabs)/profile': require('../app/(tabs)/profile'),
  history: require('../app/history'),
};

async function seed({ onboarded = false, signedIn = false, contacts = [] } = {}) {
  await AsyncStorage.clear();
  SecureStore.__store.clear();
  __resetStorageCache();
  if (onboarded) await AsyncStorage.setItem(STORAGE_KEYS.onboardingComplete, 'true');
  if (signedIn) {
    // A real account created through the service (so the PBKDF2 record exists).
    await AsyncStorage.setItem(STORAGE_KEYS.localUsers, JSON.stringify([{ id: 'u1', fullName: 'Priya Sharma', email: 'priya@example.com', authProvider: 'email', createdAt: '2026-01-01' }]));
    SecureStore.__store.set(STORAGE_KEYS.sessionUserId, JSON.stringify('u1'));
  }
  if (contacts.length) await AsyncStorage.setItem(STORAGE_KEYS.contacts, JSON.stringify(contacts));
}

async function endAnyEmergency() {
  if (emergencyManager.getSnapshot().isActive) await emergencyController.endEmergency('cancel');
}

const ASHA = { id: 'c1', name: 'Asha', phoneNumber: '+919876543210', relationship: 'Sister', priority: 0, isFavorite: true, profileImageDataUrl: null, createdAt: '2026-01-01' };

describe('VISHWAS app flows (Expo Router)', () => {
  beforeEach(endAnyEmergency);
  afterEach(endAnyEmergency);

  it('first launch → onboarding → Skip → Continue → Welcome', async () => {
    await seed();
    const screen = await renderRouter(routes, { initialUrl: '/' });
    expect(await screen.findByText(/One Tap Away/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Skip to permissions setup'));
    expect(await screen.findByText('Set Up Protection')).toBeTruthy();
    await fireEvent.press(screen.getByText(/Continue to VISHWAS|Finish Setup/));
    expect(await screen.findByText('Continue with Email')).toBeTruthy();
    expect(await AsyncStorage.getItem(STORAGE_KEYS.onboardingComplete)).toBe('true');
  });

  it('returning user skips onboarding; sign up validates then lands on Home', async () => {
    await seed({ onboarded: true });
    const screen = await renderRouter(routes, { initialUrl: '/' });
    await fireEvent.press(await screen.findByText('Continue with Email'));
    const createButton = () => screen.getByRole('button', { name: 'Create Account' });
    await screen.findByRole('button', { name: 'Create Account' });
    await fireEvent.press(createButton());
    expect(await screen.findByText('Please enter your name.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Full Name'), 'Priya');
    await fireEvent.changeText(screen.getByLabelText('Email'), 'bad');
    await fireEvent.press(createButton());
    expect(await screen.findByText('Please enter a valid email address.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Email'), 'priya@example.com');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'a-long-password');
    await fireEvent.press(createButton());
    expect(await screen.findByLabelText('Send SOS emergency alert', {}, { timeout: 8000 })).toBeTruthy();
  }, 20000);

  it('sign in shows one generic error for wrong credentials', async () => {
    await seed({ onboarded: true });
    const screen = await renderRouter(routes, { initialUrl: '/auth' });
    await fireEvent.press(await screen.findByText('I already have an account'));
    await fireEvent.changeText(await screen.findByLabelText('Email'), 'nobody@example.com');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'whatever123');
    await fireEvent.press(screen.getAllByText('Sign In').at(-1));
    expect(await screen.findByText('Incorrect email or password.')).toBeTruthy();
  });

  it('signed-out users are redirected from protected screens', async () => {
    await seed({ onboarded: true });
    const screen = await renderRouter(routes, { initialUrl: '/contacts' });
    expect(await screen.findByText('Continue with Email')).toBeTruthy();
  });

  it('Home shows real device status (battery, location, contacts)', async () => {
    await seed({ onboarded: true, signedIn: true, contacts: [ASHA] });
    const screen = await renderRouter(routes, { initialUrl: '/home' });
    expect(await screen.findByText('Battery 73%')).toBeTruthy();
    expect(await screen.findByText('GPS Active')).toBeTruthy();
    expect(screen.getByText('1 Guardian')).toBeTruthy();
  });

  it('press & hold SOS starts the emergency; a short tap only shows a hint', async () => {
    await seed({ onboarded: true, signedIn: true });
    const screen = await renderRouter(routes, { initialUrl: '/home' });
    const button = await screen.findByTestId('sos-button');
    await fireEvent(button, 'pressIn');
    await fireEvent(button, 'pressOut');
    expect(await screen.findByText('Hold for 1.5 seconds to send SOS')).toBeTruthy();
    expect(emergencyManager.getSnapshot().isActive).toBe(false);

    await fireEvent(button, 'pressIn');
    expect(await screen.findByText('🚨 Emergency Active', {}, { timeout: 4000 })).toBeTruthy();
    expect(emergencyManager.getSnapshot().activeSession.triggerSource).toBe('button');
  });

  it('manual SOS (screen-reader confirm) → overlay with honest statuses → I\'m Safe → history', async () => {
    await seed({ onboarded: true, signedIn: true, contacts: [ASHA] });
    const screen = await renderRouter(routes, { initialUrl: '/home' });
    await fireEvent(await screen.findByTestId('sos-button'), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    await fireEvent.press(await screen.findByText('Yes — Send Alert'));

    expect(await screen.findByText('🚨 Emergency Active')).toBeTruthy();
    expect(await screen.findByText('26.90000°')).toBeTruthy();
    expect(screen.getByText('75.80000°')).toBeTruthy();
    // Camera permission denied in this test → video honestly off, and the log says why.
    expect(await screen.findByText('Camera access not allowed')).toBeTruthy();
    await fireEvent.press(screen.getByText('Activity Log'));
    await waitFor(() => expect(screen.getAllByText(/camera permission denied/).length).toBeGreaterThan(0));
    // jest-expo runs as iOS: with no server, Messages opens automatically.
    // The mock reports 'unknown', so the app must NOT claim it was sent.
    const sms = require('expo-sms');
    await waitFor(() => expect(sms.sendSMSAsync).toHaveBeenCalledWith(['+919876543210'], expect.stringMatching(/^EMERGENCY: Priya Sharma/)));
    expect(await screen.findByText('SMS app opened — not confirmed sent')).toBeTruthy();
    expect(screen.getByText('Text contacts')).toBeTruthy(); // can retry

    await fireEvent.press(screen.getByText("I'm Safe — End Emergency"));
    await waitFor(() => expect(screen.queryByText('🚨 Emergency Active')).toBeNull(), { timeout: 6000 });
    expect(await screen.findByText('Resolved')).toBeTruthy();
    expect(JSON.parse(await AsyncStorage.getItem(STORAGE_KEYS.emergencyHistory))[0].status).toBe('resolved');
  }, 20000);

  it('triple-tap anywhere starts SOS once, without confirmation', async () => {
    await seed({ onboarded: true, signedIn: true });
    const screen = await renderRouter(routes, { initialUrl: '/home' });
    const shell = await screen.findByTestId('app-shell');
    const tap = async () => {
      await fireEvent(shell, 'touchStart', { nativeEvent: { pageX: 100, pageY: 100 } });
      await fireEvent(shell, 'touchEnd', { nativeEvent: { pageX: 101, pageY: 101 } });
    };
    await tap(); await tap(); await tap();
    expect(await screen.findByText('🚨 Emergency Active')).toBeTruthy();
    expect(screen.queryByText('Trigger Emergency?')).toBeNull();
    const id = emergencyManager.getSnapshot().activeSession.id;
    await tap(); await tap(); await tap();
    expect(emergencyManager.getSnapshot().activeSession.id).toBe(id);
    expect(await screen.findByText('No emergency contacts saved — nobody was alerted.')).toBeTruthy();
  });

  it('History opens and lists a session with recordings', async () => {
    await seed({ onboarded: true, signedIn: true });
    await AsyncStorage.setItem(STORAGE_KEYS.emergencyHistory, JSON.stringify([{
      id: 'h1', triggerSource: 'button', status: 'resolved',
      startedAt: '2026-10-21T09:06:00.000Z', endedAt: '2026-10-21T09:07:00.000Z',
      log: [{ id: 'l1', timestamp: '2026-10-21T09:06:00.000Z', message: 'Emergency activated', level: 'critical' }],
      location: null, alerts: null,
      recordings: {
        audio: { status: 'saved', uri: 'file:///docs/recordings/h1/audio.m4a', bytes: 4096, error: null, interrupted: false },
        video: { status: 'saved', uri: 'file:///docs/recordings/h1/video.mp4', bytes: 90000, error: null, interrupted: false },
      },
    }]));
    const screen = await renderRouter(routes, { initialUrl: '/home' });
    await fireEvent.press(await screen.findByText('See All'));
    expect(await screen.findByText('Emergency History')).toBeTruthy();
    await fireEvent.press(screen.getByText('SOS via SOS Button'));
    // Real duration from the player, and playback switches the audio session
    // to loudspeaker / silent-switch-proof before playing.
    const audioButton = await screen.findByText('Play audio · 0:13');
    const expoAudio = require('expo-audio');
    await fireEvent.press(audioButton);
    await waitFor(() => expect(expoAudio.setAudioModeAsync).toHaveBeenCalledWith({ playsInSilentMode: true, allowsRecording: false }));
    const player = expoAudio.useAudioPlayer.mock.results.at(-1).value;
    await waitFor(() => expect(player.play).toHaveBeenCalled());
    expect(screen.getByText('Play video')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(await screen.findByText('Recent Activity')).toBeTruthy();
  });

  it('Account → Emergency History opens too', async () => {
    await seed({ onboarded: true, signedIn: true });
    const screen = await renderRouter(routes, { initialUrl: '/profile' });
    await fireEvent.press(await screen.findByText('Emergency History & Evidence'));
    expect(await screen.findByText(/No emergencies yet/)).toBeTruthy();
  });

  it('a scroll-like touch does not count as a tap', async () => {
    await seed({ onboarded: true, signedIn: true });
    const screen = await renderRouter(routes, { initialUrl: '/home' });
    const shell = await screen.findByTestId('app-shell');
    for (let i = 0; i < 3; i++) {
      await fireEvent(shell, 'touchStart', { nativeEvent: { pageX: 100, pageY: 100 } });
      await fireEvent(shell, 'touchEnd', { nativeEvent: { pageX: 100, pageY: 180 } });
    }
    expect(emergencyManager.getSnapshot().isActive).toBe(false);
  });
});
