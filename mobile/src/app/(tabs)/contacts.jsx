import { useState } from 'react';
import { View, ScrollView, Pressable, Image, Alert, Linking, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Plus, UsersRound, Star, Trash2, Phone, MessageSquare, X } from 'lucide-react-native';
import { useContacts } from '../../context/ContactsContext';
import { AddEditContactSheet } from '../../features/contacts/AddEditContactSheet';
import { importContactFromPhone } from '../../features/contacts/importContact';
import { PRIORITY, PRIORITY_LABEL } from '../../utils/constants';
import { haptics } from '../../services/hapticService';
import { PrimaryButton, VText } from '../../components/ui';
import { BottomSheet } from '../../components/BottomSheet';
import { useTheme, withAlpha, radius, spacing } from '../../theme/theme';

// Contacts — mirrors ContactsListView.swift: favourites section, all
// contacts, empty state, add manually / import from the phone's contacts.

function priorityColor(priority, colors) {
  if (priority === PRIORITY.primary) return colors.emergency;
  if (priority === PRIORITY.secondary) return colors.info;
  return colors.textSecondary;
}

const initials = (name) => name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

function ContactRow({ contact, onEdit, onToggleFavorite, onDelete }) {
  const { colors } = useTheme();
  const tint = priorityColor(contact.priority, colors);
  return (
    <View style={[styles.row, { backgroundColor: colors.backgroundSecondary }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${contact.name}`} onPress={() => onEdit(contact)} style={styles.rowMain}>
        {contact.profileImageDataUrl ? (
          <Image source={{ uri: contact.profileImageDataUrl }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, { backgroundColor: withAlpha(tint, 0.15) }]}>
            <VText variant="headline" color={tint}>{initials(contact.name)}</VText>
          </View>
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <View style={styles.nameLine}>
            <VText variant="headline" numberOfLines={1} style={{ flexShrink: 1 }}>{contact.name}</VText>
            {contact.isFavorite && <Star size={12} color="#ffcc00" fill="#ffcc00" />}
          </View>
          <VText variant="caption" secondary numberOfLines={1}>
            {contact.relationship ? `${contact.relationship} · ${contact.phoneNumber}` : contact.phoneNumber}
          </VText>
          <View style={[styles.priority, { backgroundColor: withAlpha(tint, 0.12) }]}>
            <VText variant="caption" color={tint} style={{ fontSize: 11, fontWeight: '700' }}>{PRIORITY_LABEL[contact.priority]}</VText>
          </View>
        </View>
      </Pressable>
      <View style={styles.actions}>
        <IconButton label={`Call ${contact.name}`} onPress={() => { haptics.medium(); Linking.openURL(`tel:${contact.phoneNumber}`); }}>
          <Phone size={16} color={colors.safe} />
        </IconButton>
        <IconButton label={`SMS ${contact.name}`} onPress={() => { haptics.light(); Linking.openURL(`sms:${contact.phoneNumber}`); }}>
          <MessageSquare size={16} color={colors.info} />
        </IconButton>
        <IconButton label={contact.isFavorite ? 'Unfavorite' : 'Favourite'} onPress={() => { haptics.selection(); onToggleFavorite(contact.id); }}>
          <Star size={16} color={contact.isFavorite ? '#ffcc00' : colors.textSecondary} fill={contact.isFavorite ? '#ffcc00' : 'none'} />
        </IconButton>
        <IconButton label="Delete" onPress={() => { haptics.warning(); onDelete(contact); }}>
          <Trash2 size={16} color={colors.emergency} />
        </IconButton>
      </View>
    </View>
  );
}

function IconButton({ label, onPress, children }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6} style={styles.iconButton}>
      {children}
    </Pressable>
  );
}

export default function ContactsScreen() {
  const { colors } = useTheme();
  const { contacts, removeContact, toggleFavorite, addContact, error, clearError } = useContacts();
  const [showMenu, setShowMenu] = useState(false);
  const [editing, setEditing] = useState(undefined); // undefined = closed, null = new, object = edit
  const [importError, setImportError] = useState(null);

  const favorites = contacts.filter((c) => c.isFavorite);
  const others = contacts.filter((c) => !c.isFavorite);

  function confirmDelete(contact) {
    Alert.alert('Remove contact?', `Remove ${contact.name} from your emergency contacts?`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeContact(contact.id) },
    ]);
  }

  async function handleImport() {
    setShowMenu(false);
    setImportError(null);
    const picked = await importContactFromPhone();
    if (picked.error) {
      setImportError(picked.error);
      return;
    }
    if (picked.cancelled) return;
    const result = await addContact({ name: picked.name, phoneNumber: picked.phoneNumber, relationship: '' });
    if (!result.ok) setImportError(`Couldn’t import ${picked.name}: ${result.error}`);
  }

  const shownError = importError ?? error;

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.topbar}>
        <VText variant="headline">Emergency Contacts</VText>
        <Pressable accessibilityRole="button" accessibilityLabel="Add contact" onPress={() => setShowMenu(true)} hitSlop={8} style={[styles.addBtn, { backgroundColor: withAlpha(colors.accent, 0.12) }]}>
          <Plus size={20} color={colors.accent} />
        </Pressable>
      </View>

      {shownError ? (
        <View style={[styles.error, { backgroundColor: withAlpha(colors.emergency, 0.1) }]} accessibilityRole="alert">
          <VText variant="caption" color={colors.emergency} style={{ flex: 1 }}>{shownError}</VText>
          <Pressable accessibilityLabel="Dismiss error" onPress={() => { clearError(); setImportError(null); }} hitSlop={8}>
            <X size={16} color={colors.emergency} />
          </Pressable>
        </View>
      ) : null}

      {contacts.length === 0 ? (
        <View style={styles.empty}>
          <UsersRound size={44} color={colors.textSecondary} />
          <VText variant="headline">No Emergency Contacts Yet</VText>
          <VText variant="subheadline" secondary style={{ textAlign: 'center' }}>
            Add at least one trusted contact so VISHWAS can alert someone when you need help.
          </VText>
          <PrimaryButton onPress={() => setEditing(null)}>Add Contact</PrimaryButton>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {favorites.length > 0 && (
            <>
              <VText variant="caption" secondary style={styles.sectionTitle}>FAVORITES</VText>
              {favorites.map((c) => (
                <ContactRow key={c.id} contact={c} onEdit={setEditing} onToggleFavorite={toggleFavorite} onDelete={confirmDelete} />
              ))}
            </>
          )}
          {others.length > 0 && (
            <VText variant="caption" secondary style={styles.sectionTitle}>{favorites.length === 0 ? 'ALL CONTACTS' : 'OTHER CONTACTS'}</VText>
          )}
          {others.map((c) => (
            <ContactRow key={c.id} contact={c} onEdit={setEditing} onToggleFavorite={toggleFavorite} onDelete={confirmDelete} />
          ))}
        </ScrollView>
      )}

      <BottomSheet isOpen={showMenu} onClose={() => setShowMenu(false)}>
        <PrimaryButton onPress={() => { setShowMenu(false); setEditing(null); }}>Add Manually</PrimaryButton>
        <PrimaryButton onPress={handleImport}>Import from Contacts</PrimaryButton>
        <VText variant="caption" secondary style={{ textAlign: 'center' }}>
          Import opens your phone’s contact picker. VISHWAS only receives the one contact you choose.
        </VText>
      </BottomSheet>

      <AddEditContactSheet isOpen={editing !== undefined} contact={editing ?? null} onClose={() => setEditing(undefined)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 52 },
  addBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  error: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: spacing.md, marginBottom: spacing.sm, padding: 10, borderRadius: radius.small },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  list: { padding: spacing.md, gap: 10, paddingBottom: spacing.xl },
  sectionTitle: { fontWeight: '700', letterSpacing: 0.6, marginTop: 6 },
  row: { borderRadius: radius.medium, padding: 12, gap: 8 },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  priority: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, marginTop: 2 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 4 },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
