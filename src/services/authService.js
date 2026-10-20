/**
 * authService.js — on-device accounts
 *
 * WHAT THIS IS: VISHWAS has no authentication server yet, so accounts are
 * DEVICE-LOCAL: an account created on one phone exists only on that phone.
 * The UI says so. Every function keeps the same signature a server-backed
 * version would have, so swapping in real API calls later doesn't touch UI.
 *
 * PASSWORD STORAGE: never plaintext. New passwords are stored as
 * PBKDF2-HMAC-SHA256 (310,000 iterations, 16-byte random salt per user) via
 * WebCrypto, which is available in the Capacitor WebView (secure context:
 * https://localhost on Android, capacitor://localhost on iOS).
 * Older accounts created with the previous unsalted SHA-256 scheme are
 * verified once with that scheme and transparently upgraded to PBKDF2.
 *
 * Passwords and hashes are never logged.
 */

import { readJSON, writeJSONOrThrow, remove } from '../utils/storage';
import { STORAGE_KEYS } from '../utils/constants';
import { isStrongEnoughPassword, isValidEmail, isNonEmpty, normalizeEmail, LIMITS } from '../utils/validation';
import { generateUUID } from '../utils/uuid';
import { apiPost, isApiConfigured } from './apiClient';

export class AuthError extends Error {}

const ERRORS = {
  invalidCredentials: 'Incorrect email or password.',
  emailAlreadyRegistered: 'An account with this email already exists on this device.',
  weakPassword: 'Password must be 8–128 characters.',
  invalidEmail: 'Please enter a valid email address.',
  invalidName: 'Please enter your name.',
  cryptoUnavailable: 'Secure password hashing is unavailable on this device.',
  storageFailed: 'Could not save your account on this device. Check free storage and try again.',
  resetNotConfigured:
    'Password reset by email needs the VISHWAS server, which is not set up in this build. Accounts are stored only on this device — if you forgot your password, create a new account.',
  appleNotConfigured:
    'Sign in with Apple is not configured in this build yet. Please continue with email.',
};

// ─── Pure-JS SHA-256 fallback ────────────────────────────────────────────────
// Used when crypto.subtle is unavailable (e.g. Safari over HTTP in prod).
// Source: RFC 6234 / FIPS 180-4 reference implementation.

const K = [
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
];

function rotr(n, x) { return (x >>> n) | (x << (32 - n)); }

function sha256Pure(message) {
  const encoded = new TextEncoder().encode(message);
  const length = encoded.length;
  const bitLength = length * 8;

  const paddedLen = ((length + 9 + 63) & ~63);
  const data = new Uint8Array(paddedLen);
  data.set(encoded);
  data[length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(paddedLen - 4, bitLength >>> 0, false);
  view.setUint32(paddedLen - 8, Math.floor(bitLength / 2 ** 32), false);

  let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a;
  let h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;

  const w = new Int32Array(64);
  for (let i = 0; i < paddedLen; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = view.getInt32(i + j * 4, false);
    for (let j = 16; j < 64; j++) {
      const s0 = rotr(7,w[j-15]) ^ rotr(18,w[j-15]) ^ (w[j-15] >>> 3);
      const s1 = rotr(17,w[j-2]) ^ rotr(19,w[j-2]) ^ (w[j-2] >>> 10);
      w[j] = (w[j-16] + s0 + w[j-7] + s1) | 0;
    }
    let [a,b,c,d,e,f,g,h] = [h0,h1,h2,h3,h4,h5,h6,h7];
    for (let j = 0; j < 64; j++) {
      const S1 = rotr(6,e) ^ rotr(11,e) ^ rotr(25,e);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[j] + w[j]) | 0;
      const S0 = rotr(2,a) ^ rotr(13,a) ^ rotr(22,a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      [h,g,f,e,d,c,b,a] = [g,f,e,(d+temp1)|0,c,b,a,(temp1+temp2)|0];
    }
    h0=(h0+a)|0; h1=(h1+b)|0; h2=(h2+c)|0; h3=(h3+d)|0;
    h4=(h4+e)|0; h5=(h5+f)|0; h6=(h6+g)|0; h7=(h7+h)|0;
  }

  return [h0,h1,h2,h3,h4,h5,h6,h7]
    .map(n => (n >>> 0).toString(16).padStart(8, '0'))
    .join('');
}

/** Legacy (pre-PBKDF2) scheme — only used to verify and upgrade old accounts. */
async function sha256Hex(text) {
  // Prefer native crypto.subtle (available on HTTPS + localhost)
  if (typeof crypto !== 'undefined' && crypto.subtle?.digest) {
    try {
      const data = new TextEncoder().encode(text);
      const digest = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      // Fall through to pure-JS implementation
    }
  }
  // Pure-JS fallback (no external dependency, works everywhere)
  return sha256Pure(text);
}

// ─── PBKDF2 ───────────────────────────────────────────────────────────────────

const PBKDF2_ITERATIONS = 310_000;

function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function pbkdf2Hex(password, saltBytes, iterations) {
  if (typeof crypto === 'undefined' || !crypto.subtle?.importKey) throw new AuthError(ERRORS.cryptoUnavailable);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations }, key, 256);
  return toHex(new Uint8Array(bits));
}

export async function hashPassword(password, iterations = PBKDF2_ITERATIONS) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return { algo: 'pbkdf2-sha256', iterations, salt: toHex(salt), hash: await pbkdf2Hex(password, salt, iterations) };
}

/** Comparison whose duration doesn't depend on where the strings differ. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Returns { ok, needsUpgrade }. Supports PBKDF2 records and legacy SHA-256 hex strings. */
export async function verifyPassword(password, record) {
  if (record && typeof record === 'object' && record.algo === 'pbkdf2-sha256') {
    const candidate = await pbkdf2Hex(password, fromHex(record.salt), record.iterations);
    return { ok: safeEqual(candidate, record.hash), needsUpgrade: record.iterations < PBKDF2_ITERATIONS };
  }
  if (typeof record === 'string') {
    return { ok: safeEqual(await sha256Hex(password), record), needsUpgrade: true };
  }
  return { ok: false, needsUpgrade: false };
}

// ─── Storage helpers ─────────────────────────────────────────────────────────

function loadLocalUsers() {
  const users = readJSON(STORAGE_KEYS.localUsers, []);
  return Array.isArray(users) ? users : [];
}

function persist(key, value) {
  try {
    writeJSONOrThrow(key, value);
  } catch {
    throw new AuthError(ERRORS.storageFailed);
  }
}

function publicUser(user) {
  const { id, fullName, email, authProvider, createdAt } = user;
  return { id, fullName, email, authProvider, createdAt };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export const authService = {
  /** Device-local accounts: true until a VISHWAS auth server is integrated. */
  isLocalOnly: true,

  restoreSession() {
    const userId = readJSON(STORAGE_KEYS.sessionUserId, null);
    if (!userId) return null;
    const user = loadLocalUsers().find((u) => u.id === userId);
    if (!user) {
      // Session points at a user that no longer exists — clear it.
      remove(STORAGE_KEYS.sessionUserId);
      return null;
    }
    return publicUser(user);
  },

  /**
   * Sign in with Apple needs an Apple Developer team, the capability on the
   * App ID and a native plugin. None are configured, so this refuses
   * instead of creating an unauthenticated placeholder session.
   */
  async signInWithApple() {
    throw new AuthError(ERRORS.appleNotConfigured);
  },

  async signUp({ fullName, email, password }) {
    const name = (fullName ?? '').trim();
    if (!isNonEmpty(name) || name.length > LIMITS.nameMax) throw new AuthError(ERRORS.invalidName);
    if (!isValidEmail(email)) throw new AuthError(ERRORS.invalidEmail);
    if (!isStrongEnoughPassword(password)) throw new AuthError(ERRORS.weakPassword);

    const users = loadLocalUsers();
    const normalizedEmail = normalizeEmail(email);
    if (users.some((u) => normalizeEmail(u.email) === normalizedEmail)) {
      throw new AuthError(ERRORS.emailAlreadyRegistered);
    }

    const newUser = {
      id: generateUUID(),
      fullName: name,
      email: normalizedEmail,
      authProvider: 'email',
      createdAt: new Date().toISOString(),
    };

    const record = await hashPassword(password);
    persist(`${STORAGE_KEYS.passwordPrefix}${newUser.id}`, record);
    persist(STORAGE_KEYS.localUsers, [...users, newUser]);
    persist(STORAGE_KEYS.sessionUserId, newUser.id);
    return publicUser(newUser);
  },

  async signIn({ email, password }) {
    if (!isValidEmail(email)) throw new AuthError(ERRORS.invalidEmail);
    const normalizedEmail = normalizeEmail(email);
    const user = loadLocalUsers().find((u) => normalizeEmail(u.email) === normalizedEmail);
    // Same message for unknown email and wrong password — don't reveal which accounts exist.
    if (!user) throw new AuthError(ERRORS.invalidCredentials);

    const record = readJSON(`${STORAGE_KEYS.passwordPrefix}${user.id}`, null);
    const { ok, needsUpgrade } = await verifyPassword(password ?? '', record);
    if (!ok) throw new AuthError(ERRORS.invalidCredentials);

    if (needsUpgrade) {
      try {
        writeJSONOrThrow(`${STORAGE_KEYS.passwordPrefix}${user.id}`, await hashPassword(password));
      } catch {
        // Upgrade is best effort — the legacy hash still works and is retried next sign-in.
      }
    }

    persist(STORAGE_KEYS.sessionUserId, user.id);
    return publicUser(user);
  },

  /** Requires the VISHWAS server; reports "not configured" honestly otherwise. */
  async sendPasswordReset({ email }) {
    if (!isValidEmail(email)) throw new AuthError(ERRORS.invalidEmail);
    if (!isApiConfigured()) throw new AuthError(ERRORS.resetNotConfigured);
    try {
      await apiPost('/auth/forgot-password', { email: normalizeEmail(email) });
    } catch (err) {
      throw new AuthError(err?.message ?? 'Could not request a password reset.');
    }
  },

  canResetPassword() {
    return isApiConfigured();
  },

  signOut() {
    remove(STORAGE_KEYS.sessionUserId);
  },
};
