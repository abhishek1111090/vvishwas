/**
 * authService.js — accounts
 *
 * Two modes, chosen by whether the VISHWAS server is configured
 * (EXPO_PUBLIC_VISHWAS_API_URL):
 *  • SERVER accounts (configured): sign up / in against /auth/register and
 *    /auth/login. The server stores only a scrypt hash; the app keeps the
 *    session token in SecureStore. A saved session is reused offline, so
 *    SOS never depends on reaching the server.
 *  • DEVICE-LOCAL accounts (not configured, or an account created before the
 *    server existed): exist only on this phone, as before.
 *
 * Storage:
 *  • user profiles (name, email)      → AsyncStorage (not secret)
 *  • password records + session id    → SecureStore (iOS Keychain /
 *                                        Android Keystore encryption)
 * Passwords are never stored or logged. Records are PBKDF2-HMAC-SHA256
 * (100,000 iterations, 16-byte random salt per user) computed with
 * @noble/hashes' async PBKDF2 so the UI stays responsive.
 */

import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import * as Crypto from 'expo-crypto';
import { readJSON, writeJSONOrThrow } from '../utils/storage';
import { secureGetJSON, secureSetJSON, secureRemove } from '../utils/secureStorage';
import { STORAGE_KEYS } from '../utils/constants';
import { isStrongEnoughPassword, isValidEmail, isNonEmpty, normalizeEmail, LIMITS } from '../utils/validation';
import { generateUUID } from '../utils/uuid';
import { apiPost, apiGet, isApiConfigured, setAuthToken } from './apiClient';

export class AuthError extends Error {}

const ERRORS = {
  invalidCredentials: 'Incorrect email or password.',
  emailAlreadyRegistered: 'An account with this email already exists on this phone.',
  weakPassword: 'Password must be 8–128 characters.',
  invalidEmail: 'Please enter a valid email address.',
  invalidName: 'Please enter your name.',
  storageFailed: 'Could not save your account on this phone. Check free storage and try again.',
  resetNotConfigured:
    'Password reset by email needs the VISHWAS server, which is not set up in this build. Accounts are stored only on this phone — if you forgot your password, create a new account.',
};

export const PBKDF2_ITERATIONS = 100_000;

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function derive(password, salt, iterations) {
  const key = await pbkdf2Async(sha256, new TextEncoder().encode(password), salt, { c: iterations, dkLen: 32 });
  return toHex(key);
}

export async function hashPassword(password, iterations = PBKDF2_ITERATIONS, randomBytes = Crypto.getRandomBytes) {
  const salt = randomBytes(16);
  return { algo: 'pbkdf2-sha256', iterations, salt: toHex(salt), hash: await derive(password, salt, iterations) };
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPassword(password, record) {
  if (!record || record.algo !== 'pbkdf2-sha256') return false;
  return safeEqual(await derive(password, fromHex(record.salt), record.iterations), record.hash);
}

function loadUsers() {
  const users = readJSON(STORAGE_KEYS.localUsers, []);
  return Array.isArray(users) ? users : [];
}

function publicUser(user) {
  const { id, fullName, email, authProvider, createdAt } = user;
  return { id, fullName, email, authProvider, createdAt };
}

/** Server error → message for the person (never raw technical text). */
function serverAuthError(err, fallback) {
  if (err?.code === 'NETWORK' || err?.code === 'TIMEOUT') return new AuthError('Can’t reach the VISHWAS server. Check your internet connection and try again.');
  if (err?.status === 429) return new AuthError('Too many attempts. Wait a few minutes and try again.');
  if (err?.status >= 500) return new AuthError('The VISHWAS server is having a problem. Try again shortly.');
  return new AuthError(err?.message || fallback);
}

const pwKey = (id) => `${STORAGE_KEYS.passwordPrefix}${id}`;

export function createAuthService({ hashIterations = PBKDF2_ITERATIONS, serverMode = isApiConfigured } = {}) {
  async function saveServerSession({ token, user }) {
    const session = { token, user: { ...user, authProvider: 'server' } };
    await secureSetJSON(STORAGE_KEYS.serverSession, session);
    setAuthToken(token);
    return session.user;
  }

  async function restoreServerSession() {
    const saved = await secureGetJSON(STORAGE_KEYS.serverSession, null);
    if (!saved?.token || !saved.user) return null;
    setAuthToken(saved.token);
    try {
      const { user } = await apiGet('/auth/me', { timeoutMs: 5000 });
      const fresh = { ...user, authProvider: 'server' };
      await secureSetJSON(STORAGE_KEYS.serverSession, { token: saved.token, user: fresh });
      return fresh;
    } catch (err) {
      if (err?.status === 401) {
        // Expired or signed out elsewhere: ask to sign in again.
        setAuthToken(null);
        await secureRemove(STORAGE_KEYS.serverSession);
        return null;
      }
      // Offline / server down: keep the person signed in (SOS must keep working).
      return saved.user;
    }
  }

  return {
    get isLocalOnly() {
      return !serverMode();
    },

    async restoreSession() {
      if (serverMode()) {
        const user = await restoreServerSession();
        if (user) return user;
      }
      const userId = await secureGetJSON(STORAGE_KEYS.sessionUserId, null);
      if (!userId) return null;
      const user = loadUsers().find((u) => u.id === userId);
      if (!user) {
        await secureRemove(STORAGE_KEYS.sessionUserId);
        return null;
      }
      return publicUser(user);
    },

    async signUp({ fullName, email, password }) {
      const name = (fullName ?? '').trim();
      if (!isNonEmpty(name) || name.length > LIMITS.nameMax) throw new AuthError(ERRORS.invalidName);
      if (!isValidEmail(email)) throw new AuthError(ERRORS.invalidEmail);
      if (!isStrongEnoughPassword(password)) throw new AuthError(ERRORS.weakPassword);

      if (serverMode()) {
        let res;
        try {
          res = await apiPost('/auth/register', { fullName: name, email: normalizeEmail(email), password });
        } catch (err) {
          throw serverAuthError(err, 'Could not create your account.');
        }
        try {
          return await saveServerSession(res);
        } catch {
          throw new AuthError(ERRORS.storageFailed);
        }
      }

      const users = loadUsers();
      const normalized = normalizeEmail(email);
      if (users.some((u) => normalizeEmail(u.email) === normalized)) throw new AuthError(ERRORS.emailAlreadyRegistered);

      const user = { id: generateUUID(), fullName: name, email: normalized, authProvider: 'email', createdAt: new Date().toISOString() };
      const record = await hashPassword(password, hashIterations);
      try {
        await secureSetJSON(pwKey(user.id), record);
        await writeJSONOrThrow(STORAGE_KEYS.localUsers, [...users, user]);
        await secureSetJSON(STORAGE_KEYS.sessionUserId, user.id);
      } catch {
        await secureRemove(pwKey(user.id));
        throw new AuthError(ERRORS.storageFailed);
      }
      return publicUser(user);
    },

    async signIn({ email, password }) {
      if (!isValidEmail(email)) throw new AuthError(ERRORS.invalidEmail);
      const normalized = normalizeEmail(email);

      if (serverMode()) {
        let res;
        try {
          res = await apiPost('/auth/login', { email: normalized, password: password ?? '' });
        } catch (err) {
          // An account made on this phone before the server existed still signs in locally.
          if (err?.status === 401 && loadUsers().some((u) => normalizeEmail(u.email) === normalized)) {
            return this.signInLocal({ email: normalized, password });
          }
          throw serverAuthError(err, ERRORS.invalidCredentials);
        }
        try {
          return await saveServerSession(res);
        } catch {
          throw new AuthError(ERRORS.storageFailed);
        }
      }
      return this.signInLocal({ email: normalized, password });
    },

    async signInLocal({ email, password }) {
      const normalized = normalizeEmail(email);
      const user = loadUsers().find((u) => normalizeEmail(u.email) === normalized);
      // Same message for unknown email and wrong password.
      if (!user) throw new AuthError(ERRORS.invalidCredentials);
      const record = await secureGetJSON(pwKey(user.id), null);
      if (!(await verifyPassword(password ?? '', record))) throw new AuthError(ERRORS.invalidCredentials);
      try {
        await secureSetJSON(STORAGE_KEYS.sessionUserId, user.id);
      } catch {
        throw new AuthError(ERRORS.storageFailed);
      }
      return publicUser(user);
    },

    async sendPasswordReset({ email }) {
      if (!isValidEmail(email)) throw new AuthError(ERRORS.invalidEmail);
      if (!serverMode()) throw new AuthError(ERRORS.resetNotConfigured);
      try {
        await apiPost('/auth/forgot-password', { email: normalizeEmail(email) });
      } catch (err) {
        throw serverAuthError(err, 'Could not request a password reset.');
      }
    },

    canResetPassword: () => serverMode(),

    async signOut() {
      const saved = await secureGetJSON(STORAGE_KEYS.serverSession, null);
      if (saved?.token) {
        // Best effort: end the session on the server too; signing out on the phone never waits on it.
        apiPost('/auth/logout', {}, { timeoutMs: 5000 }).catch(() => {});
      }
      setAuthToken(null);
      await secureRemove(STORAGE_KEYS.serverSession);
      await secureRemove(STORAGE_KEYS.sessionUserId);
    },
  };
}

export const authService = createAuthService();
