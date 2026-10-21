import { createAlertService, buildAlertPayload, buildAlertMessage, orderContacts, AlertStatus } from '../services/alertService';

const session = { id: 'sess-1', startedAt: '2026-10-20T10:00:00.000Z', triggerSource: 'tripleTap' };
const contacts = [
  { id: 'b', name: 'Ravi', phoneNumber: '98123 45678', priority: 1, isFavorite: false },
  { id: 'a', name: 'Asha', phoneNumber: '+91 98765-43210', priority: 0, isFavorite: true },
];
const location = { latitude: 26.9, longitude: 75.8, accuracy: 12, timestamp: '2026-10-20T10:00:05.000Z' };
const payload = () => buildAlertPayload({ session, location, contacts, user: { id: 'u', fullName: 'Priya' } });

function fakeSms(result = 'sent', available = true) {
  return { isAvailableAsync: jest.fn(async () => available), sendSMSAsync: jest.fn(async () => ({ result })) };
}

describe('alertService', () => {
  it('builds the payload with session, location and ordered, normalized contacts', () => {
    const p = payload();
    expect(p).toMatchObject({ sessionId: 'sess-1', triggerSource: 'tripleTap' });
    expect(p.location.mapsUrl).toContain('26.9,75.8');
    expect(p.contacts.map((c) => c.phoneNumber)).toEqual(['+919876543210', '9812345678']);
    expect(p.message).toMatch(/Priya.*Triple Tap/);
  });

  it('says location is unavailable instead of inventing one', () => {
    expect(buildAlertMessage({ user: null, location: null, triggerSource: 'button', startedAt: session.startedAt })).toMatch(/not available yet/);
  });

  it('orders contacts by priority then favorite', () => {
    expect(orderContacts(contacts).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('without a server, automatic sending requires manual action', async () => {
    const res = await createAlertService({ apiConfigured: () => false }).sendAutomatic(payload());
    expect(res.method).toBe('manual');
    expect(res.recipients.every((r) => r.status === AlertStatus.manualRequired)).toBe(true);
  });

  it('server success is "accepted", never "delivered"', async () => {
    const post = jest.fn(async () => ({ ok: true }));
    const res = await createAlertService({ apiConfigured: () => true, post }).sendAutomatic(payload());
    expect(post).toHaveBeenCalledWith('/alerts/emergency', expect.objectContaining({ sessionId: 'sess-1' }));
    expect(res.status).toBe(AlertStatus.accepted);
  });

  it('server failure falls back to manual with the error kept', async () => {
    const res = await createAlertService({ apiConfigured: () => true, post: jest.fn().mockRejectedValue(new Error('Server error (500).')) }).sendAutomatic(payload());
    expect(res.method).toBe('manual');
    expect(res.serverError).toBe('Server error (500).');
  });

  it('maps the Messages composer result honestly', async () => {
    const sms = fakeSms('sent');
    const sent = await createAlertService({ sms }).sendViaComposer(payload());
    expect(sms.sendSMSAsync).toHaveBeenCalledWith(['+919876543210', '9812345678'], expect.stringMatching(/^EMERGENCY/));
    expect(sent.status).toBe(AlertStatus.sentByUser);
    expect((await createAlertService({ sms: fakeSms('cancelled') }).sendViaComposer(payload())).status).toBe(AlertStatus.cancelled);
    expect((await createAlertService({ sms: fakeSms('unknown') }).sendViaComposer(payload())).status).toBe(AlertStatus.composerOpened);
  });

  it('reports devices that cannot send SMS', async () => {
    const res = await createAlertService({ sms: fakeSms('sent', false) }).sendViaComposer(payload());
    expect(res.status).toBe(AlertStatus.unavailable);
  });

  it('reports noContacts without opening anything', async () => {
    const sms = fakeSms();
    const res = await createAlertService({ sms }).sendViaComposer(buildAlertPayload({ session, location, contacts: [], user: null }));
    expect(res.status).toBe(AlertStatus.noContacts);
    expect(sms.sendSMSAsync).not.toHaveBeenCalled();
  });
});
