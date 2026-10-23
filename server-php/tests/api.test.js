'use strict';
// End-to-end tests for the PHP API: runs the real PHP code under `php -S`
// with a temporary SQLite database, private storage folder, a fake mailer and
// a fake Twilio. Production uses PostgreSQL — see DEPLOY.md for checking that
// on the server. Run: node --test tests/   (PHP_BIN can point at php.exe)

const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PHP = process.env.PHP_BIN || path.join(os.homedir(), 'AppData', 'Local', 'vishwas-php', 'php', 'php.exe');
const KEY = 'test-app-key-0123456789';

async function startFakeTwilio() {
  const sent = [];
  let n = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const form = Object.fromEntries(new URLSearchParams(body));
      sent.push(form);
      n += 1;
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sid: `SM${String(n).padStart(32, '0')}`, status: 'queued' }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { sent, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

async function setup({ mail = true, twilio = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vishwas-php-'));
  const mailLog = path.join(dir, 'mail.log').replace(/\\/g, '/');
  const cfg = `<?php return [
    'app_key' => '${KEY}',
    'database' => ['dsn' => 'sqlite:${path.join(dir, 'db.sqlite').replace(/\\/g, '/')}', 'user' => null, 'password' => null],
    'private_dir' => '${dir.replace(/\\/g, '/')}',
    'storage_dir' => '${path.join(dir, 'recordings').replace(/\\/g, '/')}',
    'public_url' => 'https://example.test/api',
    'max_upload_mb' => 5,
    'mail_enabled' => ${mail ? 'true' : 'false'},
    'mailer' => function ($to, $subject, $text) { file_put_contents('${mailLog}', $text, FILE_APPEND); return true; },
    ${twilio ? `'twilio' => ['account_sid' => 'AC123', 'auth_token' => 'tok', 'from' => '', 'messaging_service_sid' => '', 'whatsapp_from' => 'whatsapp:+14155238886'], 'twilio_api_base' => '${twilio.url}',` : ''}
    'default_country_code' => '91',
  ];`;
  fs.writeFileSync(path.join(dir, 'config.php'), cfg);
  const port = 18000 + Math.floor(Math.random() * 2000);
  const proc = spawn(PHP, ['-d', 'post_max_size=64M', '-d', 'extension_dir=' + path.join(path.dirname(PHP), 'ext'), '-d', 'extension=pdo_sqlite', '-d', 'extension=curl', '-d', 'extension=mbstring', '-S', `127.0.0.1:${port}`, path.join(ROOT, 'public', 'api', 'index.php')], {
    cwd: path.join(ROOT, 'public'),
    env: { ...process.env, VISHWAS_CONFIG: path.join(dir, 'config.php'), VISHWAS_APP_DIR: ROOT },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}/api`;
  for (let i = 0; i < 50; i += 1) {
    try { await fetch(`${base}/health`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
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
  return { dir, call, mailLog, close: () => { proc.kill(); } };
}

const ALICE = { fullName: 'Anshu Sharma', email: 'Anshu@Example.com', password: 'correct horse 1' };

test('health, schema migration and Argon2id password storage', async () => {
  const t = await setup();
  try {
    assert.deepEqual((await t.call('GET', '/health')).json, { ok: true, db: 'ok', sms: false, whatsapp: false });
    assert.equal((await t.call('POST', '/auth/register', { body: ALICE })).status, 201);
    const db = fs.readFileSync(path.join(t.dir, 'db.sqlite')).toString('latin1');
    assert.match(db, /\$argon2id\$/);
    assert.ok(!db.includes(ALICE.password));
  } finally { t.close(); }
});

test('register → me → logout; login; wrong password; duplicate email', async () => {
  const t = await setup();
  try {
    const reg = await t.call('POST', '/auth/register', { body: ALICE });
    assert.equal(reg.json.user.email, 'anshu@example.com');
    assert.equal((await t.call('GET', '/auth/me', { token: reg.json.token })).json.user.fullName, 'Anshu Sharma');
    assert.equal((await t.call('POST', '/auth/register', { body: ALICE })).status, 409);
    assert.equal((await t.call('POST', '/auth/login', { body: { email: ALICE.email, password: 'nope-nope' } })).status, 401);
    assert.equal((await t.call('POST', '/auth/login', { body: { email: 'nobody@example.com', password: 'nope-nope' } })).json.message, 'Incorrect email or password.');
    const login = await t.call('POST', '/auth/login', { body: { email: 'ANSHU@example.com', password: ALICE.password } });
    assert.equal(login.status, 200);
    assert.equal((await t.call('POST', '/auth/logout', { token: login.json.token })).status, 204);
    assert.equal((await t.call('GET', '/auth/me', { token: login.json.token })).status, 401);
    assert.equal((await t.call('PATCH', '/auth/me', { token: reg.json.token, body: { fullName: 'Anshu S' } })).json.user.fullName, 'Anshu S');
  } finally { t.close(); }
});

test('validation and login rate limiting', async () => {
  const t = await setup();
  try {
    assert.equal((await t.call('POST', '/auth/register', { body: { ...ALICE, password: 'short' } })).status, 400);
    assert.equal((await t.call('POST', '/auth/register', { body: { ...ALICE, email: 'nope' } })).status, 400);
    let last;
    for (let i = 0; i < 12; i += 1) last = await t.call('POST', '/auth/login', { body: { email: 'x@example.com', password: 'wrongwrong' } });
    assert.equal(last.status, 429);
  } finally { t.close(); }
});

test('SOS once per clientId, locations, end status — private to the owner', async () => {
  const t = await setup();
  try {
    const a = (await t.call('POST', '/auth/register', { body: ALICE })).json.token;
    const b = (await t.call('POST', '/auth/register', { body: { fullName: 'Other', email: 'other@example.com', password: 'other-password' } })).json.token;
    const sos = { clientId: 'sess-1', triggerSource: 'voice', startedAt: new Date().toISOString(), contacts: [{ id: 'c1', name: 'Maa', phoneNumber: '+919876543210' }], location: { latitude: 26.9, longitude: 75.8, accuracy: 8 } };
    const first = await t.call('POST', '/sos', { token: a, body: sos });
    assert.equal(first.status, 201);
    assert.equal(first.json.event.status, 'active');
    assert.equal(first.json.event.contacts[0].phoneMasked, '+•••••••••210');
    assert.ok(first.json.event.receivedAt);
    assert.equal((await t.call('POST', '/sos', { token: a, body: sos })).json.duplicate, true);
    assert.equal((await t.call('POST', '/location', { token: a, body: { sosClientId: 'sess-1', latitude: 26.91, longitude: 75.81, accuracy: 6 } })).status, 201);
    assert.equal((await t.call('POST', '/location', { token: a, body: { sosClientId: 'sess-1', latitude: 200, longitude: 75 } })).status, 400);
    assert.equal((await t.call('POST', '/location', { token: b, body: { sosClientId: 'sess-1', latitude: 1, longitude: 1 } })).status, 404);
    assert.equal((await t.call('PATCH', '/sos/sess-1', { token: b, body: { status: 'resolved' } })).status, 404);
    const ended = await t.call('PATCH', '/sos/sess-1', { token: a, body: { status: 'resolved', endedAt: new Date().toISOString(), alertSummary: { sent: 1 } } });
    assert.equal(ended.json.event.status, 'resolved');
    assert.deepEqual(ended.json.event.alertSummary, { sent: 1 });
    assert.equal((await t.call('GET', '/sos', { token: a })).json.events.length, 1);
    assert.equal((await t.call('GET', '/sos', { token: b })).json.events.length, 0);
  } finally { t.close(); }
});

test('recordings: upload once, list, Range playback, owner-only, size/type limits, delete', async () => {
  const t = await setup();
  try {
    const a = (await t.call('POST', '/auth/register', { body: ALICE })).json.token;
    const b = (await t.call('POST', '/auth/register', { body: { fullName: 'Other', email: 'other@example.com', password: 'other-password' } })).json.token;
    await t.call('POST', '/sos', { token: a, body: { clientId: 'sess-2', triggerSource: 'button' } });
    const bytes = Buffer.from('fake-m4a-audio-bytes-0123456789');
    const up = () => t.call('POST', '/recordings?sosClientId=sess-2&kind=audio&part=1', { token: a, raw: bytes, headers: { 'Content-Type': 'audio/mp4' } });
    const first = await up();
    assert.equal(first.status, 201, first.text);
    assert.equal(first.json.recording.sizeBytes, bytes.length);
    assert.equal(first.json.recording.sosClientId, 'sess-2');
    assert.equal((await up()).json.duplicate, true);
    const id = first.json.recording.id;
    const files = fs.readdirSync(path.join(t.dir, 'recordings'), { recursive: true }).filter((f) => String(f).endsWith('.m4a'));
    assert.equal(files.length, 1);

    assert.equal((await t.call('GET', '/recordings?sosClientId=sess-2', { token: a })).json.recordings.length, 1);
    assert.equal((await t.call('GET', `/recordings/${id}/file`, { token: a })).text, bytes.toString());
    const part = await t.call('GET', `/recordings/${id}/file`, { token: a, headers: { Range: 'bytes=0-3' } });
    assert.equal(part.status, 206);
    assert.equal(part.text, 'fake');
    assert.equal((await t.call('GET', `/recordings/${id}/file`, { token: b })).status, 404);
    assert.equal((await t.call('DELETE', `/recordings/${id}`, { token: b })).status, 404);
    assert.equal((await t.call('POST', '/recordings?kind=audio&part=2', { token: a, raw: bytes, headers: { 'Content-Type': 'image/png' } })).status, 415);
    assert.equal((await t.call('POST', '/recordings?kind=audio&part=2', { raw: bytes, headers: { 'Content-Type': 'audio/mp4' } })).status, 401);
    assert.equal((await t.call('POST', '/recordings?kind=video&part=3', { token: a, raw: Buffer.alloc(6 * 1024 * 1024), headers: { 'Content-Type': 'video/mp4' } })).status, 413);
    assert.equal((await t.call('DELETE', `/recordings/${id}`, { token: a })).status, 204);
    assert.equal((await t.call('GET', '/recordings', { token: a })).json.recordings.length, 0);
  } finally { t.close(); }
});

test('password reset: honest when mail is off; full single-use flow when on', async () => {
  const off = await setup({ mail: false });
  try {
    assert.equal((await off.call('POST', '/auth/forgot-password', { body: { email: 'a@example.com' } })).status, 503);
  } finally { off.close(); }

  const t = await setup();
  try {
    const token = (await t.call('POST', '/auth/register', { body: ALICE })).json.token;
    assert.equal((await t.call('POST', '/auth/forgot-password', { body: { email: 'nobody@example.com' } })).status, 202);
    assert.ok(!fs.existsSync(t.mailLog));
    assert.equal((await t.call('POST', '/auth/forgot-password', { body: { email: ALICE.email } })).status, 202);
    const resetToken = /token=([A-Za-z0-9_-]+)/.exec(fs.readFileSync(t.mailLog, 'utf8'))[1];
    assert.match((await t.call('GET', `/auth/reset?token=${resetToken}`)).text, /Choose a new password/);
    assert.equal((await t.call('POST', '/auth/reset-password', { body: { token: resetToken, password: 'brand-new-pass' } })).status, 204);
    assert.equal((await t.call('GET', '/auth/me', { token })).status, 401);
    assert.equal((await t.call('POST', '/auth/reset-password', { body: { token: resetToken, password: 'another-pass' } })).status, 400);
    assert.equal((await t.call('POST', '/auth/login', { body: { email: ALICE.email, password: 'brand-new-pass' } })).status, 200);
  } finally { t.close(); }
});

test('alerts: WhatsApp to every valid contact once; clips sent and served; bad key refused', async () => {
  const twilio = await startFakeTwilio();
  const t = await setup({ twilio });
  try {
    const MSG = '🚨 EMERGENCY ALERT! I need help immediately.';
    const contacts = [
      { id: 'a', name: 'Maa', phoneNumber: '98765 43210' },
      { id: 'b', name: 'Riya', phoneNumber: '+44 7700 900123' },
      { id: 'c', name: 'Typo', phoneNumber: '12' },
      { id: 'd', name: 'Maa (work)', phoneNumber: '+919876543210' },
    ];
    const post = (body, key = KEY) => t.call('POST', '/alerts/emergency', { body, headers: { 'x-vishwas-key': key } });
    assert.equal((await post({ sessionId: 'x', message: MSG, contacts }, 'wrong')).status, 401);
    assert.equal((await post({ sessionId: 'y', message: 'Buy now!', contacts })).status, 400);

    const res = await post({ sessionId: 's1', message: MSG, contacts, user: { fullName: 'Anshu' } });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.json.recipients.map((r) => r.status), ['sent', 'sent', 'invalidNumber', 'duplicate']);
    assert.equal(res.json.channels.whatsapp, true);
    assert.deepEqual(twilio.sent.map((f) => f.To).sort(), ['whatsapp:+447700900123', 'whatsapp:+919876543210']);
    assert.equal(twilio.sent[0].StatusCallback, 'https://example.test/api/sms/status');
    assert.equal((await post({ sessionId: 's1', message: MSG, contacts })).json.duplicate, true);
    assert.equal(twilio.sent.length, 2);

    const clip = await t.call('POST', '/alerts/s1/media?kind=audio&part=1', { raw: Buffer.from('fake-m4a'), headers: { 'x-vishwas-key': KEY, 'Content-Type': 'audio/mp4' } });
    assert.equal(clip.json.sentTo, 2, clip.text);
    assert.match(clip.json.url, /^https:\/\/example\.test\/api\/media\/[a-f0-9]{32}\.m4a$/);
    assert.equal(twilio.sent.filter((f) => f.MediaUrl).length, 2);
    const served = await t.call('GET', new URL(clip.json.url).pathname.replace(/^\/api/, ''));
    assert.equal(served.text, 'fake-m4a');
    assert.equal(served.headers.get('content-type'), 'audio/mp4');

    // Signed delivery report → delivered; forged one refused.
    const crypto = require('node:crypto');
    const params = { MessageSid: 'SM00000000000000000000000000000001', MessageStatus: 'delivered' };
    const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], 'https://example.test/api/sms/status');
    const sig = crypto.createHmac('sha1', 'tok').update(data).digest('base64');
    const form = new URLSearchParams(params).toString();
    assert.equal((await t.call('POST', '/sms/status', { raw: form, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': 'forged' } })).status, 403);
    assert.equal((await t.call('POST', '/sms/status', { raw: form, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': sig } })).status, 204);
    const status = await t.call('GET', '/alerts/s1', { headers: { 'x-vishwas-key': KEY } });
    assert.equal(status.json.recipients.filter((r) => r.status === 'delivered').length, 1);
  } finally {
    t.close();
    await twilio.close();
  }
});
