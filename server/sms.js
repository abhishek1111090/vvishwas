'use strict';
// sms.js — the message provider (Twilio: SMS + WhatsApp). Kept behind a tiny
// interface ({ send(to, body, { whatsapp, mediaUrl }) → { ok, sid, status,
// error } }) so another provider can be swapped in without touching the
// alert logic.
//
// WhatsApp goes through the WhatsApp Business Platform (Twilio's WhatsApp
// sender or Sandbox): messages come from that business number, never from
// the user's personal WhatsApp — no API allows that.

const crypto = require('node:crypto');

/** Twilio status → VISHWAS recipient status. */
function mapTwilioStatus(status) {
  switch (status) {
    case 'delivered':
      return 'delivered';
    case 'undelivered':
    case 'failed':
    case 'canceled':
      return 'failed';
    default:
      return 'sent'; // accepted / queued / sending / sent: handed to the carrier, not yet confirmed
  }
}

function createTwilioProvider({
  accountSid,
  authToken,
  from,
  messagingServiceSid,
  whatsappFrom,
  statusCallbackUrl,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15000,
}) {
  if (!accountSid || !authToken || (!from && !messagingServiceSid && !whatsappFrom)) {
    throw new Error('Twilio needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and a sender: TWILIO_FROM / TWILIO_MESSAGING_SERVICE_SID (SMS) and/or TWILIO_WHATSAPP_FROM.');
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
  const auth = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;

  const waFrom = whatsappFrom ? (whatsappFrom.startsWith('whatsapp:') ? whatsappFrom : `whatsapp:${whatsappFrom}`) : null;

  return {
    name: 'twilio',
    supportsSms: !!(from || messagingServiceSid),
    supportsWhatsApp: !!waFrom,
    async send(to, body, { whatsapp = false, mediaUrl = null } = {}) {
      if (whatsapp && !waFrom) return { ok: false, error: 'WhatsApp sender not configured' };
      const form = new URLSearchParams({ To: whatsapp ? `whatsapp:${to}` : to, Body: body });
      if (whatsapp) form.set('From', waFrom);
      else if (messagingServiceSid) form.set('MessagingServiceSid', messagingServiceSid);
      else form.set('From', from);
      if (mediaUrl) form.set('MediaUrl', mediaUrl);
      if (statusCallbackUrl) form.set('StatusCallback', statusCallbackUrl);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
          signal: controller.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          return { ok: false, error: data.message || `Twilio error ${res.status}`, code: data.code ?? null };
        }
        if (data.error_code) {
          return { ok: false, sid: data.sid, error: data.error_message || `Twilio error ${data.error_code}`, code: data.error_code };
        }
        return { ok: true, sid: data.sid, status: mapTwilioStatus(data.status) };
      } catch (err) {
        return { ok: false, error: err.name === 'AbortError' ? 'SMS provider did not respond in time' : 'Could not reach the SMS provider' };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * Twilio signs every status callback: base64(HMAC-SHA1(authToken,
 * fullUrl + each POST param name+value in name order)).
 */
function isValidTwilioSignature({ authToken, url, params, signature }) {
  if (!authToken || !signature) return false;
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
  const expected = crypto.createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { createTwilioProvider, isValidTwilioSignature, mapTwilioStatus };
