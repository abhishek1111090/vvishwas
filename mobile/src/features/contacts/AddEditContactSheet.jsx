import { useEffect, useState } from 'react';
import { View, Pressable, Image, Switch, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Camera } from 'lucide-react-native';
import { BottomSheet, SheetHeader } from '../../components/BottomSheet';
import { LabeledField } from '../../components/LabeledField';
import { PrimaryButton, VText } from '../../components/ui';
import { useContacts } from '../../context/ContactsContext';
import { PRIORITY, PRIORITY_LABEL } from '../../utils/constants';
import { isNonEmpty, validatePhone, LIMITS } from '../../utils/validation';
import { haptics } from '../../services/hapticService';
import { useTheme, radius } from '../../theme/theme';

// AddEditContactSheet — mirrors AddEditContactView.swift. `contact: null`
// adds, an object edits. Photos are picked with the system picker (no
// library permission needed on iOS 14+) and downscaled to a 256px JPEG.

const PRIORITY_OPTIONS = [PRIORITY.primary, PRIORITY.secondary, PRIORITY.backup];

async function pickPhoto() {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 });
  if (result.canceled || !result.assets?.[0]) return null;
  const context = ImageManipulator.manipulate(result.assets[0].uri);
  context.resize({ width: 256 });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
  return `data:image/jpeg;base64,${saved.base64}`;
}

export function AddEditContactSheet({ isOpen, onClose, contact }) {
  const { colors } = useTheme();
  const { addContact, updateContact } = useContacts();
  const isEditing = contact != null;

  const [name, setName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [relationship, setRelationship] = useState('');
  const [priority, setPriority] = useState(PRIORITY.secondary);
  const [isFavorite, setIsFavorite] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setFieldErrors({});
    setFormError(null);
    setName(contact?.name ?? '');
    setPhoneNumber(contact?.phoneNumber ?? '');
    setRelationship(contact?.relationship ?? '');
    setPriority(contact?.priority ?? PRIORITY.secondary);
    setIsFavorite(contact?.isFavorite ?? false);
    setPhoto(contact?.profileImageDataUrl ?? null);
  }, [isOpen, contact]);

  const canSave = isNonEmpty(name) && isNonEmpty(phoneNumber) && !saving;

  async function handlePhoto() {
    try {
      const dataUrl = await pickPhoto();
      if (dataUrl) setPhoto(dataUrl);
    } catch (err) {
      setFieldErrors((f) => ({ ...f, photo: err?.message ?? 'Could not load that photo.' }));
    }
  }

  async function handleSave() {
    const phoneError = validatePhone(phoneNumber);
    if (phoneError) {
      setFieldErrors({ phoneNumber: phoneError });
      haptics.error();
      return;
    }
    setSaving(true);
    const data = { name, phoneNumber, relationship, priority, isFavorite, profileImageDataUrl: photo };
    const result = isEditing ? await updateContact(contact.id, data) : await addContact(data);
    setSaving(false);
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
    <BottomSheet isOpen={isOpen} onClose={onClose} testID="contact-sheet">
      <SheetHeader title={isEditing ? 'Edit Contact' : 'New Contact'} onClose={onClose} />

      <Pressable accessibilityRole="button" accessibilityLabel="Choose contact photo" onPress={handlePhoto} style={[styles.photo, { backgroundColor: colors.backgroundSecondary }]}>
        {photo ? <Image source={{ uri: photo }} style={styles.photoImg} /> : <Camera size={24} color={colors.textSecondary} />}
      </Pressable>
      {fieldErrors.photo ? <VText variant="caption" color={colors.emergency}>{fieldErrors.photo}</VText> : null}

      <LabeledField label="Full Name" kind="name" value={name} onChangeText={setName} maxLength={LIMITS.nameMax} error={fieldErrors.name} />
      <LabeledField
        label="Phone Number (with country code, e.g. +91…)"
        kind="phone"
        value={phoneNumber}
        onChangeText={(v) => { setPhoneNumber(v); setFieldErrors((f) => ({ ...f, phoneNumber: null })); }}
        error={fieldErrors.phoneNumber}
      />
      <LabeledField label="Relationship (e.g. Mother, Friend)" kind="name" value={relationship} onChangeText={setRelationship} maxLength={LIMITS.relationshipMax} error={fieldErrors.relationship} />

      <VText variant="caption" weight="semibold" secondary>Priority Level</VText>
      <View style={[styles.segmented, { backgroundColor: colors.backgroundSecondary }]}>
        {PRIORITY_OPTIONS.map((level) => {
          const selected = priority === level;
          return (
            <Pressable
              key={level}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setPriority(level)}
              style={[styles.segment, selected && { backgroundColor: colors.ink }]}
            >
              <VText variant="subheadline" weight={selected ? 'bold' : 'regular'} color={selected ? colors.onInk : colors.textSecondary}>{PRIORITY_LABEL[level]}</VText>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.favorite}>
        <VText variant="body">Mark as Favorite</VText>
        <Switch accessibilityLabel="Mark as Favorite" value={isFavorite} onValueChange={setIsFavorite} trackColor={{ true: colors.ink }} />
      </View>

      {formError ? <VText variant="caption" color={colors.emergency} accessibilityRole="alert">{formError}</VText> : null}
      <PrimaryButton onPress={handleSave} disabled={!canSave} loading={saving}>Save</PrimaryButton>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  photo: { width: 84, height: 84, borderRadius: 42, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  photoImg: { width: 84, height: 84 },
  segmented: { flexDirection: 'row', borderRadius: radius.pill, padding: 4 },
  segment: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  favorite: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
});
