import * as SMS from 'expo-sms';
import { apiPost, apiGet, isApiConfigured } from './apiClient';
import { mapsUrl } from './locationService';
import { osmUrl } from './geoService';
import { floorLabel } from './floorService';
import { TRIGGER_SOURCE } from '../utils/constants';
import { normalizePhone, validatePhone } from '../utils/validation';

/**
 * alertService.js — notify emergency contacts
 *
 *  1. VISHWAS server (if EXPO_PUBLIC_VISHWAS_API_URL is set): POST
 *     /alerts/emergency. The server texts every contact through its SMS
 *     provider with no tap needed and returns a status per contact:
 *     'sent' (handed to the carrier) -> 'delivered' only when the carrier's
 *     delivery report arrives (checkDelivery polls for it).
 *  2. SMS composer (expo-sms): opens Messages prefilled with every contact
 *     and the alert text. Neither iOS nor Expo Go lets an app send SMS
 *     silently, so the user presses Send.
 *       iOS     → reports 'sent' (user pressed Send; message handed to
 *                 Messages) or 'cancelled'
 *       Android → reports 'unknown': we only know the SMS app was opened
 *
 * Nothing here reports success the platform didn't confirm.
 */

export const AlertStatus = {
  pending: 'pending',
  sending: 'sending',
  accepted: 'accepted',             // server accepted the job
  sentByUser: 'sentByUser',         // iOS: user pressed Send in Messages
  composerOpened: 'composerOpened', // Android: SMS app opened, outcome unknown
  cancelled: 'cancelled',           // user closed Messages without sending
  failed: 'failed',
  manualRequired: 'manualRequired', // nothing sent yet — user must act
  unavailable: 'unavailable',       // device can't send SMS
  noContacts: 'noContacts',
  sent: 'sent',                     // server: handed to the carrier
  delivered: 'delivered',           // server: carrier delivery report
  invalidNumber: 'invalidNumber',   // not a usable phone number - skipped
  duplicate: 'duplicate',           // same number as another contact - texted once
  partial: 'partial',               // overall: some contacts sent, some not
};

export const ALERT_STATUS_LABEL = {
  pending: 'Pending',
  sending: 'Sending…',
  accepted: 'Accepted by server',
  sentByUser: 'Sent from Messages',
  composerOpened: 'SMS app opened — not confirmed sent',
  cancelled: 'Not sent — SMS cancelled',
  failed: 'Failed',
  manualRequired: 'Not sent yet — tap "Text contacts"',
  unavailable: 'This device can’t send SMS',
  noContacts: 'No contacts',
  sent: 'Sent — waiting for delivery report',
  delivered: 'Delivered',
  invalidNumber: 'Invalid phone number — not sent',
  duplicate: 'Same number as another contact',
  partial: 'Sent to some contacts',
};

export const CONFIRMED_STATUSES = [AlertStatus.accepted, AlertStatus.sentByUser, AlertStatus.sent, AlertStatus.delivered];
/** Contacts that can't or needn't be texted again. */
export const SKIPPED_STATUSES = [AlertStatus.invalidNumber, AlertStatus.duplicate];

/** Valid, de-duplicated contacts to text + the ones skipped and why. */
export function planRecipients(contacts) {
  const seen = new Set();
  const send = [];
  const skipped = [];
  for (const c of orderContacts(contacts)) {
    const phone = normalizePhone(c.phoneNumber);
    const base = { id: c.id, name: c.name, phoneNumber: phone, relationship: c.relationship ?? '', priority: c.priority };
    // Compare on the last 10 digits so "+91 98765…" and "98765…" count as one number.
    const key = phone.replace(/\D/g, '').slice(-10);
    if (validatePhone(c.phoneNumber)) skipped.push({ ...base, status: AlertStatus.invalidNumber });
    else if (seen.has(key)) skipped.push({ ...base, status: AlertStatus.duplicate });
    else {
      seen.add(key);
      send.push(base);
    }
  }
  return { send, skipped };
}

/** Contacts ordered by priority, then favorites, then name. */
export function orderContacts(contacts) {
  return [...contacts].sort(
    (a, b) =>
      (a.priority ?? 9) - (b.priority ?? 9) ||
      Number(b.isFavorite) - Number(a.isFavorite) ||
      String(a.name).localeCompare(String(b.name))
  );
}

/**
 * Floor text for alerts. A floor the person confirmed always wins; a
 * barometer estimate is clearly marked as approximate; otherwise nothing
 * is claimed.
 */
export function describeFloor(floor) {
  if (floor?.confirmed !== null && floor?.confirmed !== undefined) return `${floorLabel(floor.confirmed)} (confirmed by them)`;
  if (floor?.estimate) return `about ${floorLabel(floor.estimate.floor)} (barometer estimate, ±${floor.estimate.uncertainty} floors)`;
  return null;
}

export const ALERT_PREFIX = '🚨 EMERGENCY ALERT!';

export function buildAlertMessage({ user, location, triggerSource, startedAt, address, floor }) {
  const parts = [
    `${ALERT_PREFIX} I need help immediately. My SOS has been activated. Please contact me as soon as possible and help me if needed.`,
  ];
  parts.push(location ? `My current location: ${mapsUrl(location)}` : 'My current location could not be determined.');
  if (address?.label) parts.push(`Address: ${address.label}.`);
  const floorText = describeFloor(floor);
  if (floorText) parts.push(`Floor: ${floorText}.`);
  if (location) parts.push(`(GPS ±${location.accuracy ?? '?'} m at ${new Date(location.timestamp).toLocaleTimeString()})`);
  // Server texts arrive from the SMS provider's number, so say who this is.
  const who = user?.fullName?.trim();
  const when = new Date(startedAt).toLocaleString();
  parts.push(`— ${who ? `${who}, ` : ''}via VISHWAS (${TRIGGER_SOURCE[triggerSource] ?? triggerSource}, ${when}).`);
  return parts.join(' ');
}

export function buildAlertPayload({ session, location, contacts, user }) {
  const address = session.address ?? null;
  const floor = session.floor ?? null;
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
          osmUrl: osmUrl(location),
        }
      : null,
    address: address ? { label: address.label, source: address.source } : null,
    floor: floor
      ? {
          confirmed: floor.confirmed ?? null,
          estimate: floor.estimate ? { floor: floor.estimate.floor, uncertainty: floor.estimate.uncertainty, source: floor.estimate.source } : null,
        }
      : null,
    user: user ? { id: user.id, fullName: user.fullName } : null,
    ...(({ send, skipped }) => ({ contacts: send, skipped }))(planRecipients(contacts)),
    message: buildAlertMessage({ user, location, triggerSource: session.triggerSource, startedAt: session.startedAt, address, floor }),
  };
}

function recipientsFrom(payload, status, extra = {}) {
  return [
    ...payload.contacts.map((c) => ({ contactId: c.id, name: c.name, phoneNumber: c.phoneNumber, status, ...extra })),
    ...(payload.skipped ?? []).map((c) => ({ contactId: c.id, name: c.name, phoneNumber: c.phoneNumber, status: c.status })),
  ];
}

const SERVER_STATUS = { sent: AlertStatus.sent, delivered: AlertStatus.delivered, failed: AlertStatus.failed, invalidNumber: AlertStatus.invalidNumber, duplicate: AlertStatus.duplicate };

/** Merge the server's per-contact report into our recipient list. */
function mergeServerRecipients(recipients, serverRecipients) {
  if (!Array.isArray(serverRecipients)) return recipients;
  const byId = new Map(serverRecipients.map((r) => [String(r.contactId), r]));
  return recipients.map((r) => {
    const s = byId.get(String(r.contactId));
    if (!s) return r;
    return { ...r, status: SERVER_STATUS[s.status] ?? AlertStatus.sent, error: s.error ?? null, sms: s.sms ?? null, whatsapp: s.whatsapp ?? null };
  });
}

/** Overall status from the per-contact ones. */
export function overallStatus(recipients) {
  const live = recipients.filter((r) => !SKIPPED_STATUSES.includes(r.status));
  if (live.length === 0) return AlertStatus.failed;
  const ok = live.filter((r) => CONFIRMED_STATUSES.includes(r.status)).length;
  if (ok === live.length) return live.every((r) => r.status === AlertStatus.delivered) ? AlertStatus.delivered : AlertStatus.sent;
  return ok === 0 ? AlertStatus.failed : AlertStatus.partial;
}

const SMS_RESULT = { sent: AlertStatus.sentByUser, cancelled: AlertStatus.cancelled, unknown: AlertStatus.composerOpened };

export function createAlertService({ sms = SMS, post = apiPost, get = apiGet, apiConfigured = isApiConfigured } = {}) {
  return {
    /** Automatic channel: the server only. Never throws. */
    async sendAutomatic(payload) {
      if (payload.contacts.length === 0) {
        if ((payload.skipped ?? []).length > 0) {
          return { method: 'none', status: AlertStatus.failed, recipients: recipientsFrom(payload, AlertStatus.failed), message: payload.message, error: 'No contact has a valid phone number' };
        }
        return { method: 'none', status: AlertStatus.noContacts, recipients: [], message: payload.message };
      }
      if (apiConfigured()) {
        try {
          const res = await post('/alerts/emergency', payload);
          if (!Array.isArray(res?.recipients)) {
            // Older server: it accepted the job but reports nothing per contact.
            return { method: 'server', status: AlertStatus.accepted, recipients: recipientsFrom(payload, AlertStatus.accepted), message: payload.message };
          }
          const recipients = mergeServerRecipients(recipientsFrom(payload, AlertStatus.sending), res.recipients);
          return { method: 'server', status: overallStatus(recipients), recipients, message: payload.message, whatsapp: res.channels?.whatsapp === true };
        } catch (err) {
          return {
            method: 'manual',
            status: AlertStatus.manualRequired,
            recipients: recipientsFrom(payload, AlertStatus.manualRequired),
            message: payload.message,
            serverError: err?.message ?? 'Server error',
          };
        }
      }
      return { method: 'manual', status: AlertStatus.manualRequired, recipients: recipientsFrom(payload, AlertStatus.manualRequired), message: payload.message };
    },

    /** Latest per-contact delivery status from the server, or null. Never throws. */
    async checkDelivery(sessionId, recipients) {
      if (!apiConfigured()) return null;
      try {
        const res = await get(`/alerts/${encodeURIComponent(sessionId)}`);
        const merged = mergeServerRecipients(recipients, res?.recipients);
        return { recipients: merged, status: overallStatus(merged) };
      } catch {
        return null;
      }
    },

    /** Open Messages prefilled for every contact; returns the REAL outcome. Never throws. */
    async sendViaComposer(payload) {
      if (payload.contacts.length === 0) {
        return { method: 'none', status: AlertStatus.noContacts, recipients: [], message: payload.message };
      }
      try {
        if (!(await sms.isAvailableAsync())) {
          return { method: 'sms', status: AlertStatus.unavailable, recipients: recipientsFrom(payload, AlertStatus.unavailable), message: payload.message };
        }
        const { result } = await sms.sendSMSAsync(payload.contacts.map((c) => c.phoneNumber), payload.message);
        const status = SMS_RESULT[result] ?? AlertStatus.composerOpened;
        return { method: 'sms', status, recipients: recipientsFrom(payload, status), message: payload.message };
      } catch (err) {
        return {
          method: 'sms',
          status: AlertStatus.failed,
          recipients: recipientsFrom(payload, AlertStatus.failed, { error: err?.message ?? 'Could not open Messages' }),
          message: payload.message,
          error: err?.message ?? 'Could not open Messages',
        };
      }
    },
  };
}

export const alertService = createAlertService();
