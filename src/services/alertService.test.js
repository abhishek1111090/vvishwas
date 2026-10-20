import { describe, it, expect, vi } from 'vitest';
import {
  createAlertService, buildAlertPayload, buildAlertMessage, smsComposerUri, orderContacts, AlertStatus,
} from './alertService';

const session = { id: 'sess-1', startedAt: '2026-10-20T10:00:00.000Z', triggerSource: 'tripleTap' };
const contacts = [
  { id: 'b', name: 'Ravi', phoneNumber: '98123 45678', priority: 1, isFavorite: false },
  { id: 'a', name: 'Asha', phoneNumber: '+91 98765-43210', priority: 0, isFavorite: true, relationship: 'Sister' },
];
const location = { latitude: 26.9, longitude: 75.8, accuracy: 12, timestamp: '2026-10-20T10:00:05.000Z' };

function service(overrides = {}) {
  return createAlertService({
    native: { sendSms: vi.fn(), addListener: vi.fn() },
    post: vi.fn(),
    apiConfigured: () => false,
    android: () => true,
    ...overrides,
  });
}

describe('alertService', () => {
  it('builds the emergency payload with session, location and ordered normalized contacts', () => {
    const p = buildAlertPayload({ session, location, contacts, user: { id: 'u', fullName: 'Priya' } });
    expect(p).toMatchObject({ sessionId: 'sess-1', timestamp: session.startedAt, triggerSource: 'tripleTap' });
    expect(p.location.mapsUrl).toContain('26.9,75.8');
    expect(p.contacts.map((c) => c.phoneNumber)).toEqual(['+919876543210', '9812345678']);
    expect(p.message).toMatch(/Priya/);
    expect(p.message).toMatch(/Triple Tap/);
  });

  it('message says location is unavailable instead of inventing one', () => {
    expect(buildAlertMessage({ user: null, location: null, triggerSource: 'button', startedAt: session.startedAt }))
      .toMatch(/Location: not available yet/);
  });

  it('orders contacts by priority then favorite', () => {
    expect(orderContacts(contacts).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('reports noContacts without sending', async () => {
    const svc = service();
    const res = await svc.sendAutomatic(buildAlertPayload({ session, location, contacts: [], user: null }), { smsGranted: true });
    expect(res.status).toBe(AlertStatus.noContacts);
  });

  it('requires manual action when SMS permission is not granted', async () => {
    const svc = service();
    const res = await svc.sendAutomatic(buildAlertPayload({ session, location, contacts, user: null }), { smsGranted: false });
    expect(res.method).toBe('manual');
    expect(res.recipients.every((r) => r.status === AlertStatus.manualRequired)).toBe(true);
  });

  it('requires manual action on iOS / web even if asked', async () => {
    const svc = service({ android: () => false });
    const res = await svc.sendAutomatic(buildAlertPayload({ session, location, contacts, user: null }), { smsGranted: true });
    expect(res.method).toBe('manual');
  });

  it('maps native SMS results per recipient; missing results count as failed', async () => {
    const sendSms = vi.fn(async () => ({ results: [{ phoneNumber: '+919876543210', status: 'sent' }] }));
    const svc = service({ native: { sendSms, addListener: vi.fn() } });
    const res = await svc.sendAutomatic(buildAlertPayload({ session, location, contacts, user: null }), { smsGranted: true });
    expect(sendSms).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'sess-1', recipients: ['+919876543210', '9812345678'] }));
    expect(res.method).toBe('sms');
    expect(res.status).toBe(AlertStatus.sent);
    expect(res.recipients.find((r) => r.name === 'Asha').status).toBe(AlertStatus.sent);
    expect(res.recipients.find((r) => r.name === 'Ravi').status).toBe(AlertStatus.failed);
  });

  it('a thrown SMS error marks everyone failed', async () => {
    const svc = service({ native: { sendSms: vi.fn().mockRejectedValue(new Error('SMS permission not granted')), addListener: vi.fn() } });
    const res = await svc.sendAutomatic(buildAlertPayload({ session, location, contacts, user: null }), { smsGranted: true });
    expect(res.status).toBe(AlertStatus.failed);
    expect(res.recipients.every((r) => r.status === AlertStatus.failed)).toBe(true);
  });

  it('server success is "accepted", never "delivered"', async () => {
    const post = vi.fn(async () => ({ ok: true }));
    const svc = service({ apiConfigured: () => true, post });
    const res = await svc.sendAutomatic(buildAlertPayload({ session, location, contacts, user: null }));
    expect(post).toHaveBeenCalledWith('/alerts/emergency', expect.objectContaining({ sessionId: 'sess-1' }));
    expect(res.status).toBe(AlertStatus.accepted);
    expect(res.recipients.every((r) => r.status === AlertStatus.accepted)).toBe(true);
  });

  it('falls back to SMS when the server fails, and keeps the server error', async () => {
    const sendSms = vi.fn(async () => ({ results: [{ phoneNumber: '+919876543210', status: 'sent' }, { phoneNumber: '9812345678', status: 'sent' }] }));
    const svc = service({ apiConfigured: () => true, post: vi.fn().mockRejectedValue(new Error('Server error (500).')), native: { sendSms, addListener: vi.fn() } });
    const res = await svc.sendAutomatic(buildAlertPayload({ session, location, contacts, user: null }), { smsGranted: true });
    expect(res.method).toBe('sms');
    expect(res.serverError).toBe('Server error (500).');
  });

  it('builds SMS composer URIs for Android and iOS', () => {
    expect(smsComposerUri(['+911', '+912'], 'Help me', 'android')).toBe('sms:+911,+912?body=Help%20me');
    expect(smsComposerUri(['+911'], 'Help & me', 'ios')).toBe('sms:+911&body=Help%20%26%20me');
  });

  it('openComposer reports composerOpened (not sent)', () => {
    const open = vi.fn();
    const status = service().openComposer(buildAlertPayload({ session, location, contacts, user: null }), open);
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/^sms:/));
    expect(status).toBe(AlertStatus.composerOpened);
  });
});
