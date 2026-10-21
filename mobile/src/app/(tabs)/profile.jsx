import { useState } from 'react';
import { View, ScrollView, Alert, Linking, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ShieldCheck, ShieldAlert, Zap, Phone, ChevronRight, Lock, History, LogOut, KeyRound, Users } from 'lucide-react-native';
import { useAuth } from '../../context/AuthContext';
import { useContacts } from '../../context/ContactsContext';
import { usePermissions } from '../../context/PermissionsContext';
import { PermissionStatus } from '../../services/permissionsService';
import { PermissionsList, PERMISSION_ITEMS } from '../../features/permissions/PermissionsList';
import { haptics } from '../../services/hapticService';
import { Card, Badge, IconTile, Avatar, SectionHeader, VText } from '../../components/ui';
import { Enter, PressableScale } from '../../components/motion';
import { BottomSheet, SheetHeader } from '../../components/BottomSheet';
import { useTheme, radius, spacing } from '../../theme/theme';

const HELPLINES = [
  { number: '112', title: 'All-in-One Emergency', desc: 'Police, Fire, Ambulance' },
  { number: '1091', title: 'Women Helpline', desc: '24/7 support for women in distress' },
  { number: '100', title: 'Police', desc: 'Direct police dispatch' },
];

function SettingsRow({ icon, title, subtitle, onPress, last }) {
  const { colors } = useTheme();
  return (
    <PressableScale accessibilityRole="button" onPress={onPress} scaleTo={0.985} style={[styles.settingsRow, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
      <IconTile icon={icon} tone="muted" size={38} />
      <View style={{ flex: 1 }}>
        <VText variant="headline" style={{ fontSize: 15 }}>{title}</VText>
        {subtitle ? <VText variant="caption" secondary>{subtitle}</VText> : null}
      </View>
      <ChevronRight size={18} color={colors.textTertiary} />
    </PressableScale>
  );
}

export default function Profile() {
  const { colors } = useTheme();
  const router = useRouter();
  const { currentUser, signOut, isLocalOnly } = useAuth();
  const { contacts } = useContacts();
  const { statuses } = usePermissions();
  const [showPermissions, setShowPermissions] = useState(false);

  const granted = PERMISSION_ITEMS.filter((i) => statuses[i.kind] === PermissionStatus.granted).length;
  const isProtected = contacts.length > 0 && statuses.location === PermissionStatus.granted;

  function confirmSignOut() {
    Alert.alert('Sign out?', 'Are you sure you want to sign out of VISHWAS?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => { haptics.warning(); signOut(); } },
    ]);
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Enter index={0} style={styles.hero}>
          <View style={{ flex: 1, gap: 4 }}>
            <VText variant="overline" tertiary>Account &amp; Security</VText>
            <VText variant="display" numberOfLines={2}>{currentUser?.fullName}</VText>
            <VText variant="subheadline" secondary numberOfLines={1}>{currentUser?.email}</VText>
            <View style={styles.badges}>
              <Badge text={isProtected ? 'Protected' : 'Setup needed'} tone={isProtected ? 'safe' : 'warning'} icon={isProtected ? ShieldCheck : ShieldAlert} />
              <Badge text={`${contacts.length} guardian${contacts.length === 1 ? '' : 's'}`} tone="outline" icon={Users} />
            </View>
          </View>
          <Avatar name={currentUser?.fullName} size={72} />
        </Enter>

        <Enter index={1}>
          <Card>
            <View style={styles.tipRow}>
              <IconTile icon={Zap} tone="ink" size={44} />
              <View style={{ flex: 1, gap: 2 }}>
                <VText variant="headline">Rapid SOS Shortcut</VText>
                <VText variant="caption" secondary>
                  Tap three times quickly anywhere in the app to send SOS instantly — no confirmation.
                </VText>
              </View>
            </View>
          </Card>
        </Enter>

        <Enter index={2}>
          <SectionHeader title="Emergency direct helplines" right={<Badge text="24/7" tone="danger" />} />
          <Card padded={false} style={{ marginTop: 10 }}>
            {HELPLINES.map((h, i) => (
              <View key={h.number} style={[styles.helpline, i < HELPLINES.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
                <View style={[styles.helpNum, { backgroundColor: colors.surfaceMuted }]}>
                  <VText variant="headline" weight="heavy" style={{ fontSize: 14 }}>{h.number}</VText>
                </View>
                <View style={{ flex: 1 }}>
                  <VText variant="headline" style={{ fontSize: 15 }}>{h.title}</VText>
                  <VText variant="caption" secondary>{h.desc}</VText>
                </View>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={`Call ${h.title} on ${h.number}`}
                  onPress={() => { haptics.selection(); Linking.openURL(`tel:${h.number}`); }}
                  style={[styles.callPill, { backgroundColor: colors.ink }]}
                >
                  <Phone size={13} color={colors.onInk} />
                  <VText variant="caption" color={colors.onInk} weight="bold">Call</VText>
                </PressableScale>
              </View>
            ))}
          </Card>
        </Enter>

        <Enter index={3}>
          <SectionHeader title="Device & privacy controls" />
          <Card padded={false} style={{ marginTop: 10 }}>
            <SettingsRow icon={KeyRound} title="Protection & Permissions" subtitle={`${granted} of ${PERMISSION_ITEMS.length} allowed`} onPress={() => setShowPermissions(true)} />
            <SettingsRow icon={History} title="Emergency History & Evidence" subtitle="Timelines, locations and recordings" onPress={() => router.push('/history')} last />
          </Card>
        </Enter>

        <Enter index={4}>
          <PressableScale accessibilityRole="button" onPress={confirmSignOut} style={[styles.signOut, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <LogOut size={18} color={colors.danger} />
            <VText variant="headline" color={colors.danger}>Sign Out</VText>
          </PressableScale>
          <View style={styles.footer}>
            <Lock size={12} color={colors.textTertiary} />
            <VText variant="caption" tertiary>VISHWAS v1.0.0 · {isLocalOnly ? 'Account stored on this phone only' : 'Cloud account'}</VText>
          </View>
        </Enter>
      </ScrollView>

      <BottomSheet isOpen={showPermissions} onClose={() => setShowPermissions(false)}>
        <SheetHeader title="Permissions" onClose={() => setShowPermissions(false)} closeLabel="Done" />
        <PermissionsList />
      </BottomSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: spacing.xxl, gap: 16 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  tipRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  helpline: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  helpNum: { minWidth: 48, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  callPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill },
  settingsRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  signOut: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 54, borderWidth: 1.5, borderRadius: radius.pill },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 14 },
});
