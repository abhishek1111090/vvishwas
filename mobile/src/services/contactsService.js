import { readJSON, writeJSONOrThrow } from '../utils/storage';
import { STORAGE_KEYS, PRIORITY } from '../utils/constants';
import { generateUUID } from '../utils/uuid';
import { isNonEmpty, normalizePhone, validatePhone, LIMITS } from '../utils/validation';

// contactsService.js
// ------------------
// CONVERSION NOTE (SwiftUI -> React): PersistenceController.swift set up a
// SwiftData `ModelContainer` for the `EmergencyContact` `@Model` class, and
// ContactsListView.swift queried it reactively with `@Query`. This module
// re-implements the same CRUD surface (`getAll`, `add`, `update`, `remove`,
// `toggleFavorite`) against local storage; ContactsContext rebuilds the
// "every reader re-renders" behaviour.
//
// Every write validates first and throws ContactValidationError (bad input)
// or StorageError (device storage full/unavailable) instead of silently
// pretending the contact was saved.
//
// `profileImageDataUrl` is a small base64 JPEG data URL (the picker
// downscales to 256px), capped at MAX_PHOTO_CHARS so a large photo can't
// exhaust storage. Writes are async on mobile, so mutations return promises.

export const MAX_PHOTO_CHARS = 700_000; // ≈ 500 KB image
const VALID_PRIORITIES = new Set(Object.values(PRIORITY));

export class ContactValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ContactValidationError';
    this.field = field;
  }
}

function loadAll() {
  const contacts = readJSON(STORAGE_KEYS.contacts, []);
  return Array.isArray(contacts) ? contacts : [];
}

function saveAll(contacts) {
  return writeJSONOrThrow(STORAGE_KEYS.contacts, contacts);
}

/** Mirrors `SortDescriptor(\.priority), SortDescriptor(\.name)` in ContactsListView.swift. */
function sortContacts(contacts) {
  return [...contacts].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
}

/**
 * Validate + normalize contact fields. Returns the clean object or throws.
 * `existing` is used for the duplicate-number check; `selfId` is excluded.
 */
export function validateContact(data, existing = [], selfId = null) {
  const name = (data.name ?? '').trim();
  if (!isNonEmpty(name)) throw new ContactValidationError('Please enter a name.', 'name');
  if (name.length > LIMITS.nameMax) throw new ContactValidationError(`Name must be at most ${LIMITS.nameMax} characters.`, 'name');

  const phoneError = validatePhone(data.phoneNumber);
  if (phoneError) throw new ContactValidationError(phoneError, 'phoneNumber');
  const phoneNumber = normalizePhone(data.phoneNumber);
  if (existing.some((c) => c.id !== selfId && normalizePhone(c.phoneNumber) === phoneNumber)) {
    throw new ContactValidationError('You already have a contact with this phone number.', 'phoneNumber');
  }

  const relationship = (data.relationship ?? '').trim();
  if (relationship.length > LIMITS.relationshipMax) {
    throw new ContactValidationError(`Relationship must be at most ${LIMITS.relationshipMax} characters.`, 'relationship');
  }

  const priority = VALID_PRIORITIES.has(data.priority) ? data.priority : PRIORITY.secondary;

  const photo = data.profileImageDataUrl ?? null;
  if (photo !== null) {
    if (typeof photo !== 'string' || !photo.startsWith('data:image/')) {
      throw new ContactValidationError('Unsupported photo format.', 'photo');
    }
    if (photo.length > MAX_PHOTO_CHARS) {
      throw new ContactValidationError('That photo is too large. Choose a smaller image.', 'photo');
    }
  }

  return { name, phoneNumber, relationship, priority, isFavorite: !!data.isFavorite, profileImageDataUrl: photo };
}

export const contactsService = {
  getAll() {
    return sortContacts(loadAll());
  },

  async add(data) {
    const all = loadAll();
    const clean = validateContact(data, all);
    const newContact = { id: generateUUID(), ...clean, createdAt: new Date().toISOString() };
    await saveAll([...all, newContact]);
    return newContact;
  },

  async update(id, patch) {
    const all = loadAll();
    const current = all.find((c) => c.id === id);
    if (!current) throw new ContactValidationError('This contact no longer exists.', 'id');
    const clean = validateContact({ ...current, ...patch }, all, id);
    const updated = { ...current, ...clean, updatedAt: new Date().toISOString() };
    await saveAll(all.map((c) => (c.id === id ? updated : c)));
    return updated;
  },

  async remove(id) {
    await saveAll(loadAll().filter((c) => c.id !== id));
  },

  /** Put back contacts from the server backup (new phone). Invalid entries are skipped. */
  async restore(list) {
    const kept = [];
    for (const c of Array.isArray(list) ? list : []) {
      try {
        kept.push({ ...c, ...validateContact(c, kept, null), id: c.id || generateUUID(), createdAt: c.createdAt ?? new Date().toISOString() });
      } catch {
        // skip a contact that no longer validates
      }
    }
    await saveAll(kept);
    return kept.length;
  },

  async toggleFavorite(id) {
    const all = loadAll();
    const updated = all.map((c) => (c.id === id ? { ...c, isFavorite: !c.isFavorite } : c));
    await saveAll(updated);
    return updated.find((c) => c.id === id) ?? null;
  },
};
