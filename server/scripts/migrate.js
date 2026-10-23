'use strict';
// Apply database migrations once: `npm run migrate` (uses DATABASE_URL).
const fs = require('node:fs');
const path = require('node:path');

const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);
const { createDb } = require('../db');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
const db = createDb({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'require' ? { rejectUnauthorized: true } : undefined });
db.migrate({ log: (m) => console.log(m) })
  .then((ran) => console.log(ran.length ? `Applied ${ran.length} migration(s).` : 'Already up to date.'))
  .catch((err) => { console.error(`Migration failed: ${err.message}`); process.exitCode = 1; })
  .finally(() => db.close());
