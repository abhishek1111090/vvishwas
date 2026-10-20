import { VishwasNative } from '../platform/vishwasNative';
import { isAndroid } from '../platform/platform';
import { apiPost, isApiConfigured } from './apiClient';
import { mapsUrl } from './locationService';
import { TRIGGER_SOURCE } from '../utils/constants';
import { normalizePhone } from '../utils/validation';

/**
 * alertService.js — notify emergency contacts
 *
 * Delivery mechanisms, in order:
 *
 *  1. VISHWAS server (if VITE_VISHWAS_API_URL is configured): POST
 *     /alerts/emergency. A 2xx response only means the server ACCEPTED the
 *     alert — reported as 'accepted', never 'delivered', unless the server
 *     returns per-recipient delivery results.
 *
 *  2. Android app with SEND_SMS granted: SmsManager sends directly. Each
 *     recipient's result comes from the carrier's sent-intent:
 *     'sent' = handed to the carrier, 'failed' = carrier/radio error.
 *     'delivered' only arrives later if the carrier supports delivery
 *     reports (smsStatus events update the session).
 *
 *  3. Otherwise (iOS, web, Android without SMS permission): we can't send
 *     silently. The overlay offers "Text contacts", which opens the SMS
 *     composer prefilled. Opening the composer is recorded as
 *     'composerOpened' — NOT as sent, because only the user's tap on Send
 *     sends it and the OS doesn't tell us whether they did.
 *
 * Nothing in here ever reports success that the platform didn't confirm.
 */

export const AlertStatus = {
  pending: 'pending',
  sending: 'sending',
  accepted: 'accepted',             // server accepted the job
  sent: 'sent',                     // carrier accepted the SMS
  delivered: 'delivered',           // carrier delivery report
  failed: 'failed',
  composerOpened: 'composerOpened', // user must press Send themselves
  manualRequired: 'manualRequired', // no automatic channel — user action needed
  noContacts: 'noContacts',
};

export const ALERT_STATUS_LABEL = {
  pending: 'Pending',
  sending: 'Sending…',
  accepted: 'Accepted by server',
  sent: 'Sent to carrier',
  delivered: 'Delivered',
  failed: 'Failed',
  composerOpened: 'SMS app opened — not confirmed sent',
  manualRequired: 'Not sent — tap "Text contacts"',
  noContacts: 'No contacts',
};

/** Contacts ordered by priority, then favorites, then name. */
export function orderContacts(contacts) {
  return [...contacts].sort(
    (a, b) =>
      (a.priority ?? 9) - (b.priority ?? 9) ||
      Number(b.isFavorite) - Number(a.isFavorite) ||
      String(a.name).localeCompare(String(b.name))
  );
}

export function buildAlertMessage({ user, location, triggerSource, startedAt }) {
  const who = user?.fullName?.trim() || 'A VISHWAS user';
  const when = new Date(startedAt).toLocaleString();
  const where = location
    ? `Location: ${mapsUrl(location)} (±${location.accuracy ?? '?'}m at ${new Date(location.timestamp).toLocaleTimeString()})`
    : 'Location: not available yet.';
  return `EMERGENCY: ${who} triggered an SOS on VISHWAS (${TRIGGER_SOURCE[triggerSource] ?? triggerSource}) at ${when}. ${where} Please call them or contact emergency services (112).`;
}

/** The payload sent to the server and stored with the session. */
export function buildAlertPayload({ session, location, contacts, user }) {
  return {
    sessionId: session.id,
    timestamp: session.startedAt,
    triggerSource: session.triggerSource,
    location: location
      ? {
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy,
          timestamp: location.timestamp,
          mapsUrl: mapsUrl(location),
        }
      : null,
    user: user ? { id: user.id, fullName: user.fullName } : null,
    contacts: orderContacts(contacts).map((c) => ({
      id: c.id,
      name: c.name,
      phoneNumber: normalizePhone(c.phoneNumber),
      relationship: c.relationship ?? '',
      priority: c.priority,
    })),
    message: buildAlertMessage({ user, location, triggerSource: session.triggerSource, startedAt: session.startedAt }),
  };
}

function recipientsFrom(payload, status, extra = {}) {
  return payload.contacts.map((c) => ({ contactId: c.id, name: c.name, phoneNumber: c.phoneNumber, status, ...extra }));
}

/** SMS composer URI that works on Android and iOS for one or more recipients. */
export function smsComposerUri(phoneNumbers, body, platform = isAndroid() ? 'android' : 'ios') {
  const to = phoneNumbers.join(',');
  const sep = platform === 'android' ? '?' : '&';
  return `sms:${to}${sep}body=${encodeURIComponent(body)}`;
}

export function createAlertService({ native = VishwasNative, post = apiPost, apiConfigured = isApiConfigured, android = isAndroid } = {}) {
  return {
    /**
     * Try automatic delivery. Resolves with
     * { method, status, recipients: [...], message, error? } — never throws.
     * `checkSmsPermission` lets callers skip SMS when it isn't granted.
     */
    async sendAutomatic(payload, { smsGranted = false } = {}) {
      if (payload.contacts.length === 0) {
        return { method: 'none', status: AlertStatus.noContacts, recipients: [], message: payload.message };
      }

      // 1. Server
      if (apiConfigured()) {
        try {
          const data = await post('/alerts/emergency', payload);
          const serverRecipients = Array.isArray(data?.recipients) ? data.recipients : null;
          return {
            method: 'server',
            status: AlertStatus.accepted,
            recipients: serverRecipients
              ? recipientsFrom(payload, AlertStatus.accepted).map((r) => {
                  const match = serverRecipients.find((s) => s.phoneNumber === r.phoneNumber);
                  const status = Object.values(AlertStatus).includes(match?.status) ? match.status : AlertStatus.accepted;
                  return { ...r, status };
                })
              : recipientsFrom(payload, AlertStatus.accepted),
            message: payload.message,
          };
        } catch (err) {
          // Fall through to SMS; keep the server error for the timeline.
          const serverError = err?.message ?? 'Server error';
          const sms = await this._trySms(payload, smsGranted);
          return { ...sms, serverError };
        }
      }

      // 2. Native SMS (Android)
      return this._trySms(payload, smsGranted);
    },

    async _trySms(payload, smsGranted) {
      if (!android() || !smsGranted) {
        return {
          method: 'manual',
          status: AlertStatus.manualRequired,
          recipients: recipientsFrom(payload, AlertStatus.manualRequired),
          message: payload.message,
        };
      }
      try {
        const result = await native.sendSms({
          requestId: payload.sessionId,
          recipients: payload.contacts.map((c) => c.phoneNumber),
          message: payload.message,
        });
        const byPhone = new Map((result?.results ?? []).map((r) => [r.phoneNumber, r]));
        const recipients = payload.contacts.map((c) => {
          const r = byPhone.get(c.phoneNumber);
          const status = r?.status === 'sent' ? AlertStatus.sent : AlertStatus.failed;
          return {
            contactId: c.id,
            name: c.name,
            phoneNumber: c.phoneNumber,
            status,
            error: status === AlertStatus.failed ? (r?.error ?? 'No result from carrier') : undefined,
          };
        });
        const anySent = recipients.some((r) => r.status === AlertStatus.sent);
        return {
          method: 'sms',
          status: anySent ? AlertStatus.sent : AlertStatus.failed,
          recipients,
          message: payload.message,
        };
      } catch (err) {
        return {
          method: 'sms',
          status: AlertStatus.failed,
          recipients: recipientsFrom(payload, AlertStatus.failed, { error: err?.message ?? 'SMS failed' }),
          message: payload.message,
          error: err?.message ?? 'SMS failed',
        };
      }
    },

    /** Open the SMS composer prefilled (user must press Send). */
    openComposer(payload, openUrl = (url) => { window.location.href = url; }) {
      const uri = smsComposerUri(payload.contacts.map((c) => c.phoneNumber), payload.message);
      openUrl(uri);
      return AlertStatus.composerOpened;
    },

    /** Subscribe to delivery reports from the Android SMS sender. */
    onSmsStatus(callback) {
      const handle = native.addListener('smsStatus', callback);
      return () => {
        Promise.resolve(handle).then((h) => h?.remove?.()).catch(() => {});
      };
    },
  };
}

export const alertService = createAlertService();
