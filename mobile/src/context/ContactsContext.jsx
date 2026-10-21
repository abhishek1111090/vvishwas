import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { contactsService } from '../services/contactsService';

// ContactsContext — one shared contacts array so every screen re-renders on
// any change (the React equivalent of SwiftData's @Query). Mutations return
// { ok: true, contact } or { ok: false, error, field } so forms can show the
// real reason a save failed.

const ContactsContext = createContext(null);

export function ContactsProvider({ children }) {
  const [contacts, setContacts] = useState(() => contactsService.getAll());
  const [error, setError] = useState(null);

  const mutate = useCallback(async (fn) => {
    try {
      const contact = await fn();
      setContacts(contactsService.getAll());
      setError(null);
      return { ok: true, contact };
    } catch (err) {
      const message = err?.message ?? 'Could not save contact.';
      setError(message);
      return { ok: false, error: message, field: err?.field ?? null };
    }
  }, []);

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
