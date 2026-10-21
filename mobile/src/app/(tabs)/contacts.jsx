import { useState } from 'react';
import { View, ScrollView, Pressable, Image, Alert, Linking, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { Plus, UsersRound, Star, Trash2, Phone, MessageSquare, X, UserPlus, BookUser, Info } from 'lucide-react-native';
import { useContacts } from '../../context/ContactsContext';
import { AddEditContactSheet } from '../../features/contacts/AddEditContactSheet';
import { importContactFromPhone } from '../../features/contacts/importContact';
import { PRIORITY, PRIORITY_LABEL } from '../../utils/constants';
import { haptics } from '../../services/hapticService';
import { Card, Badge, IconButton, IconTile, Avatar, SectionHeader, PrimaryButton, SecondaryButton, VText } from '../../components/ui';
import { Enter, ProgressRing, PressableScale } from '../../components/motion';
import { BottomSheet } from '../../components/BottomSheet';
import { useTheme, radius, spacing } from '../../theme/theme';

// Contacts — mirrors ContactsListView.swift: favourites, everyone else,
// empty state, add manually / import one contact from the phone.

const RECOMMENDED = 3;
const PRIORITY_TONE = { [PRIORITY.primary]: 'ink', [PRIORITY.secondary]: 'outline', [PRIORITY.backup]: 'muted' };

function ContactRow({ contact, index, onEdit, onToggleFavorite, onDelete }) {
  const { colors } = useTheme();
  return (
    <Animated.View
      entering={FadeInDown.duration(380).delay(index * 50)}
      exiting={FadeOut.duration(200)}
      layout={LinearTransition.springify().damping(18)}
    >
      <Card padded={false}>
        <PressableScale accessibilityRole="button" accessibilityLabel={`Edit ${contact.name}`} onPress={() => onEdit(contact)} scaleTo={0.985} style={styles.rowMain}>
          {contact.profileImageDataUrl ? (
            <Image source={{ uri: contact.profileImageDataUrl }} style={styles.photo} />
          ) : (
            <Avatar name={contact.name} size={46} tone={contact.priority === PRIORITY.primary ? 'ink' : 'muted'} />
          )}
          <View style={{ flex: 1, gap: 3 }}>
            <View style={styles.nameLine}>
              <VText variant="headline" numberOfLines={1} style={{ flexShrink: 1 }}>{contact.name}</VText>
              {contact.isFavorite && <Star size={13} color={colors.gold} fill={colors.gold} />}
            </View>
            <VText variant="caption" secondary numberOfLines={1}>
              {contact.relationship ? `${contact.relationship} · ${contact.phoneNumber}` : contact.phoneNumber}
            </VText>
          </View>
          <Badge text={PRIORITY_LABEL[contact.priority]} tone={PRIORITY_TONE[contact.priority]} />
        </PressableScale>
        <View style={[styles.actions, { borderTopColor: colors.border }]}>
          <IconButton icon={Phone} label={`Call ${contact.name}`} size={36} onPress={() => { haptics.medium(); Linking.openURL(`tel:${contact.phoneNumber}`); }} />
          <IconButton icon={MessageSquare} label={`SMS ${contact.name}`} size={36} onPress={() => { haptics.light(); Linking.openURL(`sms:${contact.phoneNumber}`); }} />
          <View style={{ flex: 1 }} />
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={contact.isFavorite ? 'Unfavorite' : 'Favourite'}
            onPress={() => { haptics.selection(); onToggleFavorite(contact.id); }}
            scaleTo={0.85}
            style={styles.ghostBtn}
          >
            <Star size={18} color={contact.isFavorite ? colors.gold : colors.textTertiary} fill={contact.isFavorite ? colors.gold : 'none'} />
          </PressableScale>
          <PressableScale accessibilityRole="button" accessibilityLabel="Delete" onPress={() => { haptics.warning(); onDelete(contact); }} scaleTo={0.85} style={styles.ghostBtn}>
            <Trash2 size={18} color={colors.danger} />
          </PressableScale>
        </View>
      </Card>
    </Animated.View>
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
  const strength = Math.min(contacts.length / RECOMMENDED, 1);

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
        <View style={{ flex: 1 }}>
          <VText variant="title">Emergency Contacts</VText>
          <VText variant="caption" secondary>
            {contacts.length} of {RECOMMENDED} recommended · alerted when you send SOS
          </VText>
        </View>
        <IconButton icon={Plus} tone="ink" size={44} label="Add contact" onPress={() => setShowMenu(true)} />
      </View>

      {shownError ? (
        <Animated.View entering={FadeInDown} style={[styles.error, { backgroundColor: colors.dangerTint }]} accessibilityRole="alert">
          <VText variant="caption" color={colors.danger} style={{ flex: 1 }}>{shownError}</VText>
          <Pressable accessibilityLabel="Dismiss error" onPress={() => { clearError(); setImportError(null); }} hitSlop={8}>
            <X size={16} color={colors.danger} />
          </Pressable>
        </Animated.View>
      ) : null}

      {contacts.length === 0 ? (
        <Enter index={0} style={styles.empty}>
          <IconTile icon={UsersRound} tone="muted" size={72} />
          <VText variant="title">No Emergency Contacts Yet</VText>
          <VText variant="subheadline" secondary style={{ textAlign: 'center' }}>
            Add at least one trusted contact so VISHWAS can alert someone when you need help.
          </VText>
          <PrimaryButton icon={UserPlus} onPress={() => setEditing(null)}>Add Contact</PrimaryButton>
        </Enter>
      ) : (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {favorites.length > 0 && (
            <>
              <SectionHeader title="Favorites" right={<Badge text="Priority" tone="ink" />} />
              {favorites.map((c, i) => (
                <ContactRow key={c.id} index={i} contact={c} onEdit={setEditing} onToggleFavorite={toggleFavorite} onDelete={confirmDelete} />
              ))}
            </>
          )}
          {others.length > 0 && (
            <SectionHeader title={favorites.length === 0 ? 'All Contacts' : 'Other Contacts'} right={<VText variant="caption" tertiary>{others.length} contact{others.length === 1 ? '' : 's'}</VText>} />
          )}
          {others.map((c, i) => (
            <ContactRow key={c.id} index={i + favorites.length} contact={c} onEdit={setEditing} onToggleFavorite={toggleFavorite} onDelete={confirmDelete} />
          ))}

          <Enter index={contacts.length + 1}>
            <Card>
              <View style={styles.networkRow}>
                <ProgressRing size={58} stroke={6} progress={strength} color={strength >= 1 ? colors.safe : colors.ink} trackColor={colors.surfaceMuted}>
                  <VText variant="caption" weight="bold">{contacts.length}/{RECOMMENDED}</VText>
                </ProgressRing>
                <View style={{ flex: 1, gap: 2 }}>
                  <VText variant="headline">Safety Network</VText>
                  <VText variant="caption" secondary>
                    {strength >= 1
                      ? 'Great — you have enough people to reach in an emergency.'
                      : `Add ${RECOMMENDED - contacts.length} more so someone is always reachable.`}
                  </VText>
                </View>
              </View>
            </Card>
          </Enter>

          <Enter index={contacts.length + 2}>
            <Card>
              <View style={styles.networkRow}>
                <IconTile icon={Info} tone="muted" size={40} />
                <VText variant="caption" secondary style={{ flex: 1 }}>
                  On SOS, VISHWAS prepares one text with your live location for all contacts, ordered by priority. On iPhone you confirm it in Messages.
                </VText>
              </View>
            </Card>
          </Enter>
        </ScrollView>
      )}

      <BottomSheet isOpen={showMenu} onClose={() => setShowMenu(false)}>
        <VText variant="title">Add a guardian</VText>
        <PrimaryButton icon={UserPlus} onPress={() => { setShowMenu(false); setEditing(null); }}>Add Manually</PrimaryButton>
        <SecondaryButton icon={BookUser} onPress={handleImport}>Import from Contacts</SecondaryButton>
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
  topbar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12 },
  error: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 20, marginBottom: spacing.sm, padding: 12, borderRadius: radius.medium },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  list: { paddingHorizontal: 20, gap: 10, paddingBottom: spacing.xxl },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  photo: { width: 46, height: 46, borderRadius: 23 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  ghostBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  networkRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
});
