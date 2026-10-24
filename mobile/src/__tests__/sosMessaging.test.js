import { createEmergencyManager } from '../services/emergencyManager';
import { createEmergencyController } from '../services/emergencyController';
import { createAlertService, buildAlertPayload, buildAlertMessage, planRecipients, overallStatus, AlertStatus } from '../services/alertService';
import {
  memoryStorage, fakeLocation, fakeRecording, fakeAlerts, fakeNotifications, fakePermissions, noHaptics, waitFor,
} from '../test/fakes';

// Automatic emergency message to ALL saved contacts when SOS starts.

const CONTACTS = [
  { id: 'c1', name: 'Asha', phoneNumber: '+91 98765 43210', priority: 0 },
  { id: 'c2', name: 'Ravi', phoneNumber: '98123 45678', priority: 1 },
  { id: 'c3', name: 'Meera', phoneNumber: '+44 7700 900123', priority: 2 },
  { id: 'c4', name: 'Asha (2nd entry)', phoneNumber: '9876543210', priority: 2 },
  { id: 'c5', name: 'Typo', phoneNumber: '12', priority: 2 },
];
const session = { id: 'sess-9', startedAt: '2026-10-22T05:00:00.000Z', triggerSource: 'button' };
const FIX = { latitude: 26.9, longitude: 75.8, accuracy: 8, timestamp: '2026-10-22T05:00:03.000Z' };

describe('emergency message', () => {
  it('uses the requested wording with a clickable Google Maps link', () => {
    const msg = buildAlertMessage({ user: { fullName: 'Priya' }, location: FIX, triggerSource: 'button', startedAt: session.startedAt });
    expect(msg.startsWith('🚨 EMERGENCY ALERT! I need help immediately. My SOS has been activated. Please contact me as soon as possible and help me if needed. My current location: https://www.google.com/maps/search/?api=1&query=26.9,75.8')).toBe(true);
    expect(msg).toMatch(/Priya, via VISHWAS/);
  });

  it('includes the emergency link (location + recordings) when the SOS is backed up', () => {
    const url = 'https://adabhishek1.in/api/share/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
    const msg = buildAlertMessage({ user: { fullName: 'Priya' }, location: FIX, triggerSource: 'button', startedAt: session.startedAt, shareUrl: url });
    expect(msg).toContain(`Live location and my video/audio recordings: ${url}`);
    expect(msg.startsWith('🚨 EMERGENCY ALERT!')).toBe(true);
    expect(buildAlertMessage({ user: null, location: FIX, triggerSource: 'button', startedAt: session.startedAt })).not.toMatch(/\/share\//);
  });

  it('is still sent without a location', () => {
    const msg = buildAlertMessage({ user: null, location: null, triggerSource: 'button', startedAt: session.startedAt });
    expect(msg).toMatch(/^🚨 EMERGENCY ALERT!/);
    expect(msg).toMatch(/My current location could not be determined\./);
    expect(msg).not.toMatch(/google\.com/);
  });
});

describe('recipients', () => {
  it('texts every valid contact once and reports invalid and duplicate numbers', () => {
    const { send, skipped } = planRecipients(CONTACTS);
    expect(send.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'c4', status: AlertStatus.duplicate }),
      expect.objectContaining({ id: 'c5', status: AlertStatus.invalidNumber }),
    ]));
  });

  it('overall status: all sent / partial / failed / delivered', () => {
    const r = (status) => ({ status });
    expect(overallStatus([r('sent'), r('delivered'), r('invalidNumber')])).toBe(AlertStatus.sent);
    expect(overallStatus([r('delivered'), r('delivered')])).toBe(AlertStatus.delivered);
    expect(overallStatus([r('sent'), r('failed')])).toBe(AlertStatus.partial);
    expect(overallStatus([r('failed'), r('duplicate')])).toBe(AlertStatus.failed);
  });
});

describe('server channel', () => {
  const payload = () => buildAlertPayload({ session, location: FIX, contacts: CONTACTS, user: { id: 'u', fullName: 'Priya' } });

  it('posts every valid contact and maps the per-contact results', async () => {
    const post = jest.fn(async (_path, body) => ({
      recipients: body.contacts.map((c) => ({ contactId: c.id, status: c.id === 'c3' ? 'failed' : 'sent', error: c.id === 'c3' ? 'Carrier rejected' : null })),
    }));
    const svc = createAlertService({ post, apiConfigured: () => true });
    const res = await svc.sendAutomatic(payload());
    expect(post).toHaveBeenCalledWith('/alerts/emergency', expect.objectContaining({ sessionId: 'sess-9' }));
    expect(post.mock.calls[0][1].contacts).toHaveLength(3);
    expect(res.method).toBe('server');
    expect(res.status).toBe(AlertStatus.partial);
    const byId = Object.fromEntries(res.recipients.map((x) => [x.contactId, x]));
    expect(byId.c1.status).toBe('sent');
    expect(byId.c3).toMatchObject({ status: 'failed', error: 'Carrier rejected' });
    expect(byId.c4.status).toBe('duplicate');
    expect(byId.c5.status).toBe('invalidNumber');
  });

  it('a server/network failure never loses the alert: it falls back to Messages', async () => {
    const svc = createAlertService({ post: jest.fn(async () => { throw new Error('No internet connection'); }), apiConfigured: () => true });
    const res = await svc.sendAutomatic(payload());
    expect(res).toMatchObject({ method: 'manual', status: AlertStatus.manualRequired, serverError: 'No internet connection' });
  });

  it('checkDelivery merges carrier delivery reports', async () => {
    const get = jest.fn(async () => ({ recipients: [{ contactId: 'c1', status: 'delivered' }] }));
    const svc = createAlertService({ get, apiConfigured: () => true });
    const res = await svc.checkDelivery('sess-9', [{ contactId: 'c1', status: 'sent' }, { contactId: 'c2', status: 'sent' }]);
    expect(get).toHaveBeenCalledWith('/alerts/sess-9');
    expect(res.recipients.map((r) => r.status)).toEqual(['delivered', 'sent']);
  });
});

describe('SOS → automatic messages (controller)', () => {
  function setup(alerts, platform = 'android', cloud = undefined) {
    const manager = createEmergencyManager({ storage: memoryStorage() });
    const deps = {
      manager, alerts, platform, ...(cloud ? { cloud } : {}),
      recording: fakeRecording(), location: fakeLocation({ fix: FIX }), notifications: fakeNotifications(),
      permissions: fakePermissions(), haptics: noHaptics, deliveryPollMs: 20,
    };
    const controller = createEmergencyController(deps);
    controller.setContext({ contacts: CONTACTS, user: { id: 'u1', fullName: 'Priya' } });
    return { controller, manager, alerts };
  }

  const serverResult = (statusFor) => async (payload) => ({
    method: 'server',
    status: 'sent',
    message: payload.message,
    recipients: [
      ...payload.contacts.map((c) => ({ contactId: c.id, name: c.name, phoneNumber: c.phoneNumber, status: statusFor(c.id) })),
      ...payload.skipped.map((c) => ({ contactId: c.id, name: c.name, phoneNumber: c.phoneNumber, status: c.status })),
    ],
  });

  it('SOS sends to all contacts with no extra tap, once per SOS, and again for a new SOS', async () => {
    const alerts = fakeAlerts();
    alerts.sendAutomatic.mockImplementation(serverResult(() => 'sent'));
    const t = setup(alerts);
    t.controller.startEmergency('button');
    t.controller.startEmergency('button'); // pressed again during the same emergency
    t.controller.startEmergency('tripleTap');
    await waitFor(() => expect(t.manager.getSnapshot().activeSession.alerts?.method).toBe('server'));
    expect(alerts.sendAutomatic).toHaveBeenCalledTimes(1);
    expect(alerts.sendAutomatic.mock.calls[0][0].contacts.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(alerts.sendViaComposer).not.toHaveBeenCalled();
    expect(t.manager.getSnapshot().log.map((e) => e.message)).toContain('📡 Emergency SMS sent automatically to 3 of 3 contacts');

    await t.controller.endEmergency('resolve');
    t.controller.startEmergency('button'); // a genuinely new SOS
    await waitFor(() => expect(alerts.sendAutomatic).toHaveBeenCalledTimes(2));
    expect(alerts.sendAutomatic.mock.calls[1][0].sessionId).not.toBe(alerts.sendAutomatic.mock.calls[0][0].sessionId);
    await t.controller.endEmergency('resolve');
  });

  it('the automatic SMS and the Messages fallback both carry this SOS’s emergency link', async () => {
    const shareUrl = 'https://adabhishek1.in/api/share/tok_0123456789abcdefghijklmnopqrstuvwxyzAB';
    const cloud = { sosStarted: jest.fn(() => ({ shareUrl })), location: jest.fn(), sosEnded: jest.fn() };
    const alerts = fakeAlerts();
    alerts.sendAutomatic.mockImplementation(serverResult(() => 'failed'));
    const t = setup(alerts, 'android', cloud);
    t.controller.startEmergency('button');
    await waitFor(() => expect(alerts.sendAutomatic).toHaveBeenCalledTimes(1));
    expect(cloud.sosStarted.mock.calls[0][0].id).toBe(alerts.sendAutomatic.mock.calls[0][0].sessionId);
    expect(alerts.sendAutomatic.mock.calls[0][0].message).toContain(shareUrl);
    expect(t.manager.getSnapshot().activeSession.shareUrl).toBe(shareUrl);
    await waitFor(() => expect(t.manager.getSnapshot().activeSession.alerts?.method).toBe('server'));
    await t.controller.openSmsComposer();
    expect(alerts.sendViaComposer.mock.calls[0][0].message).toContain(shareUrl);
    await t.controller.endEmergency('resolve');
  });

  it('polls delivery reports and shows delivered / failed per contact', async () => {
    const alerts = fakeAlerts();
    alerts.sendAutomatic.mockImplementation(serverResult(() => 'sent'));
    alerts.checkDelivery.mockImplementation(async (_id, recipients) => ({
      status: 'partial',
      recipients: recipients.map((r) => (r.contactId === 'c1' ? { ...r, status: 'delivered' } : r.contactId === 'c2' ? { ...r, status: 'failed', error: 'Not delivered (carrier error 30003)' } : r)),
    }));
    const t = setup(alerts);
    t.controller.startEmergency('button');
    await waitFor(() => expect(t.manager.getSnapshot().log.map((e) => e.message)).toContain('📬 Delivered to Asha'));
    expect(t.manager.getSnapshot().log.map((e) => e.message)).toContain('📬 Not delivered to Ravi: Not delivered (carrier error 30003)');
    await t.controller.endEmergency('resolve');
  });

  it('on iOS, Messages opens only for the contacts the server could not reach', async () => {
    const alerts = fakeAlerts();
    alerts.sendAutomatic.mockImplementation(serverResult((id) => (id === 'c3' ? 'failed' : 'sent')));
    const t = setup(alerts, 'ios');
    t.controller.startEmergency('button');
    await waitFor(() => expect(alerts.sendViaComposer).toHaveBeenCalled());
    expect(alerts.sendViaComposer.mock.calls[0][0].contacts.map((c) => c.id)).toEqual(['c3']);
    await waitFor(() => {
      const r = t.manager.getSnapshot().activeSession.alerts.recipients.find((x) => x.contactId === 'c3');
      expect(r.status).toBe('sentByUser');
    });
    await t.controller.endEmergency('resolve');
  });
});
