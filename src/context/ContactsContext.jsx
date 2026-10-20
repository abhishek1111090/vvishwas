import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { contactsService } from '../services/contactsService';

// ContactsContext.jsx
// ---------------------
// CONVERSION NOTE (SwiftUI -> React): ContactsListView.swift used
// `@Query(sort: ...)` against SwiftData, which re-renders automatically any
// time the store changes. This Context recreates that: every mutation
// updates one shared `contacts` array and every `useContacts()` reader
// re-renders together.
//
// Mutations return { ok: true, contact } or { ok: false, error, field } so
// forms can show the real reason a save failed (validation, storage full).

const ContactsContext = createContext(null);

function run(fn) {
  try {
    return { ok: true, contact: fn() };
  } catch (err) {
    return { ok: false, error: err?.message ?? 'Could not save contact.', field: err?.field ?? null };
  }
}

export function ContactsProvider({ children }) {
  const [contacts, setContacts] = useState(() => contactsService.getAll());
  const [error, setError] = useState(null);

  const refresh = useCallback(() => setContacts(contactsService.getAll()), []);

  const mutate = useCallback((fn) => {
    const result = run(fn);
    if (result.ok) {
      setError(null);
      refresh();
    } else {
      setError(result.error);
    }
    return result;
  }, [refresh]);

  const addContact = useCallback((data) => mutate(() => contactsService.add(data)), [mutate]);
  const updateContact = useCallback((id, patch) => mutate(() => contactsService.update(id, patch)), [mutate]);
  const removeContact = useCallback((id) => mutate(() => contactsService.remove(id)), [mutate]);
  const toggleFavorite = useCallback((id) => mutate(() => contactsService.toggleFavorite(id)), [mutate]);
  const clearError = useCallback(() => setError(null), []);

  const value = useMemo(
    () => ({ contacts, error, clearError, addContact, updateContact, removeContact, toggleFavorite }),
    [contacts, error, clearError, addContact, updateContact, removeContact, toggleFavorite]
  );

  return <ContactsContext.Provider value={value}>{children}</ContactsContext.Provider>;
}

export function useContacts() {
  const ctx = useContext(ContactsContext);
  if (!ctx) throw new Error('useContacts must be used within a ContactsProvider');
  return ctx;
}
