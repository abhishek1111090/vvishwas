import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { contactsService } from '../services/contactsService';

// ContactsContext.jsx
// ---------------------
// CONVERSION NOTE (SwiftUI -> React): ContactsListView.swift used
// `@Query(sort: ...)` against SwiftData, which re-runs and re-renders
// automatically any time the underlying store changes — including from
// AddEditContactView, a totally different view, via the shared
// `modelContext`. React has no automatic equivalent for "a write from
// anywhere updates every reader," so this Context exists specifically to
// recreate that: every mutation (add/update/remove/toggleFavorite) updates
// one shared `contacts` array here, and every component that calls
// `useContacts()` re-renders together, the same way every `@Query` did.

const ContactsContext = createContext(null);

export function ContactsProvider({ children }) {
  const [contacts, setContacts] = useState(() => contactsService.getAll());

  const refresh = useCallback(() => setContacts(contactsService.getAll()), []);

  const addContact = useCallback((data) => {
    contactsService.add(data);
    refresh();
  }, [refresh]);

  const updateContact = useCallback((id, patch) => {
    contactsService.update(id, patch);
    refresh();
  }, [refresh]);

  const removeContact = useCallback((id) => {
    contactsService.remove(id);
    refresh();
  }, [refresh]);

  const toggleFavorite = useCallback((id) => {
    contactsService.toggleFavorite(id);
    refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ contacts, addContact, updateContact, removeContact, toggleFavorite }),
    [contacts, addContact, updateContact, removeContact, toggleFavorite]
  );

  return <ContactsContext.Provider value={value}>{children}</ContactsContext.Provider>;
}

export function useContacts() {
  const ctx = useContext(ContactsContext);
  if (!ctx) throw new Error('useContacts must be used within a ContactsProvider');
  return ctx;
}
