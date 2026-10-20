import { describe, it, expect } from 'vitest';
import { authService, verifyPassword } from './authService';
import { STORAGE_KEYS } from '../utils/constants';

const creds = { fullName: '  Priya Sharma ', email: ' Priya@Example.com ', password: 'correct horse 1' };

function allStoredText() {
  return Object.keys(localStorage).map((k) => localStorage.getItem(k)).join('\n');
}

describe('authService (device-local accounts)', () => {
  it('signs up, trims/normalizes input and starts a session', async () => {
    const user = await authService.signUp(creds);
    expect(user).toMatchObject({ fullName: 'Priya Sharma', email: 'priya@example.com', authProvider: 'email' });
    expect(authService.restoreSession()).toMatchObject({ id: user.id });
  });

  it('never stores the plaintext password; stores a salted PBKDF2 record', async () => {
    const user = await authService.signUp(creds);
    expect(allStoredText()).not.toContain(creds.password);
    const record = JSON.parse(localStorage.getItem(`${STORAGE_KEYS.passwordPrefix}${user.id}`));
    expect(record).toMatchObject({ algo: 'pbkdf2-sha256', iterations: 310000 });
    expect(record.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(record.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('two users with the same password get different hashes (salted)', async () => {
    const a = await authService.signUp({ ...creds, email: 'a@x.io' });
    const b = await authService.signUp({ ...creds, email: 'b@x.io' });
    const ra = JSON.parse(localStorage.getItem(`${STORAGE_KEYS.passwordPrefix}${a.id}`));
    const rb = JSON.parse(localStorage.getItem(`${STORAGE_KEYS.passwordPrefix}${b.id}`));
    expect(ra.hash).not.toBe(rb.hash);
  });

  it('rejects invalid sign-up input', async () => {
    await expect(authService.signUp({ ...creds, fullName: '  ' })).rejects.toThrow(/name/);
    await expect(authService.signUp({ ...creds, email: 'nope' })).rejects.toThrow(/valid email/);
    await expect(authService.signUp({ ...creds, password: 'short' })).rejects.toThrow(/8–128/);
  });

  it('rejects a duplicate email regardless of case', async () => {
    await authService.signUp(creds);
    await expect(authService.signUp({ ...creds, email: 'PRIYA@example.com' })).rejects.toThrow(/already exists/);
  });

  it('signs in with the right password and rejects a wrong one with a generic message', async () => {
    await authService.signUp(creds);
    authService.signOut();
    expect(authService.restoreSession()).toBeNull();
    await expect(authService.signIn({ email: creds.email, password: 'wrong password' })).rejects.toThrow('Incorrect email or password.');
    await expect(authService.signIn({ email: 'nobody@x.io', password: 'whatever1' })).rejects.toThrow('Incorrect email or password.');
    const user = await authService.signIn({ email: 'PRIYA@example.com', password: creds.password });
    expect(authService.restoreSession().id).toBe(user.id);
  });

  it('upgrades a legacy unsalted SHA-256 hash to PBKDF2 on sign-in', async () => {
    const legacyHash = 'a'.repeat(64);
    const enc = new TextEncoder().encode('legacypass1');
    const digest = await crypto.subtle.digest('SHA-256', enc);
    const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(STORAGE_KEYS.localUsers, JSON.stringify([{ id: 'old', fullName: 'Old', email: 'old@x.io', authProvider: 'email', createdAt: 'x' }]));
    localStorage.setItem(`${STORAGE_KEYS.passwordPrefix}old`, JSON.stringify(hex));
    expect(hex).not.toBe(legacyHash);

    await authService.signIn({ email: 'old@x.io', password: 'legacypass1' });
    const upgraded = JSON.parse(localStorage.getItem(`${STORAGE_KEYS.passwordPrefix}old`));
    expect(upgraded.algo).toBe('pbkdf2-sha256');
    expect((await verifyPassword('legacypass1', upgraded)).ok).toBe(true);
  });

  it('restoreSession clears a session pointing at a missing user', () => {
    localStorage.setItem(STORAGE_KEYS.sessionUserId, JSON.stringify('ghost'));
    expect(authService.restoreSession()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.sessionUserId)).toBeNull();
  });

  it('password reset reports that the server is not configured instead of pretending to email', async () => {
    await expect(authService.sendPasswordReset({ email: 'priya@example.com' })).rejects.toThrow(/needs the VISHWAS server/);
  });

  it('Sign in with Apple refuses instead of creating a placeholder session', async () => {
    await expect(authService.signInWithApple()).rejects.toThrow(/not configured/);
    expect(authService.restoreSession()).toBeNull();
  });
});
