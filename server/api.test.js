'use strict';
// API tests against pg-mem (an in-memory PostgreSQL emulator) and a temp
// storage folder. They exercise the real SQL, routes and file handling;
// they are NOT a substitute for a check against the production database.

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { newDb } = require('pg-mem');
const { createDb } = require('./db');
const { createApi } = require('./api');
const { createApp } = require('./app');
const { hashPassword, verifyPassword } = require('./auth');

async function setup({ mailer = null } = {}) {
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  const db = createDb({ pool: new Pool() });
  await db.migrate();
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vishwas-store-'));
  const api = createApi({ db, storageDir, mailer, publicUrl: 'https://example.test', log: () => {} });
  const provider = { name: 'fake', supportsSms: false, supportsWhatsApp: false, send: async () => ({ ok: false, error: 'off' }) };
  const server = http.createServer(createApp({ provider, appKey: 'k', api }));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, p, { body, token, headers = {}, raw } = {}) => {
    const res = await fetch(`${base}${p}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: raw ?? (body ? JSON.stringify(body) : undefined),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text, headers: res.headers };
  };
  return { db, storageDir, call, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

const ALICE = { fullName: 'Anshu Sharma', email: 'Anshu@Example.com', password: 'correct horse 1' };

test('passwords are hashed with scrypt and verified in constant time', async () => {
  const h = await hashPassword('s3cret-pass');
  assert.match(h, /^scrypt\$32768\$8\$1\$/);
  assert.ok(!h.includes('s3cret-pass'));
  assert.equal(await verifyPassword('s3cret-pass', h), true);
  assert.equal(await verifyPassword('wrong-pass', h), false);
});

test('migrations are additive and safe to run twice', async () => {
  const t = await setup();
  try {
    assert.deepEqual(await t.db.migrate(), []);
  } finally {
    await t.close();
  }
});

test('register → me → logout; login; wrong password; duplicate email', async () => {
  const t = await setup();
  const reg = await t.call('POST', '/auth/register', { body: ALICE });
  assert.equal(reg.status, 201);
  assert.equal(reg.json.user.email, 'anshu@example.com');
  assert.ok(reg.json.token.length > 30);
  const stored = await t.db.one('SELECT password_hash FROM users');
  assert.ok(!stored.password_hash.includes(ALICE.password));

  assert.equal((await t.call('GET', '/auth/me', { token: reg.json.token })).json.user.fullName, 'Anshu Sharma');
  assert.equal((await t.call('POST', '/auth/register', { body: ALICE })).status, 409);
  assert.equal((await t.call('POST', '/auth/login', { body: { email: ALICE.email, password: 'nope-nope' } })).status, 401);
  assert.equal((await t.call('POST', '/auth/login', { body: { email: 'nobody@example.com', password: 'nope-nope' } })).json.message, 'Incorrect email or password.');

  const login = await t.call('POST', '/auth/login', { body: { email: 'ANSHU@example.com', password: ALICE.password } });
  assert.equal(login.status, 200);
  assert.equal((await t.call('POST', '/auth/logout', { token: login.json.token })).status, 204);
  assert.equal((await t.call('GET', '/auth/me', { token: login.json.token })).status, 401);
  assert.equal((await t.call('GET', '/auth/me')).status, 401);
  await t.close();
});

test('validation and rate limiting on login', async () => {
  const t = await setup();
  assert.equal((await t.call('POST', '/auth/register', { body: { ...ALICE, password: 'short' } })).status, 400);
  assert.equal((await t.call('POST', '/auth/register', { body: { ...ALICE, email: 'not-an-email' } })).status, 400);
  let last;
  for (let i = 0; i < 12; i += 1) last = await t.call('POST', '/auth/login', { body: { email: 'x@example.com', password: 'wrongwrong' } });
  assert.equal(last.status, 429);
  await t.close();
});

test('SOS: created once per clientId, updated, located, listed — and private to its owner', async () => {
  const t = await setup();
  const a = (await t.call('POST', '/auth/register', { body: ALICE })).json.token;
  const b = (await t.call('POST', '/auth/register', { body: { fullName: 'Other', email: 'other@example.com', password: 'other-password' } })).json.token;

  const sos = { clientId: 'sess-1', triggerSource: 'voice', startedAt: new Date().toISOString(), contacts: [{ id: 'c1', name: 'Maa', phoneNumber: '+919876543210' }], location: { latitude: 26.9, longitude: 75.8, accuracy: 8 } };
  const first = await t.call('POST', '/sos', { token: a, body: sos });
  assert.equal(first.status, 201);
  assert.equal(first.json.event.status, 'active');
  assert.ok(first.json.event.receivedAt);
  assert.equal(first.json.event.contacts[0].phoneMasked, '+•••••••••210');
  const retry = await t.call('POST', '/sos', { token: a, body: sos });
  assert.equal(retry.json.duplicate, true);
  assert.equal((await t.db.query('SELECT id FROM sos_events')).length, 1);

  assert.equal((await t.call('POST', '/location', { token: a, body: { sosClientId: 'sess-1', latitude: 26.91, longitude: 75.81, accuracy: 6 } })).status, 201);
  assert.equal((await t.call('POST', '/location', { token: a, body: { sosClientId: 'sess-1', latitude: 200, longitude: 75 } })).status, 400);
  assert.equal((await t.db.query('SELECT id FROM sos_locations')).length, 2);

  assert.equal((await t.call('POST', '/location', { token: b, body: { sosClientId: 'sess-1', latitude: 1, longitude: 1 } })).status, 404);
  assert.equal((await t.call('PATCH', '/sos/sess-1', { token: b, body: { status: 'resolved' } })).status, 404);

  const ended = await t.call('PATCH', '/sos/sess-1', { token: a, body: { status: 'resolved', endedAt: new Date().toISOString(), alertSummary: { sent: 1 } } });
  assert.equal(ended.json.event.status, 'resolved');
  assert.equal((await t.call('GET', '/sos', { token: a })).json.events.length, 1);
  assert.equal((await t.call('GET', '/sos', { token: b })).json.events.length, 0);
  await t.close();
});

test('recordings: upload once, list, stream with Range, owner-only, delete', async () => {
  const t = await setup();
  const a = (await t.call('POST', '/auth/register', { body: ALICE })).json.token;
  const b = (await t.call('POST', '/auth/register', { body: { fullName: 'Other', email: 'other@example.com', password: 'other-password' } })).json.token;
  await t.call('POST', '/sos', { token: a, body: { clientId: 'sess-2', triggerSource: 'button' } });

  const bytes = Buffer.from('fake-m4a-audio-bytes-0123456789');
  const up = () => t.call('POST', '/recordings?sosClientId=sess-2&kind=audio&part=1', { token: a, raw: bytes, headers: { 'Content-Type': 'audio/mp4' } });
  const first = await up();
  assert.equal(first.status, 201);
  assert.equal(first.json.recording.sizeBytes, bytes.length);
  assert.equal(first.json.recording.sosClientId, 'sess-2');
  const again = await up();
  assert.equal(again.json.duplicate, true);
  assert.equal((await t.db.query('SELECT id FROM recordings')).length, 1);

  const row = await t.db.one('SELECT storage_key FROM recordings');
  assert.ok(!row.storage_key.includes('..') && fs.existsSync(path.join(t.storageDir, row.storage_key)));
  const id = first.json.recording.id;

  assert.equal((await t.call('GET', '/recordings?sosClientId=sess-2', { token: a })).json.recordings.length, 1);
  const full = await t.call('GET', `/recordings/${id}/file`, { token: a });
  assert.equal(full.text, bytes.toString());
  const part = await t.call('GET', `/recordings/${id}/file`, { token: a, headers: { Range: 'bytes=0-3' } });
  assert.equal(part.status, 206);
  assert.equal(part.text, 'fake');

  assert.equal((await t.call('GET', `/recordings/${id}/file`, { token: b })).status, 404);
  assert.equal((await t.call('DELETE', `/recordings/${id}`, { token: b })).status, 404);
  assert.equal((await t.call('POST', '/recordings?kind=audio&part=1', { token: a, raw: bytes, headers: { 'Content-Type': 'image/png' } })).status, 415);
  assert.equal((await t.call('POST', '/recordings?kind=audio&part=1', { raw: bytes, headers: { 'Content-Type': 'audio/mp4' } })).status, 401);

  assert.equal((await t.call('DELETE', `/recordings/${id}`, { token: a })).status, 204);
  assert.equal((await t.call('GET', '/recordings', { token: a })).json.recordings.length, 0);
  await t.close();
});

test('password reset: honest when email is not set up; full flow when it is', async () => {
  const off = await setup();
  assert.equal((await off.call('POST', '/auth/forgot-password', { body: { email: 'a@example.com' } })).status, 503);
  await off.close();

  const sent = [];
  const t = await setup({ mailer: { send: async (m) => { sent.push(m); } } });
  const token = (await t.call('POST', '/auth/register', { body: ALICE })).json.token;
  assert.equal((await t.call('POST', '/auth/forgot-password', { body: { email: 'nobody@example.com' } })).status, 202);
  assert.equal(sent.length, 0);
  assert.equal((await t.call('POST', '/auth/forgot-password', { body: { email: ALICE.email } })).status, 202);
  const resetToken = /token=([A-Za-z0-9_-]+)/.exec(sent[0].text)[1];
  assert.match((await t.call('GET', `/auth/reset?token=${resetToken}`)).text, /Choose a new password/);
  assert.equal((await t.call('POST', '/auth/reset-password', { body: { token: resetToken, password: 'brand-new-pass' } })).status, 204);
  assert.equal((await t.call('GET', '/auth/me', { token })).status, 401); // signed out everywhere
  assert.equal((await t.call('POST', '/auth/reset-password', { body: { token: resetToken, password: 'another-pass' } })).status, 400); // single use
  assert.equal((await t.call('POST', '/auth/login', { body: { email: ALICE.email, password: 'brand-new-pass' } })).status, 200);
  await t.close();
});

test('health says whether the database answers, without details', async () => {
  const t = await setup();
  const h = await t.call('GET', '/health');
  assert.deepEqual(h.json, { ok: true, db: 'ok' });
  await t.close();
});
