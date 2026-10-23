'use strict';
// db.js — PostgreSQL access: a connection pool, parameterised queries only,
// transactions, and an additive migration runner (migrations/*.sql, applied
// once each, recorded in schema_migrations).

const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function createDb({ connectionString, pool, ssl } = {}) {
  let p = pool;
  if (!p) {
    const { Pool } = require('pg');
    p = new Pool({
      connectionString,
      max: Number(process.env.DATABASE_POOL_MAX) || 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl,
    });
    // An idle client dying (DB restart) must not crash the process.
    p.on('error', (err) => console.error(`[db] idle client error: ${err.code ?? err.message}`));
  }

  /** Parameterised query → rows. Never interpolate values into `text`. */
  async function query(text, params = []) {
    const res = await p.query(text, params);
    return res.rows;
  }

  async function one(text, params = []) {
    return (await query(text, params))[0] ?? null;
  }

  /** Run fn(client) in a transaction; rolls back on any throw. */
  async function tx(fn) {
    const client = await p.connect();
    try {
      await client.query('BEGIN');
      const result = await fn({
        query: async (t, v = []) => (await client.query(t, v)).rows,
        one: async (t, v = []) => (await client.query(t, v)).rows[0] ?? null,
      });
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async function migrate({ dir = MIGRATIONS_DIR, log = () => {} } = {}) {
    let rows;
    try {
      rows = await query('SELECT version FROM schema_migrations');
    } catch {
      // First run: the bookkeeping table doesn't exist yet.
      await query('CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
      rows = [];
    }
    const applied = new Set(rows.map((r) => r.version));
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const ran = [];
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      await tx(async (t) => {
        await t.query(sql);
        await t.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
      });
      log(`applied ${file}`);
      ran.push(file);
    }
    return ran;
  }

  /** true when the database answers. */
  async function ping() {
    try {
      await query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  return { query, one, tx, migrate, ping, close: () => p.end() };
}

module.exports = { createDb };
