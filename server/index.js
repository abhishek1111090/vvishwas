'use strict';
// Starts the VISHWAS server from environment variables (see .env.example).
// Locally: `npm start` (reads server/.env if present). On Plesk: the Node.js
// extension runs this file; set the variables in its panel instead of a file.

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);

const { createApp } = require('./app');
const { createTwilioProvider } = require('./sms');
const { createDb } = require('./db');
const { createApi } = require('./api');

const env = process.env;
const publicUrl = (env.PUBLIC_URL ?? '').replace(/\/+$/, '');

// Messaging (Twilio) is optional: without it SOS alerts fall back to the
// phone's Messages app, and the account/recording API still works.
const twilioReady = env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && (env.TWILIO_FROM || env.TWILIO_MESSAGING_SERVICE_SID || env.TWILIO_WHATSAPP_FROM);
const provider = twilioReady
  ? createTwilioProvider({
    accountSid: env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN,
    from: env.TWILIO_FROM,
    messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID,
    whatsappFrom: env.TWILIO_WHATSAPP_FROM,
    // Delivery reports need a public HTTPS address Twilio can reach.
    statusCallbackUrl: publicUrl ? `${publicUrl}/sms/status` : undefined,
  })
  : { name: 'none', supportsSms: false, supportsWhatsApp: false, send: async () => ({ ok: false, error: 'Messaging is not configured on the server' }) };

function createMailer() {
  if (!env.SMTP_URL) return null;
  const nodemailer = require('nodemailer');
  const transport = nodemailer.createTransport(env.SMTP_URL);
  const from = env.MAIL_FROM || 'VISHWAS <no-reply@localhost>';
  return { send: ({ to, subject, text }) => transport.sendMail({ from, to, subject, text }) };
}

async function main() {
  let api = null;
  if (env.DATABASE_URL) {
    const db = createDb({
      connectionString: env.DATABASE_URL,
      // Same-server PostgreSQL needs no TLS; set DATABASE_SSL=require for a remote one.
      ssl: env.DATABASE_SSL === 'require' ? { rejectUnauthorized: env.DATABASE_SSL_INSECURE !== '1' } : undefined,
    });
    if (env.MIGRATE_ON_START !== '0') {
      try {
        const ran = await db.migrate({ log: (m) => console.log(`[db] ${m}`) });
        console.log(`[db] schema up to date${ran.length ? ` (${ran.length} migration${ran.length === 1 ? '' : 's'} applied)` : ''}`);
      } catch (err) {
        console.error(`[db] migration failed: ${err.code ?? err.message} — API will report the database as unavailable`);
      }
    }
    api = createApi({
      db,
      storageDir: env.STORAGE_DIR || null,
      mailer: createMailer(),
      publicUrl,
      maxUploadBytes: (Number(env.MAX_UPLOAD_MB) || 200) * 1024 * 1024,
      sessionDays: Number(env.SESSION_DAYS) || 30,
    });
    if (!env.STORAGE_DIR) console.warn('[storage] STORAGE_DIR not set — recording uploads are disabled');
  } else {
    console.warn('[db] DATABASE_URL not set — accounts, SOS history and recordings API are disabled');
  }

  const handler = createApp({
    provider,
    appKey: env.VISHWAS_APP_KEY,
    defaultCountryCode: env.DEFAULT_COUNTRY_CODE ?? '',
    twilioAuthToken: env.TWILIO_AUTH_TOKEN,
    publicUrl,
    mediaDir: path.join(env.STORAGE_DIR || __dirname, 'whatsapp-media'),
    api,
    trustProxy: env.TRUST_PROXY === '1',
  });

  const port = Number(env.PORT) || 8787;
  http.createServer(handler).listen(port, () => {
    console.log(`VISHWAS server on :${port} · api ${api ? 'on' : 'off'} · messaging ${provider.name} · delivery reports ${publicUrl ? 'on' : 'off'}`);
  });
}

main();
