/**
 * authService.js — on-device accounts
 *
 * VISHWAS has no authentication server yet, so accounts are DEVICE-LOCAL:
 * an account created on one phone exists only on that phone (the UI says
 * so). The functions keep the signatures a server-backed version would
 * have, so wiring in a real API later doesn't touch the UI.
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
import { apiPost, isApiConfigured } from './apiClient';

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

const pwKey = (id) => `${STORAGE_KEYS.passwordPrefix}${id}`;

export function createAuthService({ hashIterations = PBKDF2_ITERATIONS } = {}) {
  return {
    isLocalOnly: true,

    async restoreSession() {
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
      if (!isApiConfigured()) throw new AuthError(ERRORS.resetNotConfigured);
      try {
        await apiPost('/auth/forgot-password', { email: normalizeEmail(email) });
      } catch (err) {
        throw new AuthError(err?.message ?? 'Could not request a password reset.');
      }
    },

    canResetPassword: () => isApiConfigured(),

    async signOut() {
      await secureRemove(STORAGE_KEYS.sessionUserId);
    },
  };
}

export const authService = createAuthService();
