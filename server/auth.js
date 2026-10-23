'use strict';
// auth.js — password hashing, session tokens and rate limiting.
//
// Passwords: scrypt (memory-hard, built into Node; OWASP-recommended
// alternative to Argon2id/bcrypt) with N=2^15, r=8, p=1, a 16-byte random
// salt and a 64-byte key. Stored as "scrypt$N$r$p$salt$hash" so parameters
// can be raised later without breaking existing users.
// Tokens: 32 random bytes (base64url) given to the app once; only their
// SHA-256 is stored, so a database leak doesn't leak usable sessions.

const crypto = require('node:crypto');

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 64 };
const MAXMEM = 64 * 1024 * 1024;

function scrypt(password, salt, { N, r, p, keylen }) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, { N, r, p, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

async function hashPassword(password, params = SCRYPT) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, params);
  return ['scrypt', params.N, params.r, params.p, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const parts = String(stored ?? '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(String(password).normalize('NFKC'), Buffer.from(salt, 'base64'), { N: Number(N), r: Number(r), p: Number(p), keylen: expected.length });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

/** A dummy hash to verify against when the email is unknown (same timing as a real check). */
let dummyHash = null;
async function dummyVerify(password) {
  dummyHash ??= await hashPassword('vishwas-timing-equaliser');
  await verifyPassword(password, dummyHash);
  return false;
}

const newToken = () => crypto.randomBytes(32).toString('base64url');
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/** Fixed-window limiter: `limit` hits per `windowMs` per key. */
function createRateLimiter({ limit, windowMs, now = () => Date.now() }) {
  const hits = new Map();
  return {
    /** true when this hit is over the limit. */
    hit(key) {
      const t = now();
      const entry = hits.get(key);
      if (!entry || t - entry.start >= windowMs) {
        hits.set(key, { start: t, count: 1 });
        if (hits.size > 10_000) for (const [k, v] of hits) if (t - v.start >= windowMs) hits.delete(k);
        return false;
      }
      entry.count += 1;
      return entry.count > limit;
    },
  };
}

module.exports = { hashPassword, verifyPassword, dummyVerify, newToken, hashToken, createRateLimiter, SCRYPT };
