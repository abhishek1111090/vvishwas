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
    assert.deepEqual((await t.call('GET', '/health')).json, { ok: true, db: 'ok', sms: false, whatsapp: false, version: '2026-10-26.chunked-uploads' });
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

test('emergency link: opens only that SOS (location + playable recordings), nothing else', async () => {
  const t = await setup();
  try {
    const a = (await t.call('POST', '/auth/register', { body: ALICE })).json.token;
    const b = (await t.call('POST', '/auth/register', { body: { fullName: 'Other', email: 'other@example.com', password: 'other-password' } })).json.token;
    const share = require('node:crypto').randomBytes(32).toString('base64url');
    const otherShare = require('node:crypto').randomBytes(32).toString('base64url');
    assert.equal((await t.call('POST', '/sos', { token: a, body: { clientId: 'sess-s', triggerSource: 'button', shareToken: 'short' } })).status, 400);
    assert.equal((await t.call('POST', '/sos', { token: a, body: { clientId: 'sess-s', triggerSource: 'button', shareToken: share, location: { latitude: 26.9124, longitude: 75.7873, accuracy: 9 } } })).status, 201);
    await t.call('POST', '/sos', { token: a, body: { clientId: 'sess-other', triggerSource: 'button' } }); // Alice's other SOS: no link
    await t.call('POST', '/sos', { token: b, body: { clientId: 'sess-s', triggerSource: 'button', shareToken: otherShare } }); // same clientId, other user
    await t.call('POST', '/location', { token: a, body: { sosClientId: 'sess-s', latitude: 26.913, longitude: 75.788, accuracy: 5 } });
    const audio = Buffer.from('fake-m4a-audio-bytes-0123456789');
    const video = Buffer.from('fake-mp4-video-bytes');
    const upA = await t.call('POST', '/recordings?sosClientId=sess-s&kind=audio&part=1', { token: a, raw: audio, headers: { 'Content-Type': 'audio/mp4' } });
    await t.call('POST', '/recordings?sosClientId=sess-s&kind=video&part=1', { token: a, raw: video, headers: { 'Content-Type': 'video/mp4' } });
    const elsewhere = await t.call('POST', '/recordings?sosClientId=sess-other&kind=audio&part=1', { token: a, raw: audio, headers: { 'Content-Type': 'audio/mp4' } });
    const bobs = await t.call('POST', '/recordings?sosClientId=sess-s&kind=audio&part=1', { token: b, raw: audio, headers: { 'Content-Type': 'audio/mp4' } });

    const page = await t.call('GET', `/share/${share}`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
    assert.match(page.text, /Anshu Sharma/);
    assert.ok(!page.text.includes('9876543210') && !page.text.includes('anshu@example.com'));

    const data = (await t.call('GET', `/share/${share}/data`)).json;
    assert.equal(data.name, 'Anshu Sharma');
    assert.equal(data.status, 'active');
    assert.deepEqual(data.locations.map((l) => l.latitude), [26.9124, 26.913]);
    assert.deepEqual(data.recordings.map((r) => `${r.kind}${r.part}`).sort(), ['audio1', 'video1']);
    assert.equal(data.contacts, undefined);

    const rec = (id, headers) => t.call('GET', `/share/${share}/r/${id}`, { headers });
    assert.equal((await rec(upA.json.recording.id)).text, audio.toString());
    const ranged = await rec(data.recordings.find((r) => r.kind === 'video').id, { Range: 'bytes=0-7' });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.text, 'fake-mp4');
    assert.equal((await rec(elsewhere.json.recording.id)).status, 404); // Alice's other SOS
    assert.equal((await rec(bobs.json.recording.id)).status, 404);      // someone else's file

    const otherData = (await t.call('GET', `/share/${otherShare}/data`)).json;
    assert.equal(otherData.name, 'Other');
    assert.equal(otherData.recordings.length, 1);
    assert.notEqual(otherData.recordings[0].id, upA.json.recording.id);

    const unknown = await t.call('GET', `/share/${require('node:crypto').randomBytes(32).toString('base64url')}`);
    assert.equal(unknown.status, 404);
    assert.match(unknown.text, /Link not available/);
    assert.equal((await t.call('GET', `/share/${share}x/data`)).status, 404);

    // Retried SOS keeps working; ending it keeps the link open (expires share_days after the end).
    assert.equal((await t.call('POST', '/sos', { token: a, body: { clientId: 'sess-s', shareToken: share } })).json.duplicate, true);
    await t.call('PATCH', '/sos/sess-s', { token: a, body: { status: 'resolved', endedAt: new Date().toISOString() } });
    assert.equal((await t.call('GET', `/share/${share}/data`)).json.status, 'resolved');
    const old = new Date(Date.now() - 9 * 86400e3).toISOString();
    await t.call('PATCH', '/sos/sess-s', { token: a, body: { endedAt: old } });
    assert.equal((await t.call('GET', `/share/${share}/data`)).status, 404);
  } finally { t.close(); }
});

test('chunked upload: in order, resumable, idempotent, same file as one-shot', async () => {
  const t = await setup();
  try {
    const a = (await t.call('POST', '/auth/register', { body: ALICE })).json.token;
    await t.call('POST', '/sos', { token: a, body: { clientId: 'sess-c', triggerSource: 'button' } });
    const bytes = require('node:crypto').randomBytes(250_000);
    const put = (offset, end, total = bytes.length) => t.call('POST', `/recordings?sosClientId=sess-c&kind=video&part=1&offset=${offset}&total=${total}`, { token: a, raw: bytes.subarray(offset, end), headers: { 'Content-Type': 'video/quicktime' } });
    const first = await put(0, 100_000);
    assert.equal(first.status, 202, first.text);
    assert.equal(first.json.received, 100_000);
    assert.equal((await put(0, 100_000)).json.received, 100_000);        // repeated piece: not written twice
    assert.equal((await put(200_000, 250_000)).json.received, 100_000);  // gap: told where to continue
    assert.equal((await put(100_000, 200_000)).json.received, 200_000);
    const done = await put(200_000, 250_000);
    assert.equal(done.status, 201, done.text);
    assert.equal(done.json.recording.sizeBytes, bytes.length);
    assert.equal(done.json.recording.sha256, require('node:crypto').createHash('sha256').update(bytes).digest('hex'));
    assert.equal((await t.call('GET', `/recordings/${done.json.recording.id}/file`, { token: a, headers: { Range: 'bytes=0-0' } })).status, 206);
    assert.equal((await put(0, 100_000)).json.duplicate, true);           // whole file already stored

    // A cut-short copy from a server without chunk support is replaced by the full file.
    const short = await t.call('POST', '/recordings?sosClientId=sess-c&kind=video&part=5', { token: a, raw: bytes.subarray(0, 1000), headers: { 'Content-Type': 'video/quicktime' } });
    assert.equal(short.json.recording.sizeBytes, 1000);
    const put5 = (o, e) => t.call('POST', `/recordings?sosClientId=sess-c&kind=video&part=5&offset=${o}&total=${bytes.length}`, { token: a, raw: bytes.subarray(o, e), headers: { 'Content-Type': 'video/quicktime' } });
    assert.equal((await put5(0, 125_000)).status, 202);
    const full = await put5(125_000, 250_000);
    assert.equal(full.status, 201, full.text);
    assert.equal(full.json.recording.sizeBytes, bytes.length);
    assert.equal((await t.call('GET', '/recordings?sosClientId=sess-c', { token: a })).json.recordings.filter((r) => r.part === 5).length, 1);
    assert.equal((await t.call('POST', '/recordings?sosClientId=sess-c&kind=video&part=3&offset=0&total=0', { token: a, raw: bytes.subarray(0, 10), headers: { 'Content-Type': 'video/mp4' } })).status, 400);
    assert.equal((await t.call('POST', '/recordings?sosClientId=sess-c&kind=video&part=2&offset=0&total=99999999', { token: a, raw: bytes.subarray(0, 10), headers: { 'Content-Type': 'video/mp4' } })).status, 413);
  } finally { t.close(); }
});

test('app data backup (contacts, settings): owner-only, replaced each time', async () => {
  const t = await setup();
  try {
    const a = (await t.call('POST', '/auth/register', { body: ALICE })).json.token;
    const b = (await t.call('POST', '/auth/register', { body: { fullName: 'Other', email: 'other@example.com', password: 'other-password' } })).json.token;
    assert.deepEqual((await t.call('GET', '/backup', { token: a })).json, { backup: null, updatedAt: null });
    const doc = { contacts: [{ id: 'c1', name: 'Maa', phoneNumber: '+919876543210', priority: 0 }], settings: { voiceActivation: { enabled: true, phrase: 'help me vishwas now' } } };
    assert.equal((await t.call('POST', '/backup', { token: a, body: doc })).status, 200);
    assert.deepEqual((await t.call('GET', '/backup', { token: a })).json.backup, doc);
    assert.equal((await t.call('GET', '/backup', { token: b })).json.backup, null);
    await t.call('POST', '/backup', { token: a, body: { contacts: [] } });
    assert.deepEqual((await t.call('GET', '/backup', { token: a })).json.backup, { contacts: [] });
    assert.equal((await t.call('POST', '/backup', { token: a, body: { contacts: 'nope' } })).status, 400);
    assert.equal((await t.call('GET', '/backup')).status, 401);
    // No Twilio here: alerts are refused at once, so the phone sends from Messages.
    const noTwilio = await t.call('POST', '/alerts/emergency', { body: { sessionId: 'z', message: '🚨 EMERGENCY ALERT! test', contacts: [{ id: 'a', name: 'Maa', phoneNumber: '+919876543210' }] }, headers: { 'x-vishwas-key': KEY } });
    assert.equal(noTwilio.status, 503);
    assert.equal(noTwilio.json.code, 'MESSAGING_OFF');
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
    assert.equal((await post({ sessionId: 'y', message: 'https://evil.example/x Buy now!', contacts })).status, 400);

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

    // The alert may open with its emergency link.
    const linkFirst = `https://example.test/api/share/${'A'.repeat(43)}\n${MSG}`;
    const withLink = await post({ sessionId: 's0', message: linkFirst, contacts: [contacts[0]] });
    assert.equal(withLink.status, 200, withLink.text);
    assert.equal(twilio.sent.at(-1).Body, linkFirst);
  } finally {
    t.close();
    await twilio.close();
  }
});
