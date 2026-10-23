'use strict';
// api.js — VISHWAS account + data API (PostgreSQL), mounted under /api.
//
//   GET    /health                       liveness + "is the database answering" (no details)
//   POST   /auth/register                { fullName, email, password } → { user, token }
//   POST   /auth/login                   { email, password }           → { user, token }
//   POST   /auth/logout                  ends this session
//   GET    /auth/me | PATCH /auth/me     profile ({ fullName })
//   POST   /auth/forgot-password         { email } → always 202 (no account probing)
//   GET    /auth/reset?token=…           small HTML form to choose a new password
//   POST   /auth/reset-password          { token, password } → ends all sessions
//   POST   /sos                          create the SOS once (idempotent on clientId)
//   PATCH  /sos/:clientId                status / end time / alert outcome
//   GET    /sos                          your SOS history
//   POST   /location                     a GPS point for one of your SOS events
//   POST   /recordings?sosClientId&kind&part   raw file body (audio/video/photo), idempotent
//   GET    /recordings[?sosClientId]     your files' metadata
//   GET    /recordings/:id/file          stream a file you own (Range supported)
//   DELETE /recordings/:id               delete a file you own
//
// Every data route needs "Authorization: Bearer <token>" and only ever
// touches rows owned by that user. Request bodies, passwords and tokens are
// never logged.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const { hashPassword, verifyPassword, dummyVerify, newToken, hashToken, createRateLimiter } = require('./auth');

const JSON_LIMIT = 32 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TRIGGERS = new Set(['button', 'tripleTap', 'voice', 'siri', 'watch', 'safetyTimer']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE_TYPES = {
  audio: { 'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac' },
  video: { 'video/mp4': 'mp4', 'video/quicktime': 'mov' },
  photo: { 'image/jpeg': 'jpg' },
};

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function send(res, status, body) {
  if (status === 204) {
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    return res.end();
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  return res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > JSON_LIMIT) {
        reject(new HttpError(413, 'TOO_LARGE', 'Request too large.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      const type = String(req.headers['content-type'] ?? '');
      if (type.startsWith('application/x-www-form-urlencoded')) return resolve(Object.fromEntries(new URLSearchParams(raw)));
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, 'BAD_JSON', 'Invalid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
function isoOrNull(v) {
  if (v == null) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, 'BAD_TIME', 'Invalid timestamp.');
  const t = d.getTime();
  if (t < Date.UTC(2020, 0, 1) || t > Date.now() + 24 * 3600 * 1000) throw new HttpError(400, 'BAD_TIME', 'Timestamp out of range.');
  return d.toISOString();
}
const publicUser = (u) => ({ id: u.id, fullName: u.full_name, email: u.email, authProvider: 'server', createdAt: new Date(u.created_at).toISOString() });
const maskPhone = (p) => String(p ?? '').replace(/\d(?=\d{3})/g, '•').slice(-16);
const publicEvent = (e) => ({
  id: e.id, clientId: e.client_id, triggerSource: e.trigger_source, status: e.status,
  startedAt: new Date(e.started_at).toISOString(), endedAt: e.ended_at ? new Date(e.ended_at).toISOString() : null,
  receivedAt: new Date(e.received_at).toISOString(), contacts: e.contacts ?? [], alertSummary: e.alert_summary ?? null,
});
const publicRecording = (r, clientId = null) => ({
  id: r.id, kind: r.kind, part: r.part, contentType: r.content_type, sizeBytes: Number(r.size_bytes),
  sha256: r.sha256, sosClientId: clientId ?? r.client_id ?? null, createdAt: new Date(r.created_at).toISOString(),
});

function createApi({
  db,
  storageDir,
  mailer = null,
  publicUrl = '',
  maxUploadBytes = 200 * 1024 * 1024,
  sessionDays = 30,
  now = () => Date.now(),
  log = (msg) => console.error(msg),
}) {
  if (storageDir) {
    fs.mkdirSync(path.join(storageDir, '.partial'), { recursive: true, mode: 0o700 });
  }
  const authLimiter = createRateLimiter({ limit: 10, windowMs: 15 * 60 * 1000, now });
  const resetLimiter = createRateLimiter({ limit: 5, windowMs: 60 * 60 * 1000, now });

  async function startSession(userId) {
    const token = newToken();
    const expires = new Date(now() + sessionDays * 24 * 3600 * 1000).toISOString();
    await db.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [hashToken(token), userId, expires]);
    return { token, expiresAt: expires };
  }

  async function requireUser(req) {
    const m = /^Bearer\s+([A-Za-z0-9_-]{20,200})$/.exec(String(req.headers.authorization ?? ''));
    if (!m) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in required.');
    const row = await db.one(
      'SELECT u.*, s.token_hash FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > $2',
      [hashToken(m[1]), new Date(now()).toISOString()]
    );
    if (!row) throw new HttpError(401, 'SESSION_EXPIRED', 'Your session has expired. Sign in again.');
    return row;
  }

  async function eventFor(user, clientId) {
    const ev = await db.one('SELECT * FROM sos_events WHERE user_id = $1 AND client_id = $2', [user.id, str(clientId, 100)]);
    if (!ev) throw new HttpError(404, 'NOT_FOUND', 'Unknown SOS event.');
    return ev;
  }

  // ── auth ────────────────────────────────────────────────────────────────
  async function register(req, ip) {
    if (authLimiter.hit(`reg:${ip}`)) throw new HttpError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.');
    const b = await readJson(req);
    const fullName = str(b.fullName, 80);
    const email = str(b.email, 254).toLowerCase();
    const password = typeof b.password === 'string' ? b.password : '';
    if (!fullName) throw new HttpError(400, 'INVALID_NAME', 'Please enter your name.');
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'INVALID_EMAIL', 'Please enter a valid email address.');
    if (password.length < 8 || password.length > 128) throw new HttpError(400, 'WEAK_PASSWORD', 'Password must be 8–128 characters.');
    if (await db.one('SELECT id FROM users WHERE email = $1', [email])) {
      throw new HttpError(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
    }
    const user = { id: crypto.randomUUID(), email, full_name: fullName, created_at: new Date(now()).toISOString() };
    const hash = await hashPassword(password);
    try {
      await db.query('INSERT INTO users (id, email, full_name, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)', [user.id, email, fullName, hash, user.created_at]);
    } catch (err) {
      if (err.code === '23505') throw new HttpError(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
      throw err;
    }
    return [201, { user: publicUser(user), ...(await startSession(user.id)) }];
  }

  async function login(req, ip) {
    const b = await readJson(req);
    const email = str(b.email, 254).toLowerCase();
    if (authLimiter.hit(`login:${ip}`) || authLimiter.hit(`login:${email}`)) throw new HttpError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.');
    const password = typeof b.password === 'string' ? b.password : '';
    const user = EMAIL_RE.test(email) ? await db.one('SELECT * FROM users WHERE email = $1', [email]) : null;
    const ok = user ? await verifyPassword(password, user.password_hash) : await dummyVerify(password);
    if (!ok) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
    return [200, { user: publicUser(user), ...(await startSession(user.id)) }];
  }

  async function forgotPassword(req, ip) {
    const b = await readJson(req);
    const email = str(b.email, 254).toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'INVALID_EMAIL', 'Please enter a valid email address.');
    if (!mailer) throw new HttpError(503, 'RESET_NOT_CONFIGURED', 'Password reset email is not set up on the server yet.');
    if (resetLimiter.hit(`reset:${ip}`) || resetLimiter.hit(`reset:${email}`)) throw new HttpError(429, 'RATE_LIMITED', 'Too many requests. Try again later.');
    const user = await db.one('SELECT id, email FROM users WHERE email = $1', [email]);
    if (user) {
      const token = newToken();
      await db.query('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [hashToken(token), user.id, new Date(now() + 30 * 60 * 1000).toISOString()]);
      const link = `${publicUrl.replace(/\/+$/, '')}/api/auth/reset?token=${token}`;
      await mailer.send({
        to: user.email,
        subject: 'Reset your VISHWAS password',
        text: `Someone asked to reset the password for your VISHWAS account.\n\nOpen this link within 30 minutes to choose a new password:\n${link}\n\nIf this wasn't you, ignore this email — your password stays the same.`,
      }).catch((err) => log(`[mail] reset email failed: ${err.code ?? err.message}`));
    }
    // Same answer whether or not the account exists.
    return [202, { ok: true }];
  }

  async function resetPassword(req) {
    const b = await readJson(req);
    const token = str(b.token, 200);
    const password = typeof b.password === 'string' ? b.password : '';
    if (password.length < 8 || password.length > 128) throw new HttpError(400, 'WEAK_PASSWORD', 'Password must be 8–128 characters.');
    const hash = await hashPassword(password);
    await db.tx(async (t) => {
      const row = await t.one('SELECT * FROM password_resets WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2', [hashToken(token), new Date(now()).toISOString()]);
      if (!row) throw new HttpError(400, 'BAD_TOKEN', 'This reset link is invalid or has expired.');
      await t.query('UPDATE password_resets SET used_at = $1 WHERE token_hash = $2', [new Date(now()).toISOString(), row.token_hash]);
      await t.query('UPDATE users SET password_hash = $1, updated_at = $2 WHERE id = $3', [hash, new Date(now()).toISOString(), row.user_id]);
      await t.query('DELETE FROM sessions WHERE user_id = $1', [row.user_id]); // sign out everywhere
    });
    return [204];
  }

  function resetPage(token) {
    const safe = String(token).replace(/[^A-Za-z0-9_-]/g, '');
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reset VISHWAS password</title>
<style>body{font-family:system-ui,sans-serif;max-width:420px;margin:40px auto;padding:0 16px}input,button{width:100%;padding:12px;margin:6px 0;font-size:16px;box-sizing:border-box}button{background:#0B0B0B;color:#fff;border:0;border-radius:999px}</style></head>
<body><h2>Choose a new password</h2><form method="post" action="/api/auth/reset-password"><input type="hidden" name="token" value="${safe}"><input type="password" name="password" minlength="8" maxlength="128" placeholder="New password (8+ characters)" required autocomplete="new-password"><button type="submit">Save password</button></form></body></html>`;
  }

  // ── SOS ─────────────────────────────────────────────────────────────────
  async function createSos(req, user) {
    const b = await readJson(req);
    const clientId = str(b.clientId, 100);
    if (!clientId) throw new HttpError(400, 'BAD_CLIENT_ID', 'clientId is required.');
    const trigger = TRIGGERS.has(b.triggerSource) ? b.triggerSource : 'button';
    const startedAt = isoOrNull(b.startedAt) ?? new Date(now()).toISOString();
    const contacts = Array.isArray(b.contacts)
      ? b.contacts.slice(0, 20).map((c) => ({ contactId: str(c?.id, 64), name: str(c?.name, 80), phoneMasked: maskPhone(c?.phoneNumber) }))
      : [];

    const existing = await db.one('SELECT * FROM sos_events WHERE user_id = $1 AND client_id = $2', [user.id, clientId]);
    if (existing) return [200, { event: publicEvent(existing), duplicate: true }];
    const ev = { id: crypto.randomUUID() };
    try {
      await db.query(
        'INSERT INTO sos_events (id, user_id, client_id, trigger_source, status, started_at, contacts) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [ev.id, user.id, clientId, trigger, 'active', startedAt, JSON.stringify(contacts)]
      );
    } catch (err) {
      if (err.code !== '23505') throw err; // a concurrent retry created it first
    }
    const row = await db.one('SELECT * FROM sos_events WHERE user_id = $1 AND client_id = $2', [user.id, clientId]);
    if (b.location) await insertLocation(row.id, b.location);
    return [201, { event: publicEvent(row) }];
  }

  async function updateSos(req, user, clientId) {
    const ev = await eventFor(user, clientId);
    const b = await readJson(req);
    const status = ['active', 'resolved', 'cancelled'].includes(b.status) ? b.status : ev.status;
    const endedAt = b.endedAt !== undefined ? isoOrNull(b.endedAt) : ev.ended_at;
    const summary = b.alertSummary !== undefined ? JSON.stringify(b.alertSummary).slice(0, 20_000) : null;
    await db.query(
      `UPDATE sos_events SET status = $1, ended_at = $2, alert_summary = COALESCE($3::jsonb, alert_summary), updated_at = $4 WHERE id = $5`,
      [status, endedAt, summary, new Date(now()).toISOString(), ev.id]
    );
    return [200, { event: publicEvent(await db.one('SELECT * FROM sos_events WHERE id = $1', [ev.id])) }];
  }

  async function insertLocation(eventId, loc) {
    const lat = Number(loc?.latitude);
    const lon = Number(loc?.longitude);
    const acc = loc?.accuracy == null ? null : Number(loc.accuracy);
    if (!(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 180)) throw new HttpError(400, 'BAD_LOCATION', 'Invalid coordinates.');
    if (acc != null && !(acc >= 0 && acc <= 100_000)) throw new HttpError(400, 'BAD_LOCATION', 'Invalid accuracy.');
    const recordedAt = isoOrNull(loc.timestamp ?? loc.recordedAt) ?? new Date(now()).toISOString();
    await db.query('INSERT INTO sos_locations (id, event_id, latitude, longitude, accuracy_m, recorded_at) VALUES ($1, $2, $3, $4, $5, $6)', [crypto.randomUUID(), eventId, lat, lon, acc, recordedAt]);
  }

  async function addLocation(req, user) {
    const b = await readJson(req);
    const ev = await eventFor(user, b.sosClientId);
    await insertLocation(ev.id, b);
    return [201, { ok: true }];
  }

  async function listSos(user) {
    const rows = await db.query('SELECT * FROM sos_events WHERE user_id = $1 ORDER BY started_at DESC LIMIT 50', [user.id]);
    return [200, { events: rows.map(publicEvent) }];
  }

  // ── recordings ──────────────────────────────────────────────────────────
  async function uploadRecording(req, res, user, url) {
    if (!storageDir) throw new HttpError(503, 'NO_STORAGE', 'Recording storage is not configured.');
    const kind = url.searchParams.get('kind');
    const part = Number(url.searchParams.get('part') ?? 1);
    const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (!FILE_TYPES[kind]) throw new HttpError(400, 'BAD_KIND', 'kind must be audio, video or photo.');
    if (!Number.isInteger(part) || part < 1 || part > 9999) throw new HttpError(400, 'BAD_PART', 'part must be 1–9999.');
    const ext = FILE_TYPES[kind][type];
    if (!ext) throw new HttpError(415, 'BAD_TYPE', `A ${kind} upload can't be ${type || 'untyped'}.`);
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxUploadBytes) throw new HttpError(413, 'TOO_LARGE', 'File too large.');
    const ev = url.searchParams.get('sosClientId') ? await eventFor(user, url.searchParams.get('sosClientId')) : null;

    const uploadKey = `${user.id}/${ev?.id ?? 'none'}/${kind}/${part}`;
    const already = await db.one('SELECT * FROM recordings WHERE upload_key = $1', [uploadKey]);
    if (already) {
      req.resume(); // discard the body; the earlier upload already completed
      return [200, { recording: publicRecording(already, ev?.client_id), duplicate: true }];
    }

    const id = crypto.randomUUID();
    const partial = path.join(storageDir, '.partial', `${id}.upload`);
    const dir = path.join(storageDir, user.id);
    const finalKey = `${user.id}/${id}.${ext}`;
    const hash = crypto.createHash('sha256');
    let size = 0;
    const meter = new Transform({
      transform(chunk, _enc, cb) {
        size += chunk.length;
        if (size > maxUploadBytes) return cb(new HttpError(413, 'TOO_LARGE', 'File too large.'));
        hash.update(chunk);
        return cb(null, chunk);
      },
    });
    try {
      await pipeline(req, meter, fs.createWriteStream(partial, { mode: 0o600 }));
    } catch (err) {
      fs.rm(partial, { force: true }, () => {});
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, 'UPLOAD_INTERRUPTED', 'The upload was interrupted. Try again.');
    }
    if (size === 0) {
      fs.rm(partial, { force: true }, () => {});
      throw new HttpError(400, 'EMPTY', 'Empty file.');
    }
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.renameSync(partial, path.join(storageDir, finalKey));
    try {
      await db.query(
        'INSERT INTO recordings (id, user_id, event_id, kind, part, upload_key, content_type, size_bytes, sha256, storage_key) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
        [id, user.id, ev?.id ?? null, kind, part, uploadKey, type, size, hash.digest('hex'), finalKey]
      );
    } catch (err) {
      fs.rm(path.join(storageDir, finalKey), { force: true }, () => {});
      if (err.code === '23505') {
        const row = await db.one('SELECT * FROM recordings WHERE upload_key = $1', [uploadKey]);
        return [200, { recording: publicRecording(row, ev?.client_id), duplicate: true }];
      }
      throw err;
    }
    const row = await db.one('SELECT * FROM recordings WHERE id = $1', [id]);
    return [201, { recording: publicRecording(row, ev?.client_id) }];
  }

  async function listRecordings(user, url) {
    const clientId = url.searchParams.get('sosClientId');
    const rows = clientId
      ? await db.query('SELECT r.*, e.client_id FROM recordings r LEFT JOIN sos_events e ON e.id = r.event_id WHERE r.user_id = $1 AND e.client_id = $2 ORDER BY r.created_at', [user.id, clientId])
      : await db.query('SELECT r.*, e.client_id FROM recordings r LEFT JOIN sos_events e ON e.id = r.event_id WHERE r.user_id = $1 ORDER BY r.created_at DESC LIMIT 200', [user.id]);
    return [200, { recordings: rows.map((r) => publicRecording(r)) }];
  }

  async function ownRecording(user, id) {
    if (!UUID_RE.test(id)) throw new HttpError(404, 'NOT_FOUND', 'Recording not found.');
    const row = await db.one('SELECT * FROM recordings WHERE id = $1 AND user_id = $2', [id, user.id]);
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'Recording not found.'); // same answer for "not yours"
    return row;
  }

  async function streamRecording(req, res, user, id) {
    const row = await ownRecording(user, id);
    const file = path.join(storageDir, row.storage_key);
    if (!fs.existsSync(file)) throw new HttpError(410, 'GONE', 'The file is no longer on the server.');
    const total = fs.statSync(file).size;
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    const headers = { 'Content-Type': row.content_type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store' };
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : total - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : total - 1;
      start = Math.max(0, start);
      end = Math.min(end, total - 1);
      if (start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${total}` });
        return res.end();
      }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': total });
    return fs.createReadStream(file).pipe(res);
  }

  async function deleteRecording(user, id) {
    const row = await ownRecording(user, id);
    await db.query('DELETE FROM recordings WHERE id = $1 AND user_id = $2', [row.id, user.id]);
    fs.rm(path.join(storageDir, row.storage_key), { force: true }, () => {});
    return [204];
  }

  /**
   * Handle an /api route. `pathname` has the /api prefix removed.
   * Returns false when the route isn't one of ours.
   */
  async function route(req, res, url, pathname, ip) {
    const m = req.method;
    const reply = async (fn) => {
      try {
        const [status, body] = await fn();
        if (status === 'html') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          return res.end(body);
        }
        if (status === 'stream') return undefined;
        return send(res, status, body);
      } catch (err) {
        if (err instanceof HttpError) return send(res, err.status, { code: err.code, message: err.message });
        log(`[api] ${m} ${pathname} failed: ${err.code ?? err.name ?? 'error'}`);
        const dbDown = ['ECONNREFUSED', 'ETIMEDOUT', '57P01', '08006', '08001'].includes(err.code);
        return send(res, dbDown ? 503 : 500, dbDown ? { code: 'DB_UNAVAILABLE', message: 'Server storage is unavailable. Try again shortly.' } : { code: 'SERVER_ERROR', message: 'Server error.' });
      }
    };
    const authed = (fn) => reply(async () => fn(await requireUser(req)));

    if (m === 'GET' && pathname === '/health') return reply(async () => [200, { ok: true, db: (await db.ping()) ? 'ok' : 'unavailable' }]).then(() => true);
    if (m === 'POST' && pathname === '/auth/register') return reply(() => register(req, ip)).then(() => true);
    if (m === 'POST' && pathname === '/auth/login') return reply(() => login(req, ip)).then(() => true);
    if (m === 'POST' && pathname === '/auth/forgot-password') return reply(() => forgotPassword(req, ip)).then(() => true);
    if (m === 'GET' && pathname === '/auth/reset') return reply(async () => ['html', resetPage(url.searchParams.get('token') ?? '')]).then(() => true);
    if (m === 'POST' && pathname === '/auth/reset-password') {
      const html = String(req.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded');
      return reply(async () => {
        const [status] = await resetPassword(req);
        return html ? ['html', '<!doctype html><meta charset="utf-8"><p style="font-family:system-ui;margin:40px">Password changed. Open VISHWAS and sign in with your new password.</p>'] : [status];
      }).then(() => true);
    }
    if (m === 'POST' && pathname === '/auth/logout') {
      return authed(async (user) => {
        await db.query('DELETE FROM sessions WHERE token_hash = $1', [user.token_hash]);
        return [204];
      }).then(() => true);
    }
    if (pathname === '/auth/me' && m === 'GET') return authed(async (user) => [200, { user: publicUser(user) }]).then(() => true);
    if (pathname === '/auth/me' && m === 'PATCH') {
      return authed(async (user) => {
        const b = await readJson(req);
        const fullName = str(b.fullName, 80);
        if (!fullName) throw new HttpError(400, 'INVALID_NAME', 'Please enter your name.');
        await db.query('UPDATE users SET full_name = $1, updated_at = $2 WHERE id = $3', [fullName, new Date(now()).toISOString(), user.id]);
        return [200, { user: publicUser({ ...user, full_name: fullName }) }];
      }).then(() => true);
    }
    if (pathname === '/sos' && m === 'POST') return authed((user) => createSos(req, user)).then(() => true);
    if (pathname === '/sos' && m === 'GET') return authed((user) => listSos(user)).then(() => true);
    const sosM = /^\/sos\/([^/]{1,100})$/.exec(pathname);
    if (sosM && m === 'PATCH') return authed((user) => updateSos(req, user, decodeURIComponent(sosM[1]))).then(() => true);
    if (pathname === '/location' && m === 'POST') return authed((user) => addLocation(req, user)).then(() => true);
    if (pathname === '/recordings' && m === 'POST') return authed((user) => uploadRecording(req, res, user, url)).then(() => true);
    if (pathname === '/recordings' && m === 'GET') return authed((user) => listRecordings(user, url)).then(() => true);
    const fileM = /^\/recordings\/([^/]+)\/file$/.exec(pathname);
    if (fileM && m === 'GET') {
      return authed(async (user) => {
        await streamRecording(req, res, user, fileM[1]);
        return ['stream'];
      }).then(() => true);
    }
    const recM = /^\/recordings\/([^/]+)$/.exec(pathname);
    if (recM && m === 'DELETE') return authed((user) => deleteRecording(user, recM[1])).then(() => true);
    return false;
  }

  return { route };
}

module.exports = { createApi, HttpError };
