import { describe, it, expect, vi } from 'vitest';
import { contactsService, ContactValidationError } from './contactsService';
import { STORAGE_KEYS, PRIORITY } from '../utils/constants';

describe('contactsService', () => {
  it('adds a contact with normalized phone and persists it', () => {
    const c = contactsService.add({ name: ' Asha ', phoneNumber: '+91 98765-43210', relationship: 'Sister', priority: PRIORITY.primary });
    expect(c).toMatchObject({ name: 'Asha', phoneNumber: '+919876543210', relationship: 'Sister', priority: 0, isFavorite: false });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.contacts))).toHaveLength(1);
    expect(contactsService.getAll()[0].id).toBe(c.id);
  });

  it('sorts by priority then name', () => {
    contactsService.add({ name: 'Zed', phoneNumber: '9000000001', priority: PRIORITY.backup });
    contactsService.add({ name: 'Bea', phoneNumber: '9000000002', priority: PRIORITY.primary });
    contactsService.add({ name: 'Al', phoneNumber: '9000000003', priority: PRIORITY.primary });
    expect(contactsService.getAll().map((c) => c.name)).toEqual(['Al', 'Bea', 'Zed']);
  });

  it('validates name and phone number', () => {
    expect(() => contactsService.add({ name: '', phoneNumber: '9876543210' })).toThrow(ContactValidationError);
    expect(() => contactsService.add({ name: 'A', phoneNumber: '12345' })).toThrow(/too short/);
    expect(() => contactsService.add({ name: 'A', phoneNumber: '98765abc10' })).toThrow(/only contain/);
    expect(() => contactsService.add({ name: 'A', phoneNumber: '1234567890123456' })).toThrow(/too long/);
    expect(() => contactsService.add({ name: 'A', phoneNumber: '98+76543210' })).toThrow(/start/);
  });

  it('rejects duplicate phone numbers (after normalization)', () => {
    contactsService.add({ name: 'Asha', phoneNumber: '+91 98765 43210' });
    expect(() => contactsService.add({ name: 'Other', phoneNumber: '+919876543210' })).toThrow(/already have a contact/);
  });

  it('edits a contact and keeps its id', () => {
    const c = contactsService.add({ name: 'Asha', phoneNumber: '9876543210' });
    const updated = contactsService.update(c.id, { name: 'Asha K', relationship: 'Friend' });
    expect(updated).toMatchObject({ id: c.id, name: 'Asha K', relationship: 'Friend' });
    expect(contactsService.getAll()[0].name).toBe('Asha K');
  });

  it('allows editing a contact without tripping its own duplicate check', () => {
    const c = contactsService.add({ name: 'Asha', phoneNumber: '9876543210' });
    expect(() => contactsService.update(c.id, { phoneNumber: '98765 43210' })).not.toThrow();
  });

  it('deletes a contact', () => {
    const c = contactsService.add({ name: 'Asha', phoneNumber: '9876543210' });
    contactsService.remove(c.id);
    expect(contactsService.getAll()).toEqual([]);
  });

  it('toggles favorite', () => {
    const c = contactsService.add({ name: 'Asha', phoneNumber: '9876543210' });
    expect(contactsService.toggleFavorite(c.id).isFavorite).toBe(true);
    expect(contactsService.toggleFavorite(c.id).isFavorite).toBe(false);
  });

  it('rejects oversized or non-image photos', () => {
    expect(() => contactsService.add({ name: 'A', phoneNumber: '9876543210', profileImageDataUrl: 'javascript:alert(1)' })).toThrow(/format/);
    const huge = `data:image/jpeg;base64,${'A'.repeat(800_000)}`;
    expect(() => contactsService.add({ name: 'A', phoneNumber: '9876543210', profileImageDataUrl: huge })).toThrow(/too large/);
  });

  it('surfaces a storage failure instead of silently losing the contact', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    });
    expect(() => contactsService.add({ name: 'A', phoneNumber: '9876543210' })).toThrow(/storage is full/);
    spy.mockRestore();
  });
});
