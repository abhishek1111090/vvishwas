import { readJSON, writeJSON } from '../utils/storage';
import { STORAGE_KEYS, PRIORITY } from '../utils/constants';

// contactsService.js
// ------------------
// CONVERSION NOTE (SwiftUI -> React): PersistenceController.swift set up a
// SwiftData `ModelContainer` for the `EmergencyContact` `@Model` class, and
// ContactsListView.swift queried it reactively with `@Query`. There's no
// direct browser equivalent of SwiftData, so this module re-implements the
// same CRUD surface (`getAll`, `add`, `update`, `remove`, `toggleFavorite`)
// directly against localStorage. It does NOT give us SwiftData's automatic
// "every view using @Query re-renders when data changes" behavior — that
// part is rebuilt explicitly in ContactsContext (see context/ContactsContext.jsx),
// which is the React-idiomatic way to get the same reactivity.
//
// One real fidelity note: EmergencyContact.swift stored `profileImageData`
// as raw `Data` (JPEG bytes). We store it as a base64 data URL string
// instead — JSON (and therefore localStorage) can't hold raw bytes — which
// is the standard web equivalent and renders directly in an <img src>.

function loadAll() {
  return readJSON(STORAGE_KEYS.contacts, []);
}

function saveAll(contacts) {
  writeJSON(STORAGE_KEYS.contacts, contacts);
}

/** Mirrors `SortDescriptor(\.priority), SortDescriptor(\.name)` in ContactsListView.swift. */
function sortContacts(contacts) {
  return [...contacts].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
}

export const contactsService = {
  getAll() {
    return sortContacts(loadAll());
  },

  add({ name, phoneNumber, relationship = '', priority = PRIORITY.secondary, isFavorite = false, profileImageDataUrl = null }) {
    const newContact = {
      id: crypto.randomUUID(),
      name,
      phoneNumber,
      relationship,
      priority,
      isFavorite,
      profileImageDataUrl,
      createdAt: new Date().toISOString(),
    };
    saveAll([...loadAll(), newContact]);
    return newContact;
  },

  update(id, patch) {
    const updated = loadAll().map((c) => (c.id === id ? { ...c, ...patch } : c));
    saveAll(updated);
    return updated.find((c) => c.id === id) ?? null;
  },

  remove(id) {
    saveAll(loadAll().filter((c) => c.id !== id));
  },

  toggleFavorite(id) {
    const contacts = loadAll();
    const updated = contacts.map((c) => (c.id === id ? { ...c, isFavorite: !c.isFavorite } : c));
    saveAll(updated);
    return updated.find((c) => c.id === id) ?? null;
  },
};
