import * as SMS from 'expo-sms';
import { apiPost, isApiConfigured } from './apiClient';
import { mapsUrl } from './locationService';
import { TRIGGER_SOURCE } from '../utils/constants';
import { normalizePhone } from '../utils/validation';

/**
 * alertService.js — notify emergency contacts
 *
 *  1. VISHWAS server (if EXPO_PUBLIC_VISHWAS_API_URL is set): POST
 *     /alerts/emergency. A 2xx only means ACCEPTED, never "delivered".
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
};

export const CONFIRMED_STATUSES = [AlertStatus.accepted, AlertStatus.sentByUser];

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

const SMS_RESULT = { sent: AlertStatus.sentByUser, cancelled: AlertStatus.cancelled, unknown: AlertStatus.composerOpened };

export function createAlertService({ sms = SMS, post = apiPost, apiConfigured = isApiConfigured } = {}) {
  return {
    /** Automatic channel: the server only. Never throws. */
    async sendAutomatic(payload) {
      if (payload.contacts.length === 0) {
        return { method: 'none', status: AlertStatus.noContacts, recipients: [], message: payload.message };
      }
      if (apiConfigured()) {
        try {
          await post('/alerts/emergency', payload);
          return { method: 'server', status: AlertStatus.accepted, recipients: recipientsFrom(payload, AlertStatus.accepted), message: payload.message };
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
