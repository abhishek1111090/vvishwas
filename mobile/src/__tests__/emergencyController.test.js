import { createEmergencyManager } from '../services/emergencyManager';
import { createEmergencyController } from '../services/emergencyController';
import {
  memoryStorage, fakeLocation, fakeRecording, fakeAlerts, fakeNotifications, fakePermissions, noHaptics, flush, waitFor,
} from '../test/fakes';

const CONTACTS = [
  { id: 'c1', name: 'Asha', phoneNumber: '+919876543210', priority: 0, isFavorite: true },
  { id: 'c2', name: 'Ravi', phoneNumber: '+919812345678', priority: 1, isFavorite: false },
];
const FIX = { latitude: 26.9, longitude: 75.8, accuracy: 12, timestamp: '2026-10-20T10:00:05.000Z' };

function setup(overrides = {}) {
  const manager = overrides.manager ?? createEmergencyManager({ storage: memoryStorage() });
  const deps = {
    manager,
    recording: fakeRecording(),
    location: fakeLocation({ fix: FIX }),
    alerts: fakeAlerts(),
    notifications: fakeNotifications(),
    permissions: fakePermissions(),
    haptics: noHaptics,
    platform: 'android',
    ...overrides,
  };
  const controller = createEmergencyController(deps);
  controller.setContext({ contacts: CONTACTS, user: { id: 'u1', fullName: 'Priya' } });
  return { controller, ...deps };
}

const messages = (t) => t.manager.getSnapshot().log.map((e) => e.message);

describe('emergencyController', () => {
  it('manual SOS goes through the canonical trigger and starts every service', async () => {
    const t = setup();
    const spy = jest.spyOn(t.manager, 'trigger');
    const result = t.controller.startEmergency('button');
    expect(result.started).toBe(true);
    expect(spy).toHaveBeenCalledWith('button');
    expect(t.recording.startAudio).toHaveBeenCalledWith(result.session.id);
    await flush();
    expect(t.permissions.request).toHaveBeenCalledWith('camera');
    expect(t.controller.isCameraAllowed()).toBe(true);
    expect(t.location.start).toHaveBeenCalled();
    expect(t.notifications.showEmergencyActive).toHaveBeenCalled();
    await waitFor(() => expect(t.alerts.sendAutomatic).toHaveBeenCalled());
    const payload = t.alerts.sendAutomatic.mock.calls[0][0];
    expect(payload).toMatchObject({ sessionId: result.session.id, triggerSource: 'button' });
    expect(payload.location.latitude).toBe(26.9);
  });

  it('video starts only when the camera reports ready', () => {
    const t = setup();
    const { session } = t.controller.startEmergency('tripleTap');
    expect(t.recording.startVideo).not.toHaveBeenCalled();
    t.controller.onCameraReady();
    expect(t.recording.startVideo).toHaveBeenCalledWith(session.id);
    t.controller.onCameraReady();
    expect(t.recording.startVideo).toHaveBeenCalledTimes(1);
  });

  it('camera permission denied is logged, and no camera is mounted', async () => {
    const t = setup({ permissions: fakePermissions('blocked') });
    t.controller.startEmergency('button');
    await flush();
    expect(t.controller.isCameraAllowed()).toBe(false);
    expect(messages(t)).toContain('📹 Video not recording: camera permission denied');
  });

  it('a duplicate trigger starts nothing new', async () => {
    const t = setup();
    t.controller.startEmergency('button');
    expect(t.controller.startEmergency('tripleTap').started).toBe(false);
    await flush();
    expect(t.recording.startAudio).toHaveBeenCalledTimes(1);
    expect(t.location.start).toHaveBeenCalledTimes(1);
    expect(t.permissions.request).toHaveBeenCalledTimes(1);
  });

  it('on Android without a server it says contacts were NOT alerted and waits for the user', async () => {
    const t = setup();
    t.controller.startEmergency('button');
    await waitFor(() => expect(t.manager.getSnapshot().activeSession.alerts?.method).toBe('manual'));
    expect(messages(t).join('\n')).toMatch(/NOT alerted yet/);
    expect(t.alerts.sendViaComposer).not.toHaveBeenCalled();
  });

  it('on iOS it opens Messages automatically and records that the user pressed Send', async () => {
    const t = setup({ platform: 'ios' });
    t.controller.startEmergency('button');
    await waitFor(() => expect(t.alerts.sendViaComposer).toHaveBeenCalled());
    await waitFor(() => expect(t.manager.getSnapshot().activeSession.alerts.status).toBe('sentByUser'));
    expect(messages(t)).toContain('✉️ SMS: Sent from Messages');
  });

  it('a cancelled SMS is recorded as not sent', async () => {
    const t = setup({ platform: 'ios', alerts: fakeAlerts({ composer: { method: 'sms', status: 'cancelled', recipients: [], message: 'm' } }) });
    t.controller.startEmergency('button');
    await waitFor(() => expect(t.manager.getSnapshot().activeSession.alerts?.status).toBe('cancelled'));
    expect(messages(t)).toContain('✉️ SMS: Not sent — SMS cancelled');
  });

  it('with no contacts it records that nobody was alerted', async () => {
    const t = setup();
    t.controller.setContext({ contacts: [] });
    t.controller.startEmergency('button');
    await waitFor(() => expect(t.manager.getSnapshot().activeSession.alerts?.status).toBe('noContacts'));
    expect(t.alerts.sendAutomatic).not.toHaveBeenCalled();
  });

  it('resolve stops everything and stores the real recording outcomes', async () => {
    const t = setup();
    t.controller.startEmergency('button');
    await flush();
    const ended = await t.controller.endEmergency('resolve');
    expect(t.location.stop).toHaveBeenCalled();
    expect(t.recording.stopAll).toHaveBeenCalled();
    expect(t.notifications.clearEmergencyActive).toHaveBeenCalled();
    expect(t.controller.isCameraAllowed()).toBe(false);
    expect(ended.status).toBe('resolved');
    expect(ended.recordings.audio.status).toBe('saved');
    expect(ended.recordings.video.status).toBe('error');
    const log = ended.log.map((e) => e.message).join('\n');
    expect(log).toMatch(/Audio saved privately/);
    expect(log).toMatch(/Video not saved: Camera permission denied/);
  });

  it('cancel ends as cancelled and concurrent ends run cleanup once', async () => {
    const t = setup();
    t.controller.startEmergency('button');
    const [a, b] = await Promise.all([t.controller.endEmergency('cancel'), t.controller.endEmergency('cancel')]);
    expect(a.status).toBe('cancelled');
    expect(a).toBe(b);
    expect(t.recording.stopAll).toHaveBeenCalledTimes(1);
  });

  it('restores a session left active by an app restart', async () => {
    const storage = memoryStorage();
    createEmergencyManager({ storage }).trigger('button');
    const t = setup({ manager: createEmergencyManager({ storage }) });
    expect(t.controller.restoreActiveSession()).not.toBeNull();
    expect(t.location.start).toHaveBeenCalled();
    expect(messages(t).at(-1)).toMatch(/Restart recording/);
  });
});
