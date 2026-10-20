import { useState, useEffect } from 'react';
import { Camera } from 'lucide-react';
import { BottomSheet } from '../../components/BottomSheet';
import { SheetHeader } from '../../components/SheetHeader';
import { LabeledField } from '../../components/LabeledField';
import { PrimaryButton } from '../../design-system/components/Button';
import { useContacts } from '../../context/ContactsContext';
import { PRIORITY, PRIORITY_LABEL } from '../../utils/constants';
import { isNonEmpty, validatePhone, LIMITS } from '../../utils/validation';
import { haptics } from '../../services/hapticService';
import './contacts.css';

// AddEditContactModal.jsx
// --------------------------
// CONVERSION NOTE: mirrors AddEditContactView.swift. `contact: nil` for
// "adding" vs non-nil for "editing" is the same prop convention here.
// `PhotosPicker` + `loadTransferable(type: Data.self)` becomes a plain
// `<input type="file" accept="image/*">` read via `FileReader.readAsDataURL`
// — see the comment on contactsService.js for why base64 data URLs are the
// right web equivalent of raw `Data`. Photos are downscaled to 256px JPEG
// before saving so a camera photo can't fill device storage.

const PHOTO_MAX_PX = 256;

function downscaleImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Please choose an image file.'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, PHOTO_MAX_PX / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image.'));
    };
    img.src = url;
  });
}

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
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);

  // mirrors `.onAppear { populateFieldsIfEditing() }`
  useEffect(() => {
    if (!isOpen) return;
    setFieldErrors({});
    setFormError(null);
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

  async function handlePhotoChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setPhotoDataUrl(await downscaleImage(file));
      setFieldErrors((f) => ({ ...f, photo: null }));
    } catch (err) {
      setFieldErrors((f) => ({ ...f, photo: err.message }));
    }
  }

  function handleSave() {
    if (!canSave) return;
    const phoneError = validatePhone(phoneNumber);
    if (phoneError) {
      setFieldErrors({ phoneNumber: phoneError });
      haptics.error();
      return;
    }

    const data = {
      name: name.trim(),
      phoneNumber: phoneNumber.trim(),
      relationship: relationship.trim(),
      priority,
      isFavorite,
      profileImageDataUrl: photoDataUrl,
    };

    const result = isEditing ? updateContact(contact.id, data) : addContact(data);
    if (!result.ok) {
      haptics.error();
      if (result.field && result.field !== 'id') setFieldErrors({ [result.field]: result.error });
      else setFormError(result.error);
      return;
    }
    haptics.light();
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
        {fieldErrors.photo && <p className="v-auth-error" role="alert">{fieldErrors.photo}</p>}

        <div className="v-auth-form">
          <LabeledField
            label="Full Name"
            value={name}
            onChange={setName}
            autoComplete="name"
            maxLength={LIMITS.nameMax}
            error={fieldErrors.name}
          />
          <LabeledField
            label="Phone Number (with country code, e.g. +91…)"
            value={phoneNumber}
            onChange={(v) => { setPhoneNumber(v); setFieldErrors((f) => ({ ...f, phoneNumber: null })); }}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            error={fieldErrors.phoneNumber}
          />
          <LabeledField
            label="Relationship (e.g. Mother, Friend)"
            value={relationship}
            onChange={setRelationship}
            maxLength={LIMITS.relationshipMax}
            error={fieldErrors.relationship}
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

        {formError && <p className="v-auth-error" role="alert">{formError}</p>}

        <PrimaryButton onClick={handleSave} disabled={!canSave}>
          Save
        </PrimaryButton>
      </div>
    </BottomSheet>
  );
}
