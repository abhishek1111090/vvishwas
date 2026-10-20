import { useState, useEffect } from 'react';
import { Camera } from 'lucide-react';
import { BottomSheet } from '../../components/BottomSheet';
import { SheetHeader } from '../../components/SheetHeader';
import { LabeledField } from '../../components/LabeledField';
import { PrimaryButton } from '../../design-system/components/Button';
import { useContacts } from '../../context/ContactsContext';
import { PRIORITY, PRIORITY_LABEL } from '../../utils/constants';
import { isNonEmpty } from '../../utils/validation';
import { haptics } from '../../services/hapticService';
import './contacts.css';

// AddEditContactModal.jsx
// --------------------------
// CONVERSION NOTE: mirrors AddEditContactView.swift. `contact: nil` for
// "adding" vs non-nil for "editing" is the same prop convention here.
// `PhotosPicker` + `loadTransferable(type: Data.self)` becomes a plain
// `<input type="file" accept="image/*">` read via `FileReader.readAsDataURL`
// — see the comment on contactsService.js for why base64 data URLs are the
// right web equivalent of raw `Data`.

const PRIORITY_OPTIONS = [PRIORITY.primary, PRIORITY.secondary, PRIORITY.backup];

export function AddEditContactModal({ isOpen, onClose, contact }) {
  const { addContact, updateContact } = useContacts();
  const isEditing = contact != null;

  const [name, setName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [relationship, setRelationship] = useState('');
  const [priority, setPriority] = useState(PRIORITY.secondary);
  const [isFavorite, setIsFavorite] = useState(false);
  const [photoDataUrl, setPhotoDataUrl] = useState(null);

  // mirrors `.onAppear { populateFieldsIfEditing() }`
  useEffect(() => {
    if (!isOpen) return;
    if (contact) {
      setName(contact.name);
      setPhoneNumber(contact.phoneNumber);
      setRelationship(contact.relationship);
      setPriority(contact.priority);
      setIsFavorite(contact.isFavorite);
      setPhotoDataUrl(contact.profileImageDataUrl);
    } else {
      setName('');
      setPhoneNumber('');
      setRelationship('');
      setPriority(PRIORITY.secondary);
      setIsFavorite(false);
      setPhotoDataUrl(null);
    }
  }, [isOpen, contact]);

  const canSave = isNonEmpty(name) && isNonEmpty(phoneNumber);

  function handlePhotoChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPhotoDataUrl(reader.result);
    reader.readAsDataURL(file);
  }

  function handleSave() {
    if (!canSave) return;
    haptics.light();

    const data = {
      name: name.trim(),
      phoneNumber: phoneNumber.trim(),
      relationship: relationship.trim(),
      priority,
      isFavorite,
      profileImageDataUrl: photoDataUrl,
    };

    if (isEditing) {
      updateContact(contact.id, data);
    } else {
      addContact(data);
    }
    onClose();
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose}>
      <SheetHeader title={isEditing ? 'Edit Contact' : 'New Contact'} onClose={onClose} />

      <div className="v-add-contact">
        <label className="v-add-contact__photo-picker">
          {photoDataUrl ? (
            <img src={photoDataUrl} alt="" className="v-add-contact__photo-img" />
          ) : (
            <span className="v-add-contact__photo-placeholder">
              <Camera size={24} color="var(--color-text-secondary)" />
            </span>
          )}
          <input type="file" accept="image/*" onChange={handlePhotoChange} hidden />
        </label>

        <div className="v-auth-form">
          <LabeledField label="Full Name" value={name} onChange={setName} autoComplete="name" />
          <LabeledField
            label="Phone Number"
            value={phoneNumber}
            onChange={setPhoneNumber}
            type="tel"
            autoComplete="tel"
          />
          <LabeledField
            label="Relationship (e.g. Mother, Friend)"
            value={relationship}
            onChange={setRelationship}
          />
        </div>

        <div className="v-add-contact__priority">
          <span className="v-add-contact__section-label">Priority Level</span>
          <div className="v-segmented">
            {PRIORITY_OPTIONS.map((level) => (
              <button
                type="button"
                key={level}
                className={`v-segmented__option ${priority === level ? 'v-segmented__option--selected' : ''}`}
                onClick={() => setPriority(level)}
              >
                {PRIORITY_LABEL[level]}
              </button>
            ))}
          </div>
        </div>

        <label className="v-add-contact__favorite-toggle">
          <span>Mark as Favorite</span>
          <input type="checkbox" checked={isFavorite} onChange={(e) => setIsFavorite(e.target.checked)} />
        </label>

        <PrimaryButton onClick={handleSave} disabled={!canSave}>
          Save
        </PrimaryButton>
      </div>
    </BottomSheet>
  );
}
