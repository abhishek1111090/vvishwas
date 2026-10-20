import { useState } from 'react';
import { Contact2 } from 'lucide-react';
import { BottomSheet } from '../../components/BottomSheet';
import { SheetHeader } from '../../components/SheetHeader';
import { PrimaryButton, SecondaryButton } from '../../design-system/components/Button';
import { VFont } from '../../design-system/theme';
import './contacts.css';

// ImportContactsModal.jsx
// -------------------------
// CONVERSION NOTE: mirrors ContactPickerView.swift's header comment almost
// word-for-word — the goal (never request blanket Contacts access, only
// receive the specific contact the user explicitly picked) maps onto the
// web's Contact Picker API (`navigator.contacts.select`), which is even
// more restrictive than iOS's CNContactPickerViewController: as of this
// writing it only ships in Chrome on Android, behind a user gesture, over
// HTTPS. Everywhere else this gracefully falls back to a "not supported"
// placeholder pointing at manual entry — which is the honest answer rather
// than faking a picker UI that can't actually read any contacts.

export function ImportContactsModal({ isOpen, onClose, onImport }) {
  const [isPicking, setIsPicking] = useState(false);
  const [error, setError] = useState(null);

  const isSupported =
    typeof navigator !== 'undefined' && 'contacts' in navigator && 'ContactsManager' in window;

  async function handlePick() {
    setError(null);
    setIsPicking(true);
    try {
      const [picked] = await navigator.contacts.select(['name', 'tel'], { multiple: false });
      if (picked) {
        const result = onImport({
          name: picked.name?.[0] ?? 'Imported Contact',
          phoneNumber: picked.tel?.[0] ?? '',
        });
        if (result && !result.ok) {
          setError(result.error);
          return;
        }
        onClose();
      }
    } catch (err) {
      // AbortError = user cancelled the picker — not a real error, mirrors
      // the Swift delegate simply not firing `didSelect` on cancel.
      if (err?.name !== 'AbortError') setError(err?.message ?? 'Could not read the contact.');
    } finally {
      setIsPicking(false);
    }
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose}>
      <SheetHeader title="Import Contact" onClose={onClose} />
      <div className="v-import-contacts">
        <Contact2 size={40} color="var(--color-accent)" aria-hidden="true" />

        {isSupported ? (
          <>
            <p className={VFont.subheadline}>
              Pick a contact from your device. VISHWAS only receives the one contact you choose —
              never your full address book.
            </p>
            {error && <p className={['v-auth-error', VFont.caption].join(' ')}>{error}</p>}
            <PrimaryButton onClick={handlePick} disabled={isPicking}>
              {isPicking ? 'Choosing…' : 'Choose Contact'}
            </PrimaryButton>
          </>
        ) : (
          <>
            <p className={VFont.subheadline}>
              Your browser doesn't support picking contacts directly (this API currently only works
              in Chrome on Android). Use "Add Manually" instead — it only takes a few seconds.
            </p>
            <SecondaryButton onClick={onClose}>Got it</SecondaryButton>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
