// Upload recordings that are sitting on this laptop (e.g. server/media from
// the old Node test server) into your VISHWAS account on the Plesk server.
//
//   node server-php/scripts/upload-laptop-files.mjs [folder]
//
// You type your VISHWAS email and password here (the password is hidden and
// never saved). Files go straight to the Plesk server: until adabhishek1.in
// has a real certificate, the connection is pinned to that server's exact
// certificate (CERT_SHA256), so nothing else can receive your password.
// Safe to run again: files already uploaded are skipped by the server.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import tls from 'node:tls';
import readline from 'node:readline';

const SERVER_IP = process.env.VISHWAS_SERVER_IP || '94.136.187.4';
const HOST = 'adabhishek1.in';
const CERT_SHA256 = process.env.VISHWAS_CERT_SHA256 || '8C:ED:47:48:04:E4:54:C6:E6:CE:35:46:46:41:57:9B:30:8B:74:9A:11:7C:EE:F2:20:1A:CD:FA:F1:E0:25:BA';
const TYPES = { '.m4a': ['audio', 'audio/mp4'], '.aac': ['audio', 'audio/aac'], '.mp4': ['video', 'video/mp4'], '.mov': ['video', 'video/quicktime'], '.jpg': ['photo', 'image/jpeg'], '.jpeg': ['photo', 'image/jpeg'] };
const FIRST_PART = 5001; // event-less uploads: their own part range, so re-runs are recognised

const folder = path.resolve(process.argv[2] || path.join(import.meta.dirname, '..', '..', 'server', 'media'));

/** A TLS connection to the server, used only if its certificate is exactly the pinned one. */
function pinnedSocket() {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: SERVER_IP, port: 443, servername: HOST, rejectUnauthorized: false }, () => {
      const fp = socket.getPeerCertificate().fingerprint256;
      if (fp === CERT_SHA256) return resolve(socket);
      socket.destroy();
      return reject(new Error(`Unexpected server certificate ${fp}. Nothing was sent.`));
    });
    socket.on('error', reject);
  });
}

async function request(method, apiPath, { json, file, type, token } = {}) {
  const socket = await pinnedSocket();
  return new Promise((resolve, reject) => {
    const body = json ? Buffer.from(JSON.stringify(json)) : null;
    // HTTP over the already-verified TLS socket.
    const req = http.request({
      method, path: `/api${apiPath}`, createConnection: () => socket,
      headers: {
        Host: HOST,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': body.length } : {}),
        ...(file ? { 'Content-Type': type, 'Content-Length': fs.statSync(file).size } : {}),
      },
      timeout: 15 * 60_000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, json: parsed });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timed out')));
    if (body) req.end(body);
    else if (file) fs.createReadStream(file).pipe(req);
    else req.end();
  });
}

// One prompt for both questions; while the password is typed nothing is echoed.
let rl = null;
let lines = null;
let muted = false;
async function ask(question, hidden = false) {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
    const write = rl._writeToOutput?.bind(rl);
    if (write) rl._writeToOutput = (s) => { if (!muted) write(s); };
    lines = rl[Symbol.asyncIterator](); // buffers lines, so piped input works too
  }
  process.stdout.write(question);
  muted = hidden;
  const { value } = await lines.next();
  muted = false;
  if (hidden) process.stdout.write('\n');
  return String(value ?? '').trim();
}

if (process.argv.includes('--check')) {
  // Connection test only: pinned TLS to the server, no sign-in, nothing uploaded.
  try {
    const res = await request('GET', '/health');
    console.log(`Server reached (certificate matches): HTTP ${res.status} ${JSON.stringify(res.json)}`);
  } catch (err) {
    console.log(`Not connected: ${err.message || err.code || err}`);
    process.exitCode = 1;
  }
  process.exit();
}

const files = fs.existsSync(folder) ? fs.readdirSync(folder).filter((f) => TYPES[path.extname(f).toLowerCase()]).sort() : [];
if (files.length === 0) {
  console.log(`No audio/video/photo files in ${folder}`);
  process.exit(0);
}
console.log(`${files.length} file(s) in ${folder}`);
const email = await ask('VISHWAS email: ');
const password = await ask('VISHWAS password (hidden): ', true);
rl.close();
const login = await request('POST', '/auth/login', { json: { email, password } });
if (login.status !== 200) {
  console.log(`Sign-in failed (${login.status}): ${login.json?.message ?? 'unknown error'}`);
  process.exit(1);
}
const token = login.json.token;
let ok = 0;
for (const [i, name] of files.entries()) {
  const [kind, type] = TYPES[path.extname(name).toLowerCase()];
  const file = path.join(folder, name);
  process.stdout.write(`${name} (${(fs.statSync(file).size / 1048576).toFixed(1)} MB) … `);
  try {
    const res = await request('POST', `/recordings?kind=${kind}&part=${FIRST_PART + i}`, { file, type, token });
    if (res.status === 201 || res.status === 200) { ok += 1; console.log(res.json?.duplicate ? 'already on the server' : 'uploaded'); }
    else console.log(`failed (${res.status}): ${res.json?.message ?? ''}`);
  } catch (err) {
    console.log(`failed: ${err.message}`);
  }
}
await request('POST', '/auth/logout', { token }).catch(() => {});
console.log(`${ok}/${files.length} on the server (Plesk → Databases → recordings; files in vishwas-private/recordings).`);
