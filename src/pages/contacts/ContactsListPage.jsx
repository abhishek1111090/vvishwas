import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Plus, UsersRound } from 'lucide-react';
import { useContacts } from '../../context/ContactsContext';
import { ContactRow } from './ContactRow';
import { AddEditContactModal } from './AddEditContactModal';
import { ImportContactsModal } from './ImportContactsModal';
import { PrimaryButton } from '../../design-system/components/Button';
import { VFont } from '../../design-system/theme';
import './contacts.css';

// ContactsListPage.jsx
// ----------------------
// CONVERSION NOTE: mirrors ContactsListView.swift. `@Query` + automatic
// re-render becomes `useContacts()`; the favorites/non-favorites `Section`
// split, the empty state, and the "+" `Menu` (Add Manually / Import) are
// all reproduced 1:1. `NavigationStack`'s back button is now a real
// `<ChevronLeft>` button calling `navigate(-1)` since Contacts is its own
// route here (`/contacts`) rather than a pushed NavigationLink destination.

export function ContactsListPage() {
  const { contacts, removeContact, toggleFavorite, addContact } = useContacts();
  const navigate = useNavigate();

  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showAddContact, setShowAddContact] = useState(false);
  const [showImporter, setShowImporter] = useState(false);
  const [contactToEdit, setContactToEdit] = useState(null);

  const favorites = contacts.filter((c) => c.isFavorite);
  const nonFavorites = contacts.filter((c) => !c.isFavorite);

  function handleImport({ name, phoneNumber }) {
    addContact({ name, phoneNumber, relationship: '' });
  }

  return (
    <div className="v-contacts-page">
      <header className="v-contacts-page__topbar">
        <button type="button" className="v-home__icon-btn" onClick={() => navigate(-1)} aria-label="Back">
          <ChevronLeft size={20} strokeWidth={2.25} />
        </button>
        <h1 className={['v-home__title', VFont.headline].join(' ')}>Emergency Contacts</h1>
        <div className="v-home__menu-wrap">
          <button
            type="button"
            className="v-home__icon-btn"
            aria-label="Add contact"
            onClick={() => setShowAddMenu((v) => !v)}
          >
            <Plus size={20} strokeWidth={2.25} />
          </button>
          {showAddMenu && (
            <div className="v-home__menu">
              <button
                type="button"
                className="v-home__menu-item v-home__menu-item--neutral"
                onClick={() => {
                  setShowAddMenu(false);
                  setShowAddContact(true);
                }}
              >
                Add Manually
              </button>
              <button
                type="button"
                className="v-home__menu-item v-home__menu-item--neutral"
                onClick={() => {
                  setShowAddMenu(false);
                  setShowImporter(true);
                }}
              >
                Import from Contacts
              </button>
            </div>
          )}
        </div>
      </header>

      {contacts.length === 0 ? (
        <div className="v-contacts-empty">
          <UsersRound size={44} color="var(--color-text-secondary)" aria-hidden="true" />
          <h2 className={VFont.headline}>No Emergency Contacts Yet</h2>
          <p className={VFont.subheadline}>
            Add at least one trusted contact so VISHWAS can alert someone when you need help.
          </p>
          <PrimaryButton onClick={() => setShowAddContact(true)}>Add Contact</PrimaryButton>
        </div>
      ) : (
        <div className="v-contacts-list">
          {favorites.length > 0 && (
            <section className="v-contacts-section">
              <h2 className="v-contacts-section__title">Favorites</h2>
              {favorites.map((contact) => (
                <ContactRow
                  key={contact.id}
                  contact={contact}
                  onEdit={setContactToEdit}
                  onToggleFavorite={toggleFavorite}
                  onDelete={removeContact}
                />
              ))}
            </section>
          )}

          <section className="v-contacts-section">
            <h2 className="v-contacts-section__title">{favorites.length === 0 ? 'All Contacts' : 'Other Contacts'}</h2>
            {nonFavorites.map((contact) => (
              <ContactRow
                key={contact.id}
                contact={contact}
                onEdit={setContactToEdit}
                onToggleFavorite={toggleFavorite}
                onDelete={removeContact}
              />
            ))}
          </section>
        </div>
      )}

      <AddEditContactModal isOpen={showAddContact} onClose={() => setShowAddContact(false)} contact={null} />
      <AddEditContactModal
        isOpen={contactToEdit !== null}
        onClose={() => setContactToEdit(null)}
        contact={contactToEdit}
      />
      <ImportContactsModal isOpen={showImporter} onClose={() => setShowImporter(false)} onImport={handleImport} />
    </div>
  );
}
