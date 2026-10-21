import AsyncStorage from '@react-native-async-storage/async-storage';
import { initStorage, readJSON, __resetStorageCache } from '../utils/storage';
import { createAuthService, verifyPassword, hashPassword } from '../services/authService';
import { contactsService, ContactValidationError } from '../services/contactsService';
import { STORAGE_KEYS, PRIORITY } from '../utils/constants';
import { isValidEmail, isStrongEnoughPassword, normalizePhone, validatePhone } from '../utils/validation';
const SecureStore = jest.requireMock('expo-secure-store');

// Fewer PBKDF2 iterations keep tests fast; verify uses the stored count.
const auth = createAuthService({ hashIterations: 1000 });
const creds = { fullName: '  Priya Sharma ', email: ' Priya@Example.com ', password: 'correct horse 1' };

beforeEach(async () => {
  await AsyncStorage.clear();
  SecureStore.__store.clear();
  __resetStorageCache();
  await initStorage();
});

describe('authService (device-local accounts)', () => {
  it('signs up with normalized input and starts a session in SecureStore', async () => {
    const user = await auth.signUp(creds);
    expect(user).toMatchObject({ fullName: 'Priya Sharma', email: 'priya@example.com' });
    expect(JSON.parse(SecureStore.__store.get(STORAGE_KEYS.sessionUserId))).toBe(user.id);
    expect((await auth.restoreSession()).id).toBe(user.id);
  });

  it('never stores the password; keeps a salted PBKDF2 record only in SecureStore', async () => {
    const user = await auth.signUp(creds);
    const asyncValues = (await AsyncStorage.multiGet(await AsyncStorage.getAllKeys())).map(([, v]) => v).join('\n');
    const secureValues = [...SecureStore.__store.values()].join('\n');
    expect(asyncValues).not.toContain(creds.password);
    expect(secureValues).not.toContain(creds.password);
    expect(asyncValues).not.toContain('pbkdf2');
    const record = JSON.parse(SecureStore.__store.get(`${STORAGE_KEYS.passwordPrefix}${user.id}`));
    expect(record).toMatchObject({ algo: 'pbkdf2-sha256', iterations: 1000 });
    expect(record.salt).toMatch(/^[0-9a-f]{32}$/);
  });

  it('salts: same password gives different hashes', async () => {
    const a = await hashPassword('same password', 1000);
    const b = await hashPassword('same password', 1000);
    expect(a.hash).not.toBe(b.hash);
    expect(await verifyPassword('same password', a)).toBe(true);
    expect(await verifyPassword('other password', a)).toBe(false);
  });

  it('rejects invalid sign-up input and duplicate emails', async () => {
    await expect(auth.signUp({ ...creds, fullName: ' ' })).rejects.toThrow(/name/);
    await expect(auth.signUp({ ...creds, email: 'nope' })).rejects.toThrow(/valid email/);
    await expect(auth.signUp({ ...creds, password: 'short' })).rejects.toThrow(/8–128/);
    await auth.signUp(creds);
    await expect(auth.signUp({ ...creds, email: 'PRIYA@example.com' })).rejects.toThrow(/already exists/);
  });

  it('signs in, rejects wrong credentials generically, and signs out', async () => {
    await auth.signUp(creds);
    await auth.signOut();
    expect(await auth.restoreSession()).toBeNull();
    await expect(auth.signIn({ email: creds.email, password: 'wrong password' })).rejects.toThrow('Incorrect email or password.');
    await expect(auth.signIn({ email: 'nobody@x.io', password: 'whatever1' })).rejects.toThrow('Incorrect email or password.');
    const user = await auth.signIn({ email: 'PRIYA@example.com', password: creds.password });
    expect((await auth.restoreSession()).id).toBe(user.id);
  });

  it('session restore survives an app restart (storage reloaded from disk)', async () => {
    const user = await auth.signUp(creds);
    __resetStorageCache();
    await initStorage();
    expect((await auth.restoreSession()).id).toBe(user.id);
  });

  it('password reset is honest that the server is not configured', async () => {
    await expect(auth.sendPasswordReset({ email: 'priya@example.com' })).rejects.toThrow(/needs the VISHWAS server/);
  });
});

describe('contactsService', () => {
  it('adds with a normalized phone and persists to disk', async () => {
    const c = await contactsService.add({ name: ' Asha ', phoneNumber: '+91 98765-43210', relationship: 'Sister', priority: PRIORITY.primary });
    expect(c).toMatchObject({ name: 'Asha', phoneNumber: '+919876543210', isFavorite: false });
    __resetStorageCache();
    await initStorage();
    expect(readJSON(STORAGE_KEYS.contacts, [])).toHaveLength(1);
  });

  it('validates names and phone numbers, and rejects duplicates', async () => {
    await expect(contactsService.add({ name: '', phoneNumber: '9876543210' })).rejects.toThrow(ContactValidationError);
    await expect(contactsService.add({ name: 'A', phoneNumber: '12345' })).rejects.toThrow(/too short/);
    await expect(contactsService.add({ name: 'A', phoneNumber: '98765abc10' })).rejects.toThrow(/only contain/);
    await contactsService.add({ name: 'Asha', phoneNumber: '+91 98765 43210' });
    await expect(contactsService.add({ name: 'B', phoneNumber: '+919876543210' })).rejects.toThrow(/already have a contact/);
  });

  it('edits, favorites, sorts and deletes', async () => {
    const a = await contactsService.add({ name: 'Zed', phoneNumber: '9000000001', priority: PRIORITY.backup });
    await contactsService.add({ name: 'Al', phoneNumber: '9000000002', priority: PRIORITY.primary });
    expect(contactsService.getAll().map((c) => c.name)).toEqual(['Al', 'Zed']);
    expect((await contactsService.update(a.id, { relationship: 'Friend' })).relationship).toBe('Friend');
    expect((await contactsService.toggleFavorite(a.id)).isFavorite).toBe(true);
    await contactsService.remove(a.id);
    expect(contactsService.getAll().map((c) => c.name)).toEqual(['Al']);
  });

  it('surfaces a storage failure instead of losing the contact silently', async () => {
    const spy = jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    await expect(contactsService.add({ name: 'A', phoneNumber: '9876543210' })).rejects.toThrow(/Could not save/);
    expect(contactsService.getAll()).toEqual([]);
    spy.mockRestore();
  });
});

describe('validation', () => {
  it('emails, passwords and phone numbers', () => {
    expect(isValidEmail(' a@b.co ')).toBe(true);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isStrongEnoughPassword('12345678')).toBe(true);
    expect(isStrongEnoughPassword('x'.repeat(129))).toBe(false);
    expect(normalizePhone(' +1 (555) 010-9999 ')).toBe('+15550109999');
    expect(validatePhone('112')).toMatch(/too short/);
    expect(validatePhone('+1 (555) 010-9999')).toBeNull();
  });
});
