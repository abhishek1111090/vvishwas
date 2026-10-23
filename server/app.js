'use strict';
// app.js — the VISHWAS alert server's HTTP handler (no framework, Node 18+).
//
//   POST /alerts/emergency          app → server: SOS text to every contact (SMS and/or WhatsApp)
//   POST /alerts/:sessionId/media   app → server: an audio/video clip → sent to every contact on WhatsApp
//   GET  /alerts/:sessionId         app → server: per-contact delivery status
//   GET  /media/:file               Twilio/contacts fetch a clip (unguessable name, kept 24 h)
//   POST /sms/status                Twilio → server: delivery reports (signed)
//   GET  /health
//
// Rules:
//  • One SOS session = one set of messages. Re-posting the same sessionId
//    returns the stored result and never texts anyone twice.
//  • Each contact is sent separately, so one bad number or provider error
//    never stops the others.
//  • Statuses are what the provider reported: 'sent' means handed to the
//    carrier; only a delivery report makes it 'delivered'.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isValidTwilioSignature, mapTwilioStatus } = require('./sms');

const MAX_BODY_BYTES = 32 * 1024;
const MAX_MEDIA_BYTES = 16 * 1024 * 1024; // WhatsApp's media limit
const MEDIA_TYPES = {
  'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac',
  'video/mp4': 'mp4', 'video/quicktime': 'mov',
};
const SERVE_TYPES = { m4a: 'audio/mp4', aac: 'audio/aac', mp4: 'video/mp4', mov: 'video/mp4' };
const RANK = { failed: 0, sending: 1, sent: 2, delivered: 3 };
const MAX_RECIPIENTS = 10;
const MAX_MESSAGE_CHARS = 800;
const REQUIRED_PREFIX = '🚨 EMERGENCY ALERT!';
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX_NEW_ALERTS = 5;
const KEEP_SESSIONS_MS = 24 * 60 * 60 * 1000;

/** Best-effort E.164: "+91 98765-43210", "0098…", or a local number with the default country code. */
function toE164(raw, defaultCountryCode) {
  const s = String(raw ?? '').trim();
  let digits = s.replace(/\D/g, '');
  let plus = s.startsWith('+');
  if (!plus && digits.startsWith('00')) {
    digits = digits.slice(2);
    plus = true;
  }
  if (!plus && defaultCountryCode) {
    const cc = String(defaultCountryCode).replace(/\D/g, '');
    if (digits.startsWith('0')) digits = digits.slice(1);
    digits = digits.startsWith(cc) && digits.length > 10 ? digits : cc + digits;
    plus = true;
  }
  const e164 = `+${digits}`;
  return plus && /^\+[1-9]\d{6,14}$/.test(e164) ? e164 : null;
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = MAX_BODY_BYTES, raw = false) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('Request too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(raw ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function createApp({ provider, appKey, defaultCountryCode = '', twilioAuthToken = '', publicUrl = '', mediaDir = null, api = null, trustProxy = false, now = () => Date.now() }) {
  if (!appKey) throw new Error('VISHWAS_APP_KEY is required.');
  const useSms = provider.supportsSms !== false;
  const useWhatsApp = !!provider.supportsWhatsApp;
  const sessions = new Map();   // sessionId → { createdAt, recipients: [...], media: Map }
  const bySid = new Map();      // provider message id → { r, channel }
  if (mediaDir) fs.mkdirSync(mediaDir, { recursive: true });

  /** One line per message so delivery problems are visible in the server console (numbers masked). */
  function logSend(channel, phone, result, mediaUrl) {
    if (process.env.NODE_ENV === 'test' || process.env.NODE_TEST_CONTEXT) return;
    const masked = String(phone).replace(/\d(?=\d{3})/g, '•');
    console.log(`[${new Date(now()).toISOString()}] ${channel}${mediaUrl ? ' + clip' : ''} → ${masked}: ${result.ok ? `accepted (${result.sid})` : `FAILED — ${result.error}`}`);
  }

  /** Overall per-contact status = the best channel (a contact reached on either counts). */
  function settle(r) {
    const chans = [r.sms, r.whatsapp].filter(Boolean);
    const best = chans.reduce((a, c) => ((RANK[c.status] ?? 0) > (RANK[a?.status] ?? -1) ? c : a), null);
    r.status = best?.status ?? 'failed';
    r.error = r.status === 'failed' ? chans.map((c) => c.error).filter(Boolean).join(' · ') || 'Not sent' : null;
  }
  const recentByIp = new Map(); // ip → [timestamps of new alerts]

  function prune() {
    const cutoff = now() - KEEP_SESSIONS_MS;
    for (const [id, s] of sessions) {
      if (s.createdAt < cutoff) {
        for (const [sid, ref] of bySid) if (s.recipients.includes(ref.r)) bySid.delete(sid);
        for (const m of s.media.values()) if (m.file) fs.rm(m.file, { force: true }, () => {});
        sessions.delete(id);
      }
    }
  }

  function rateLimited(ip) {
    const t = now();
    const list = (recentByIp.get(ip) ?? []).filter((x) => t - x < RATE_WINDOW_MS);
    recentByIp.set(ip, list);
    if (list.length >= RATE_MAX_NEW_ALERTS) return true;
    list.push(t);
    return false;
  }

  const publicView = (sessionId, s) => ({
    sessionId,
    provider: provider.name,
    channels: { sms: useSms, whatsapp: useWhatsApp },
    recipients: s.recipients.map(({ contactId, name, phoneNumber, status, error, updatedAt, sms, whatsapp }) => ({
      contactId, name, phoneNumber, status, error: error ?? null, updatedAt,
      sms: sms ? { status: sms.status, error: sms.error ?? null } : null,
      whatsapp: whatsapp ? { status: whatsapp.status, error: whatsapp.error ?? null } : null,
    })),
  });

  /** Send one message on one channel and record it on the recipient. */
  async function deliver(r, channel, body, mediaUrl = null) {
    const result = await provider.send(r.phoneNumber, body, { whatsapp: channel === 'whatsapp', mediaUrl });
    logSend(channel, r.phoneNumber, result, mediaUrl);
    const rec = result.ok ? { status: result.status, sid: result.sid } : { status: 'failed', error: result.error };
    if (result.ok) bySid.set(result.sid, { r, channel });
    return rec;
  }

  async function sendEmergency(payload, ip) {
    const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId.trim() : '';
    if (!sessionId || sessionId.length > 100) return [400, { code: 'BAD_SESSION', message: 'sessionId is required.' }];

    // Idempotent: the same SOS never texts anyone twice.
    const existing = sessions.get(sessionId);
    if (existing) return [200, { ...publicView(sessionId, await existing.done), duplicate: true }];

    const message = typeof payload.message === 'string' ? payload.message.trim() : '';
    if (!message.startsWith(REQUIRED_PREFIX) || message.length > MAX_MESSAGE_CHARS) {
      return [400, { code: 'BAD_MESSAGE', message: 'Only VISHWAS emergency alerts can be sent.' }];
    }
    const contacts = Array.isArray(payload.contacts) ? payload.contacts : [];
    if (contacts.length === 0) return [400, { code: 'NO_CONTACTS', message: 'No contacts to alert.' }];
    if (contacts.length > MAX_RECIPIENTS) return [400, { code: 'TOO_MANY', message: `At most ${MAX_RECIPIENTS} contacts per alert.` }];
    if (rateLimited(ip)) return [429, { code: 'RATE_LIMITED', message: 'Too many new alerts from this device. Try again shortly.' }];

    const seen = new Set();
    const recipients = contacts.map((c) => {
      const e164 = toE164(c?.phoneNumber, defaultCountryCode);
      const base = { contactId: String(c?.id ?? ''), name: String(c?.name ?? '').slice(0, 80), phoneNumber: e164 ?? String(c?.phoneNumber ?? ''), updatedAt: new Date(now()).toISOString() };
      if (!e164) return { ...base, status: 'invalidNumber', error: 'Not a valid phone number' };
      if (seen.has(e164)) return { ...base, status: 'duplicate', error: 'Same number as another contact — texted once' };
      seen.add(e164);
      return { ...base, status: 'sending' };
    });

    const who = String(payload?.user?.fullName ?? '').slice(0, 60);
    const entry = { createdAt: now(), recipients, media: new Map(), who };
    entry.done = (async () => {
      await Promise.all(recipients.filter((r) => r.status === 'sending').map(async (r) => {
        const [sms, whatsapp] = await Promise.all([
          useSms ? deliver(r, 'sms', message) : null,
          useWhatsApp ? deliver(r, 'whatsapp', message) : null,
        ]);
        if (sms) r.sms = sms;
        if (whatsapp) r.whatsapp = whatsapp;
        r.updatedAt = new Date(now()).toISOString();
        settle(r);
      }));
      return entry;
    })();
    sessions.set(sessionId, entry);
    prune();
    await entry.done;
    return [200, publicView(sessionId, entry)];
  }

  function onStatusCallback(params) {
    const ref = bySid.get(params.MessageSid);
    if (!ref) return;
    const status = mapTwilioStatus(params.MessageStatus);
    const error = status === 'failed' ? (params.ErrorCode ? `Not delivered (error ${params.ErrorCode})` : 'Not delivered') : null;
    if (ref.media) {
      ref.media.results[ref.r.contactId] = { status, error };
      return;
    }
    ref.r[ref.channel] = { ...ref.r[ref.channel], status, error };
    ref.r.updatedAt = new Date(now()).toISOString();
    settle(ref.r);
  }

  /** Evidence clip → stored under an unguessable name → sent to every reachable contact on WhatsApp. */
  async function sendMedia(sessionId, { kind, part, contentType, data }) {
    const s = sessions.get(sessionId);
    if (!s) return [404, { code: 'NOT_FOUND', message: 'Unknown alert.' }];
    if (!useWhatsApp) return [409, { code: 'NO_WHATSAPP', message: 'WhatsApp is not configured on the server.' }];
    if (!mediaDir || !publicUrl) return [409, { code: 'NO_PUBLIC_URL', message: 'Set PUBLIC_URL so WhatsApp can fetch clips.' }];
    if (!['audio', 'video'].includes(kind) || !Number.isInteger(part) || part < 1 || part > 999) return [400, { code: 'BAD_MEDIA', message: 'kind must be audio|video and part 1–999.' }];
    const ext = MEDIA_TYPES[contentType];
    if (!ext) return [415, { code: 'BAD_TYPE', message: `Unsupported type ${contentType}.` }];
    if (!data?.length) return [400, { code: 'EMPTY', message: 'Empty clip.' }];

    // Idempotent per clip: an app retry never re-sends the same clip.
    const key = `${kind}-${part}`;
    const existing = s.media.get(key);
    if (existing) return [200, { ...(await existing.done), duplicate: true }];

    const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
    const file = path.join(mediaDir, name);
    fs.writeFileSync(file, data);
    const url = `${publicUrl.replace(/\/+$/, '')}/media/${name}`;
    const label = kind === 'audio' ? '🎙 SOS audio' : '🎥 SOS video';
    const body = `${label} ${part}${s.who ? ` from ${s.who}` : ''} — evidence recorded during the emergency. If it doesn't play, open: ${url}`;

    const m = { file, url, results: {} };
    m.done = (async () => {
      const targets = s.recipients.filter((r) => r.whatsapp && r.whatsapp.status !== 'failed');
      await Promise.all(targets.map(async (r) => {
        const result = await provider.send(r.phoneNumber, body, { whatsapp: true, mediaUrl: url });
        logSend('whatsapp', r.phoneNumber, result, url);
        m.results[r.contactId] = result.ok ? { status: result.status } : { status: 'failed', error: result.error };
        if (result.ok) bySid.set(result.sid, { r, channel: 'whatsapp', media: m });
      }));
      return { sessionId, kind, part, url, sentTo: Object.values(m.results).filter((x) => x.status !== 'failed').length, results: m.results };
    })();
    s.media.set(key, m);
    return [200, await m.done];
  }

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    // Behind Plesk's nginx the API lives under /api; locally it may not.
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) url.pathname = url.pathname.slice(4) || '/';
    // Only trust X-Forwarded-For when a local reverse proxy sets it (TRUST_PROXY=1).
    const forwarded = trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '';
    const ip = forwarded || req.socket?.remoteAddress || 'unknown';
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (api && (await api.route(req, res, url, url.pathname, ip))) return undefined;
      if (!api && /^\/(auth|sos|location|recordings)(\/|$)/.test(url.pathname)) {
        return sendJson(res, 503, { code: 'API_DISABLED', message: 'Accounts and cloud storage are not set up on this server (DATABASE_URL missing).' });
      }
      if (req.method === 'GET' && url.pathname === '/health') return sendJson(res, 200, { ok: true, provider: provider.name, sms: useSms, whatsapp: useWhatsApp });

      // Clips are fetched by Twilio/WhatsApp and contacts without the app key; names are 128-bit random.
      const mm = /^\/media\/([a-f0-9]{32})\.(m4a|aac|mp4|mov)$/.exec(url.pathname);
      if (req.method === 'GET' && mm && mediaDir) {
        const file = path.join(mediaDir, `${mm[1]}.${mm[2]}`);
        if (!fs.existsSync(file)) return sendJson(res, 404, { code: 'NOT_FOUND' });
        res.writeHead(200, { 'Content-Type': SERVE_TYPES[mm[2]], 'Content-Length': fs.statSync(file).size, 'Cache-Control': 'no-store' });
        return fs.createReadStream(file).pipe(res);
      }

      if (req.method === 'POST' && url.pathname === '/sms/status') {
        const raw = await readBody(req);
        const params = Object.fromEntries(new URLSearchParams(raw));
        const signedUrl = `${publicUrl.replace(/\/+$/, '')}${url.pathname}`;
        if (!isValidTwilioSignature({ authToken: twilioAuthToken, url: signedUrl, params, signature: req.headers['x-twilio-signature'] })) {
          return sendJson(res, 403, { code: 'BAD_SIGNATURE' });
        }
        onStatusCallback(params);
        res.writeHead(204);
        return res.end();
      }

      if (req.headers['x-vishwas-key'] !== appKey) return sendJson(res, 401, { code: 'UNAUTHORIZED', message: 'Missing or wrong app key.' });

      if (req.method === 'POST' && url.pathname === '/alerts/emergency') {
        let payload;
        try {
          payload = JSON.parse(await readBody(req));
        } catch (err) {
          if (err.status) throw err;
          return sendJson(res, 400, { code: 'BAD_JSON', message: 'Invalid JSON.' });
        }
        const [status, body] = await sendEmergency(payload, ip);
        return sendJson(res, status, body);
      }

      const media = /^\/alerts\/([^/]+)\/media$/.exec(url.pathname);
      if (req.method === 'POST' && media) {
        const data = await readBody(req, MAX_MEDIA_BYTES, true);
        const [status, body] = await sendMedia(decodeURIComponent(media[1]), {
          kind: url.searchParams.get('kind'),
          part: Number(url.searchParams.get('part')),
          contentType: String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase(),
          data,
        });
        return sendJson(res, status, body);
      }

      const m = /^\/alerts\/([^/]+)$/.exec(url.pathname);
      if (req.method === 'GET' && m) {
        const s = sessions.get(decodeURIComponent(m[1]));
        if (!s) return sendJson(res, 404, { code: 'NOT_FOUND', message: 'Unknown alert.' });
        return sendJson(res, 200, publicView(decodeURIComponent(m[1]), await s.done));
      }

      return sendJson(res, 404, { code: 'NOT_FOUND' });
    } catch (err) {
      return sendJson(res, err.status ?? 500, { code: 'SERVER_ERROR', message: err.status ? err.message : 'Server error.' });
    }
  };
}

module.exports = { createApp, toE164, REQUIRED_PREFIX };
