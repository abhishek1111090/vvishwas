'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');
const { createApp, toE164 } = require('./app');
const { isValidTwilioSignature } = require('./sms');

const KEY = 'test-key';
const MSG = '🚨 EMERGENCY ALERT! I need help immediately. My SOS has been activated.';

function fakeProvider({ failFor = [] } = {}) {
  const sent = [];
  let n = 0;
  return {
    name: 'fake',
    sent,
    async send(to, body) {
      sent.push({ to, body });
      if (failFor.includes(to)) return { ok: false, error: 'Provider rejected the number' };
      n += 1;
      return { ok: true, sid: `SM${n}`, status: 'sent' };
    },
  };
}

async function withServer(opts, fn) {
  const server = http.createServer(createApp({ appKey: KEY, defaultCountryCode: '91', twilioAuthToken: 'tok', publicUrl: 'https://alerts.example.com', ...opts }));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}

const post = (base, body, key = KEY) =>
  fetch(`${base}/alerts/emergency`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-vishwas-key': key }, body: JSON.stringify(body) });

const contacts = [
  { id: 'a', name: 'Maa', phoneNumber: '98765 43210' },
  { id: 'b', name: 'Riya', phoneNumber: '+44 7700 900123' },
  { id: 'c', name: 'Typo', phoneNumber: '12' },
  { id: 'd', name: 'Maa (work)', phoneNumber: '+919876543210' },
];

test('normalises numbers to E.164', () => {
  assert.equal(toE164('98765 43210', '91'), '+919876543210');
  assert.equal(toE164('09876543210', '91'), '+919876543210');
  assert.equal(toE164('919876543210', '91'), '+919876543210');
  assert.equal(toE164('0044 7700 900123', '91'), '+447700900123');
  assert.equal(toE164('12', '91'), null);
  assert.equal(toE164('9876543210', ''), null);
});

test('texts every valid contact once, reports invalid and duplicate numbers', async () => {
  const provider = fakeProvider();
  await withServer({ provider }, async (base) => {
    const res = await post(base, { sessionId: 's1', message: MSG, contacts });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(provider.sent.map((s) => s.to).sort(), ['+447700900123', '+919876543210']);
    assert.deepEqual(body.recipients.map((r) => r.status), ['sent', 'sent', 'invalidNumber', 'duplicate']);
  });
});

test('one failing contact does not stop the others', async () => {
  const provider = fakeProvider({ failFor: ['+447700900123'] });
  await withServer({ provider }, async (base) => {
    const body = await (await post(base, { sessionId: 's2', message: MSG, contacts: contacts.slice(0, 2) })).json();
    assert.equal(body.recipients[0].status, 'sent');
    assert.equal(body.recipients[1].status, 'failed');
    assert.match(body.recipients[1].error, /rejected/);
  });
});

test('the same SOS session is never texted twice; a new session is', async () => {
  const provider = fakeProvider();
  await withServer({ provider }, async (base) => {
    await post(base, { sessionId: 's3', message: MSG, contacts: contacts.slice(0, 1) });
    const again = await (await post(base, { sessionId: 's3', message: MSG, contacts: contacts.slice(0, 1) })).json();
    assert.equal(again.duplicate, true);
    assert.equal(provider.sent.length, 1);
    await post(base, { sessionId: 's4', message: MSG, contacts: contacts.slice(0, 1) });
    assert.equal(provider.sent.length, 2);
  });
});

test('rejects wrong key and non-emergency text', async () => {
  const provider = fakeProvider();
  await withServer({ provider }, async (base) => {
    assert.equal((await post(base, { sessionId: 'x', message: MSG, contacts }, 'nope')).status, 401);
    assert.equal((await post(base, { sessionId: 'y', message: 'Buy now!', contacts })).status, 400);
    assert.equal(provider.sent.length, 0);
  });
});

test('signed delivery reports update the status; unsigned ones are refused', async () => {
  const provider = fakeProvider();
  await withServer({ provider }, async (base) => {
    await post(base, { sessionId: 's5', message: MSG, contacts: contacts.slice(0, 1) });
    const params = { MessageSid: 'SM1', MessageStatus: 'delivered' };
    const data = Object.keys(params).sort().reduce((a, k) => a + k + params[k], 'https://alerts.example.com/sms/status');
    const signature = crypto.createHmac('sha1', 'tok').update(data).digest('base64');
    const form = new URLSearchParams(params).toString();
    const bad = await fetch(`${base}/sms/status`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-twilio-signature': 'forged' }, body: form });
    assert.equal(bad.status, 403);
    const ok = await fetch(`${base}/sms/status`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signature }, body: form });
    assert.equal(ok.status, 204);
    const status = await (await fetch(`${base}/alerts/s5`, { headers: { 'x-vishwas-key': KEY } })).json();
    assert.equal(status.recipients[0].status, 'delivered');
  });
});

test('signature check', () => {
  assert.equal(isValidTwilioSignature({ authToken: 't', url: 'u', params: {}, signature: undefined }), false);
});

// ── WhatsApp: SOS text + evidence clips ──────────────────────────────────────
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

function fakeWhatsApp() {
  const sent = [];
  let n = 0;
  return {
    name: 'fake', supportsSms: false, supportsWhatsApp: true, sent,
    async send(to, body, opts = {}) { sent.push({ to, body, ...opts }); n += 1; return { ok: true, sid: `WA${n}`, status: 'sent' }; },
  };
}

test('WhatsApp-only: the SOS text goes to every valid contact on WhatsApp', async () => {
  const provider = fakeWhatsApp();
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vishwas-media-'));
  await withServer({ provider, mediaDir }, async (base) => {
    const body = await (await post(base, { sessionId: 'w1', message: MSG, contacts, user: { fullName: 'Anshu' } })).json();
    assert.ok(provider.sent.every((s) => s.whatsapp === true));
    assert.deepEqual(provider.sent.map((s) => s.to).sort(), ['+447700900123', '+919876543210']);
    assert.equal(body.channels.whatsapp, true);
    assert.equal(body.recipients[0].whatsapp.status, 'sent');
    assert.equal(body.recipients[0].status, 'sent');
  });
});

test('evidence clips: stored privately, sent to each contact on WhatsApp once, servable to Twilio', async () => {
  const provider = fakeWhatsApp();
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vishwas-media-'));
  await withServer({ provider, mediaDir }, async (base) => {
    await post(base, { sessionId: 'w2', message: MSG, contacts: contacts.slice(0, 2), user: { fullName: 'Anshu' } });
    const upload = () => fetch(`${base}/alerts/w2/media?kind=audio&part=1`, { method: 'POST', headers: { 'x-vishwas-key': KEY, 'Content-Type': 'audio/mp4' }, body: Buffer.from('fake-m4a') });
    const r1 = await (await upload()).json();
    assert.equal(r1.sentTo, 2);
    const clipMsgs = provider.sent.filter((s) => s.mediaUrl);
    assert.equal(clipMsgs.length, 2);
    assert.match(clipMsgs[0].mediaUrl, /^https:\/\/alerts\.example\.com\/media\/[a-f0-9]{32}\.m4a$/);
    assert.match(clipMsgs[0].body, /SOS audio 1 from Anshu/);
    const r2 = await (await upload()).json();
    assert.equal(r2.duplicate, true);
    assert.equal(provider.sent.filter((s) => s.mediaUrl).length, 2);
    const file = new URL(clipMsgs[0].mediaUrl).pathname;
    const served = await fetch(`${base}${file}`);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get('content-type'), 'audio/mp4');
    assert.equal(await served.text(), 'fake-m4a');
  });
});

test('evidence clips: wrong type, unknown alert and missing key are refused', async () => {
  const provider = fakeWhatsApp();
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vishwas-media-'));
  await withServer({ provider, mediaDir }, async (base) => {
    await post(base, { sessionId: 'w3', message: MSG, contacts: contacts.slice(0, 1) });
    const send = (q, type, key = KEY) => fetch(`${base}/alerts/${q}`, { method: 'POST', headers: { 'x-vishwas-key': key, 'Content-Type': type }, body: Buffer.from('x') });
    assert.equal((await send('w3/media?kind=video&part=1', 'image/png')).status, 415);
    assert.equal((await send('nope/media?kind=video&part=1', 'video/mp4')).status, 404);
    assert.equal((await send('w3/media?kind=video&part=1', 'video/mp4', 'bad')).status, 401);
  });
});
