import { View, ScrollView, Pressable, Alert, Linking, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ShieldCheck, AlertTriangle, PhoneCall, LogOut, Info, Lock, History, ChevronRight } from 'lucide-react-native';
import { useAuth } from '../../context/AuthContext';
import { useContacts } from '../../context/ContactsContext';
import { usePermissions } from '../../context/PermissionsContext';
import { PermissionStatus } from '../../services/permissionsService';
import { PermissionsList } from '../../features/permissions/PermissionsList';
import { useBattery } from '../../utils/deviceHooks';
import { haptics } from '../../services/hapticService';
import { Card, VText } from '../../components/ui';
import { useTheme, withAlpha, radius, spacing } from '../../theme/theme';

const HELPLINES = [
  { number: '112', title: 'National Emergency', desc: 'All-in-one emergency response (Police, Fire, Medical)' },
  { number: '1091', title: 'Women Helpline', desc: '24/7 dedicated support for women in distress' },
  { number: '100', title: 'Police Direct', desc: 'Immediate police emergency dispatch' },
];

export default function Profile() {
  const { colors } = useTheme();
  const router = useRouter();
  const { currentUser, signOut, isLocalOnly } = useAuth();
  const { contacts } = useContacts();
  const { statuses } = usePermissions();
  const battery = useBattery();

  const isProtected = contacts.length > 0 && statuses.location === PermissionStatus.granted;
  const initials = (currentUser?.fullName ?? 'V').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

  function confirmSignOut() {
    Alert.alert('Sign out?', 'Are you sure you want to sign out of VISHWAS?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => { haptics.warning(); signOut(); } },
    ]);
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.topbar}>
        <VText variant="headline">Account &amp; Security</VText>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <View style={styles.user}>
            <View style={[styles.avatar, { backgroundColor: colors.accent }]}>
              <VText variant="title" color="#fff">{initials}</VText>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <VText variant="title" numberOfLines={1}>{currentUser?.fullName}</VText>
              <VText variant="subheadline" secondary numberOfLines={1}>{currentUser?.email}</VText>
              <View style={styles.statusLine}>
                {isProtected ? <ShieldCheck size={14} color={colors.safe} /> : <AlertTriangle size={14} color={colors.warning} />}
                <VText variant="caption" color={isProtected ? colors.safe : colors.warning}>
                  {isProtected ? 'Protection Active' : 'Setup Needed'}
                </VText>
              </View>
            </View>
          </View>
        </Card>

        <VText variant="caption" secondary style={styles.sectionTitle}>PERMISSIONS</VText>
        <PermissionsList />

        <Card>
          <View style={styles.infoRow}>
            <VText variant="subheadline">Trusted contacts</VText>
            <VText variant="subheadline" color={contacts.length > 0 ? colors.safe : colors.warning}>
              {contacts.length > 0 ? `${contacts.length} linked` : 'None added — alerts won’t reach anyone'}
            </VText>
          </View>
          <View style={styles.infoRow}>
            <VText variant="subheadline">Battery</VText>
            <VText variant="subheadline" secondary>
              {battery.level === null ? 'Not available on this device' : `${Math.round(battery.level * 100)}% · ${battery.charging ? 'Charging' : 'On battery'}`}
            </VText>
          </View>
        </Card>

        <Pressable accessibilityRole="button" onPress={() => router.push('/history')} style={[styles.link, { backgroundColor: colors.backgroundSecondary }]}>
          <History size={18} color={colors.accent} />
          <VText variant="headline" style={{ flex: 1 }}>Emergency History</VText>
          <ChevronRight size={18} color={colors.textSecondary} />
        </Pressable>

        <VText variant="caption" secondary style={styles.sectionTitle}>EMERGENCY HELPLINES (ONE-TAP CALL)</VText>
        {HELPLINES.map((h) => (
          <Pressable
            key={h.number}
            accessibilityRole="button"
            accessibilityLabel={`Call ${h.title} on ${h.number}`}
            onPress={() => { haptics.selection(); Linking.openURL(`tel:${h.number}`); }}
            style={[styles.helpline, { backgroundColor: colors.backgroundSecondary }]}
          >
            <View style={[styles.helpIcon, { backgroundColor: withAlpha(colors.emergency, 0.12) }]}>
              <PhoneCall size={20} color={colors.emergency} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.infoRow}>
                <VText variant="headline">{h.title}</VText>
                <VText variant="headline" color={colors.emergency}>{h.number}</VText>
              </View>
              <VText variant="caption" secondary>{h.desc}</VText>
            </View>
          </Pressable>
        ))}

        <Card>
          <View style={styles.tip}>
            <Info size={20} color={colors.accent} />
            <View style={{ flex: 1, gap: 2 }}>
              <VText variant="headline">Triple-Tap Emergency Shortcut</VText>
              <VText variant="caption" secondary>
                In sudden danger, tap three times quickly anywhere in the app to trigger SOS instantly without confirmation.
              </VText>
            </View>
          </View>
        </Card>

        <Pressable accessibilityRole="button" onPress={confirmSignOut} style={[styles.signOut, { borderColor: colors.separator }]}>
          <LogOut size={18} color={colors.emergency} />
          <VText variant="headline" color={colors.emergency}>Sign Out</VText>
        </Pressable>

        <View style={styles.footer}>
          <Lock size={12} color={colors.textSecondary} />
          <VText variant="caption" secondary>VISHWAS v1.0.0 · {isLocalOnly ? 'Account stored on this phone only' : 'Cloud account'}</VText>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topbar: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 52, justifyContent: 'center' },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  user: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  sectionTitle: { fontWeight: '700', letterSpacing: 0.6, marginTop: 4 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, minHeight: 32, flexWrap: 'wrap' },
  link: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 52, paddingHorizontal: spacing.md, borderRadius: radius.medium },
  helpline: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.medium },
  helpIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  tip: { flexDirection: 'row', gap: spacing.sm },
  signOut: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 52, borderWidth: 1.5, borderRadius: radius.medium },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
});
