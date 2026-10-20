import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createEmergencyManager } from './emergencyManager';
import { createEmergencyController } from './emergencyController';
import {
  memoryStorage, fakeLocation, fakeRecording, fakeAlerts, fakeNotifications, fakePermissions, noHaptics,
} from '../test/fakes';

const CONTACTS = [
  { id: 'c1', name: 'Asha', phoneNumber: '+919876543210', priority: 0, isFavorite: true },
  { id: 'c2', name: 'Ravi', phoneNumber: '+919812345678', priority: 1, isFavorite: false },
];
const FIX = { latitude: 26.9, longitude: 75.8, accuracy: 12, timestamp: '2026-10-20T10:00:05.000Z' };

function setup(overrides = {}) {
  const manager = createEmergencyManager({ storage: memoryStorage() });
  const deps = {
    manager,
    recording: fakeRecording(),
    location: fakeLocation({ fix: FIX }),
    alerts: fakeAlerts(),
    notifications: fakeNotifications(),
    permissions: fakePermissions(),
    haptics: noHaptics,
    ...overrides,
  };
  const controller = createEmergencyController(deps);
  controller.setContext({ contacts: CONTACTS, user: { id: 'u1', fullName: 'Priya' } });
  return { controller, ...deps };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('emergencyController', () => {
  let t;
  beforeEach(() => { t = setup(); });

  it('manual SOS starts recording, location, notification and alerts through the canonical trigger', async () => {
    const triggerSpy = vi.spyOn(t.manager, 'trigger');
    const result = t.controller.startEmergency('button');
    expect(result.started).toBe(true);
    expect(triggerSpy).toHaveBeenCalledWith('button');
    expect(t.recording.startAudio).toHaveBeenCalledTimes(1);
    expect(t.recording.startVideo).toHaveBeenCalledTimes(1);
    await flush();
    expect(t.location.start).toHaveBeenCalled();
    expect(t.notifications.showEmergencyActive).toHaveBeenCalled();
    await vi.waitFor(() => expect(t.alerts.sendAutomatic).toHaveBeenCalled());
    const payload = t.alerts.sendAutomatic.mock.calls[0][0];
    expect(payload.sessionId).toBe(result.session.id);
    expect(payload.triggerSource).toBe('button');
    expect(payload.location.latitude).toBe(26.9);
    expect(payload.contacts.map((c) => c.name)).toEqual(['Asha', 'Ravi']);
  });

  it('triple-tap uses the same workflow with its own source', () => {
    const result = t.controller.startEmergency('tripleTap');
    expect(result.session.triggerSource).toBe('tripleTap');
    expect(t.recording.startAudio).toHaveBeenCalledTimes(1);
  });

  it('a duplicate trigger does not start a second recording or tracking session', async () => {
    t.controller.startEmergency('button');
    const second = t.controller.startEmergency('tripleTap');
    expect(second.started).toBe(false);
    expect(t.recording.startAudio).toHaveBeenCalledTimes(1);
    expect(t.recording.startVideo).toHaveBeenCalledTimes(1);
    await flush();
    expect(t.location.start).toHaveBeenCalledTimes(1);
  });

  it('when no automatic channel exists, it says contacts were NOT alerted', async () => {
    t.controller.startEmergency('button');
    await vi.waitFor(() => expect(t.manager.getSnapshot().activeSession.alerts?.method).toBe('manual'));
    const log = t.manager.getSnapshot().log.map((e) => e.message).join('\n');
    expect(log).toMatch(/NOT alerted automatically/);
    expect(log).not.toMatch(/Sent to carrier/);
  });

  it('with no contacts it records that nobody was alerted', async () => {
    t.controller.setContext({ contacts: [] });
    t.controller.startEmergency('button');
    await vi.waitFor(() => expect(t.manager.getSnapshot().activeSession.alerts?.status).toBe('noContacts'));
    expect(t.alerts.sendAutomatic).not.toHaveBeenCalled();
  });

  it('records real SMS results per contact', async () => {
    t = setup({
      permissions: fakePermissions('granted'),
      alerts: fakeAlerts({
        method: 'sms', status: 'sent', message: 'm',
        recipients: [
          { name: 'Asha', phoneNumber: '+919876543210', status: 'sent' },
          { name: 'Ravi', phoneNumber: '+919812345678', status: 'failed', error: 'No mobile service' },
        ],
      }),
    });
    t.controller.startEmergency('button');
    await vi.waitFor(() => expect(t.manager.getSnapshot().activeSession.alerts?.method).toBe('sms'));
    expect(t.alerts.sendAutomatic.mock.calls[0][1]).toEqual({ smsGranted: true });
    const log = t.manager.getSnapshot().log.map((e) => e.message);
    expect(log).toContain('📡 Asha: Sent to carrier');
    expect(log).toContain('📡 Ravi: Failed — No mobile service');
  });

  it('resolve stops tracking + recording, clears the notification and stores real recording outcomes', async () => {
    t.controller.startEmergency('button');
    const ended = await t.controller.endEmergency('resolve');
    expect(t.location.stop).toHaveBeenCalled();
    expect(t.recording.stopAll).toHaveBeenCalled();
    expect(t.notifications.clearEmergencyActive).toHaveBeenCalled();
    expect(ended.status).toBe('resolved');
    expect(ended.recordings.audio.status).toBe('saved');
    expect(ended.recordings.video.status).toBe('error');
    const log = ended.log.map((e) => e.message).join('\n');
    expect(log).toMatch(/Audio saved privately/);
    expect(log).toMatch(/Video not saved: Camera permission denied/);
    expect(t.manager.getSnapshot().isActive).toBe(false);
  });

  it('cancel ends the session as cancelled and also releases resources', async () => {
    t.controller.startEmergency('button');
    const ended = await t.controller.endEmergency('cancel');
    expect(ended.status).toBe('cancelled');
    expect(t.recording.stopAll).toHaveBeenCalled();
    expect(t.location.stop).toHaveBeenCalled();
  });

  it('concurrent end requests run cleanup once', async () => {
    t.controller.startEmergency('button');
    const [a, b] = await Promise.all([t.controller.endEmergency('resolve'), t.controller.endEmergency('resolve')]);
    expect(t.recording.stopAll).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('opening the SMS composer is recorded as not confirmed sent', async () => {
    t.controller.startEmergency('button');
    await vi.waitFor(() => expect(t.manager.getSnapshot().activeSession.alerts?.method).toBe('manual'));
    const open = vi.fn();
    t.controller.openSmsComposer(open);
    const alerts = t.manager.getSnapshot().activeSession.alerts;
    expect(alerts.status).toBe('composerOpened');
    expect(alerts.recipients.every((r) => r.status === 'composerOpened')).toBe(true);
    expect(t.manager.getSnapshot().log.at(-1).message).toMatch(/only confirmed if you press Send/);
  });

  it('restores an interrupted session and resumes location tracking', () => {
    const storage = memoryStorage();
    const m1 = createEmergencyManager({ storage });
    m1.trigger('button');
    const t2 = setup({ manager: createEmergencyManager({ storage }) });
    const restored = t2.controller.restoreActiveSession();
    expect(restored).not.toBeNull();
    expect(t2.location.start).toHaveBeenCalled();
    expect(t2.manager.getSnapshot().log.at(-1).message).toMatch(/Restart recording/);
  });
});
