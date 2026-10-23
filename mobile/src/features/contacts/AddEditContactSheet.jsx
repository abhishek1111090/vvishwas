import { useEffect, useState } from 'react';
import { View, Pressable, Image, Switch, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Camera, BookUser } from 'lucide-react-native';
import { BottomSheet, SheetHeader } from '../../components/BottomSheet';
import { LabeledField } from '../../components/LabeledField';
import { PrimaryButton, VText } from '../../components/ui';
import { useContacts } from '../../context/ContactsContext';
import { PRIORITY, PRIORITY_LABEL } from '../../utils/constants';
import { isNonEmpty, validatePhone, LIMITS } from '../../utils/validation';
import { haptics } from '../../services/hapticService';
import { toast } from '../../components/Toast';
import { useTheme, radius } from '../../theme/theme';

// AddEditContactSheet — mirrors AddEditContactView.swift. `contact: null`
// adds, an object edits. `prefill` ({ name, phones }) comes from the phone's
// contact book: the form opens filled in, the person picks which number to
// use and adds relationship / priority before saving. Photos are picked with the system picker (no
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

export function AddEditContactSheet({ isOpen, onClose, contact, prefill = null }) {
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
    setName(contact?.name ?? prefill?.name ?? '');
    setPhoneNumber(contact?.phoneNumber ?? prefill?.phones?.[0]?.number ?? '');
    setRelationship(contact?.relationship ?? '');
    setPriority(contact?.priority ?? PRIORITY.secondary);
    setIsFavorite(contact?.isFavorite ?? false);
    setPhoto(contact?.profileImageDataUrl ?? null);
  }, [isOpen, contact, prefill]);

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
    toast.show(isEditing ? `${name.trim()} updated` : `${name.trim()} added as a guardian`);
    onClose();
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} testID="contact-sheet">
      <SheetHeader title={isEditing ? 'Edit Contact' : 'New Contact'} onClose={onClose} />

      <Pressable accessibilityRole="button" accessibilityLabel="Choose contact photo" onPress={handlePhoto} style={[styles.photo, { backgroundColor: colors.backgroundSecondary }]}>
        {photo ? <Image source={{ uri: photo }} style={styles.photoImg} /> : <Camera size={24} color={colors.textSecondary} />}
      </Pressable>
      {fieldErrors.photo ? <VText variant="caption" color={colors.emergency}>{fieldErrors.photo}</VText> : null}

      {!isEditing && prefill ? (
        <View style={[styles.fromBook, { backgroundColor: colors.backgroundSecondary }]}>
          <BookUser size={16} color={colors.textSecondary} />
          <VText variant="caption" secondary style={{ flex: 1 }}>From your contact book — check the details, then Save.</VText>
        </View>
      ) : null}

      <LabeledField label="Full Name" kind="name" value={name} onChangeText={setName} maxLength={LIMITS.nameMax} error={fieldErrors.name} />
      <LabeledField
        label="Phone Number (with country code, e.g. +91…)"
        kind="phone"
        value={phoneNumber}
        onChangeText={(v) => { setPhoneNumber(v); setFieldErrors((f) => ({ ...f, phoneNumber: null })); }}
        error={fieldErrors.phoneNumber}
      />
      {!isEditing && prefill?.phones?.length > 1 ? (
        <View style={{ gap: 6 }}>
          <VText variant="caption" weight="semibold" secondary>Which number should VISHWAS alert?</VText>
          <View style={styles.numbers}>
            {prefill.phones.map((p) => {
              const selected = phoneNumber === p.number;
              return (
                <Pressable
                  key={p.number}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${p.label ?? 'Phone'} ${p.number}`}
                  onPress={() => { haptics.selection(); setPhoneNumber(p.number); setFieldErrors((f) => ({ ...f, phoneNumber: null })); }}
                  style={[styles.numberChip, { borderColor: selected ? colors.ink : colors.border, backgroundColor: selected ? colors.ink : 'transparent' }]}
                >
                  {p.label ? <VText variant="caption" color={selected ? colors.onInk : colors.textSecondary}>{p.label}</VText> : null}
                  <VText variant="subheadline" weight="semibold" color={selected ? colors.onInk : colors.textPrimary}>{p.number}</VText>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
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
  fromBook: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: radius.medium },
  numbers: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  numberChip: { borderWidth: 1, borderRadius: radius.medium, paddingHorizontal: 12, paddingVertical: 8 },
  photo: { width: 84, height: 84, borderRadius: 42, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  photoImg: { width: 84, height: 84 },
  segmented: { flexDirection: 'row', borderRadius: radius.pill, padding: 4 },
  segment: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  favorite: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
});
