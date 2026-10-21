import { useState } from 'react';
import { View, ScrollView, Pressable, Linking, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ShieldCheck, ShieldAlert, Users, MapPin, Battery, BatteryCharging, BatteryLow, BatteryMedium, BatteryFull, BatteryWarning,
  Timer, PhoneIncoming, BadgeCheck, Route, CircleCheck, Siren, Phone, ChevronRight, Sparkles,
} from 'lucide-react-native';
import { useEmergency } from '../../context/EmergencyContext';
import { usePermissions } from '../../context/PermissionsContext';
import { useContacts } from '../../context/ContactsContext';
import { useAuth } from '../../context/AuthContext';
import { useBattery, useLocationStatus } from '../../utils/deviceHooks';
import { formatShortTime, formatShortDate } from '../../utils/formatDate';
import { TRIGGER_SOURCE } from '../../utils/constants';
import { haptics } from '../../services/hapticService';
import { SOSButton } from '../../features/sos/SOSButton';
import { SOSConfirmSheet } from '../../features/sos/SOSConfirmSheet';
import { BottomSheet } from '../../components/BottomSheet';
import { Card, Badge, StatusPill, IconTile, Avatar, SectionHeader, PrimaryButton, VText } from '../../components/ui';
import { Enter, PressableScale } from '../../components/motion';
import { useTheme, radius, spacing } from '../../theme/theme';

const TOOLKIT = [
  { id: 'safetyTimer', title: 'Safety Timer', subtitle: 'Auto-SOS if you don’t check in', icon: Timer },
  { id: 'fakeCall', title: 'Fake Call', subtitle: 'Simulate an incoming call', icon: PhoneIncoming },
  { id: 'checkIn', title: 'Check In', subtitle: 'Tell contacts you’re safe', icon: BadgeCheck },
  { id: 'safeRoute', title: 'Safe Route', subtitle: 'Well-lit, busy pathways', icon: Route },
];

const STATUS_TONE = { resolved: 'safe', cancelled: 'muted', active: 'danger', ending: 'warning' };
const STATUS_TEXT = { resolved: 'Resolved', cancelled: 'Cancelled', active: 'Active', ending: 'Ending' };

function batteryIcon(level, charging) {
  if (level === null) return Battery;
  if (charging) return BatteryCharging;
  if (level < 0.2) return BatteryWarning;
  if (level < 0.5) return BatteryLow;
  if (level < 0.8) return BatteryMedium;
  return BatteryFull;
}

function StatTile({ icon, title, subtitle, tone = 'muted' }) {
  return (
    <Card style={styles.stat}>
      <IconTile icon={icon} tone={tone} size={34} />
      <VText variant="headline" numberOfLines={1} style={{ fontSize: 14 }}>{title}</VText>
      <VText variant="caption" secondary numberOfLines={1}>{subtitle}</VText>
    </Card>
  );
}

export default function Home() {
  const { colors } = useTheme();
  const router = useRouter();
  const emergency = useEmergency();
  const { statuses } = usePermissions();
  const { contacts } = useContacts();
  const { currentUser } = useAuth();
  const battery = useBattery();
  const loc = useLocationStatus(statuses.location);
  const [showConfirm, setShowConfirm] = useState(false);
  const [comingSoon, setComingSoon] = useState(null);

  const locationOk = loc.state === 'ok';
  const isProtected = contacts.length > 0 && locationOk;
  const missing = [contacts.length === 0 && 'add a trusted contact', !locationOk && 'turn on location'].filter(Boolean);

  const BatteryIcon = batteryIcon(battery.level, battery.charging);
  const batteryLow = battery.level !== null && battery.level < 0.2 && !battery.charging;

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.topbar}>
        <View style={styles.brand}>
          <View style={[styles.logo, { backgroundColor: colors.ink }]}>
            <ShieldCheck size={18} color={colors.onInk} strokeWidth={2.4} />
          </View>
          <View>
            <VText variant="headline" weight="heavy" style={{ letterSpacing: 0.4 }}>VISHWAS</VText>
            <VText variant="overline" tertiary style={{ fontSize: 9 }}>Personal Safety</VText>
          </View>
        </View>
        <View style={styles.topRight}>
          <StatusPill text={isProtected ? 'Active' : 'Setup'} tone={isProtected ? 'safe' : 'warning'} />
          <Pressable accessibilityRole="button" accessibilityLabel="Account" onPress={() => router.navigate('/profile')}>
            <Avatar name={currentUser?.fullName} size={36} />
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Enter index={0}>
          <Card>
            <View style={styles.guardRow}>
              <IconTile icon={isProtected ? ShieldCheck : ShieldAlert} tone={isProtected ? 'ink' : 'warning'} size={46} />
              <View style={{ flex: 1, gap: 2 }}>
                <View style={styles.guardTitle}>
                  <VText variant="headline">Protection</VText>
                  <Badge text={isProtected ? 'Safe' : 'Setup'} tone={isProtected ? 'ink' : 'warning'} />
                </View>
                <VText variant="caption" secondary>
                  {isProtected
                    ? 'Location, contacts and evidence capture are ready.'
                    : `To be fully protected, ${missing.join(' and ')}.`}
                </VText>
              </View>
            </View>
          </Card>
        </Enter>

        <Enter index={1} style={styles.stats}>
          <StatTile
            icon={Users}
            tone={contacts.length > 0 ? 'muted' : 'warning'}
            title={`${contacts.length} Guardian${contacts.length === 1 ? '' : 's'}`}
            subtitle={contacts.length > 0 ? 'Ready to alert' : 'Add contacts'}
          />
          <StatTile
            icon={MapPin}
            tone={locationOk ? 'safe' : loc.state === 'checking' ? 'muted' : 'warning'}
            title={locationOk ? 'GPS Active' : loc.state === 'checking' ? 'Locating…' : loc.state === 'off' ? 'GPS Off' : 'No Signal'}
            subtitle={locationOk ? `±${loc.location?.accuracy ?? '?'} m` : loc.state === 'off' ? 'Allow location' : 'Tap to retry'}
          />
          <StatTile
            icon={BatteryIcon}
            tone={batteryLow ? 'warning' : 'muted'}
            title={battery.level === null ? 'Battery —' : `Battery ${Math.round(battery.level * 100)}%`}
            subtitle={battery.level === null ? 'Not available' : battery.charging ? 'Charging' : batteryLow ? 'Low battery' : 'On battery'}
          />
        </Enter>
        {loc.state === 'error' ? (
          <Pressable accessibilityRole="button" onPress={loc.recheck} hitSlop={6}>
            <VText variant="caption" color={colors.warning} style={{ textAlign: 'center' }}>{loc.error} Tap to retry.</VText>
          </Pressable>
        ) : null}

        <Enter index={2} style={styles.sos}>
          <SOSButton
            isActive={emergency.isActive}
            onTrigger={() => emergency.trigger('button')}
            onAccessibleActivate={() => setShowConfirm(true)}
          />
        </Enter>

        <Enter index={3}>
          <SectionHeader title="Safety Toolkit" right={<Badge text="Coming soon" tone="outline" />} />
          <View style={styles.grid}>
            {TOOLKIT.map((t) => (
              <PressableScale
                key={t.id}
                accessibilityRole="button"
                onPress={() => { haptics.selection(); setComingSoon(t); }}
                style={[styles.toolTile, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <IconTile icon={t.icon} tone="ink" size={38} />
                <VText variant="headline">{t.title}</VText>
                <VText variant="caption" secondary>{t.subtitle}</VText>
              </PressableScale>
            ))}
          </View>
        </Enter>

        <Enter index={4}>
          <Card>
            <View style={styles.recentHeader}>
              <VText variant="headline">Recent Activity</VText>
              {emergency.history.length > 0 && (
                <Pressable accessibilityRole="button" onPress={() => router.push('/history')} hitSlop={10} style={styles.seeAll}>
                  <VText variant="subheadline" weight="semibold">See All</VText>
                  <ChevronRight size={16} color={colors.textPrimary} />
                </Pressable>
              )}
            </View>
            {emergency.history.length === 0 ? (
              <View style={styles.recentRow}>
                <IconTile icon={CircleCheck} tone="safe" size={36} />
                <VText variant="subheadline" secondary style={{ flex: 1 }}>No recent activity. You’re all clear.</VText>
              </View>
            ) : (
              emergency.history.slice(0, 3).map((s) => (
                <View style={styles.recentRow} key={s.id}>
                  <IconTile icon={Siren} tone={s.status === 'resolved' ? 'muted' : 'danger'} size={36} />
                  <View style={{ flex: 1 }}>
                    <VText variant="subheadline" weight="semibold">SOS via {TRIGGER_SOURCE[s.triggerSource] ?? s.triggerSource}</VText>
                    <VText variant="caption" secondary>{formatShortDate(s.startedAt)} · {formatShortTime(s.startedAt)}</VText>
                  </View>
                  <Badge text={STATUS_TEXT[s.status] ?? s.status} tone={STATUS_TONE[s.status] ?? 'muted'} />
                </View>
              ))
            )}
          </Card>
        </Enter>

        <Enter index={5}>
          <View style={[styles.national, { backgroundColor: colors.ink }]}>
            <View style={[styles.nationalIcon, { backgroundColor: colors.danger }]}>
              <Siren size={20} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <VText variant="headline" color={colors.onInk}>National Emergency</VText>
              <VText variant="caption" color={colors.onInk} style={{ opacity: 0.7 }}>Police · Fire · Medical — 112</VText>
            </View>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Call 112"
              onPress={() => { haptics.medium(); Linking.openURL('tel:112'); }}
              style={[styles.callPill, { backgroundColor: colors.onInk }]}
            >
              <Phone size={14} color={colors.ink} />
              <VText variant="caption" color={colors.ink} weight="bold">CALL 112</VText>
            </PressableScale>
          </View>
        </Enter>
      </ScrollView>

      <SOSConfirmSheet
        isOpen={showConfirm && !emergency.isActive}
        onClose={() => setShowConfirm(false)}
        contactCount={contacts.length}
        onConfirm={() => {
          setShowConfirm(false);
          emergency.trigger('button');
        }}
      />

      <BottomSheet isOpen={comingSoon !== null} onClose={() => setComingSoon(null)}>
        <View style={styles.comingSoon}>
          <IconTile icon={Sparkles} tone="ink" size={56} />
          <VText variant="title">{comingSoon?.title}</VText>
          <VText variant="body" secondary style={{ textAlign: 'center' }}>
            This feature is coming in Phase 2 of VISHWAS. We wanted you to see where it’ll live before it’s fully built out.
          </VText>
          <PrimaryButton onPress={() => setComingSoon(null)}>Got it</PrimaryButton>
        </View>
      </BottomSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 10 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  content: { paddingHorizontal: 20, paddingBottom: spacing.xxl, gap: 14 },
  guardRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  guardTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stats: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, padding: 12, gap: 6 },
  sos: { alignItems: 'center', paddingVertical: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  toolTile: { width: '48%', flexGrow: 1, borderRadius: radius.large, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 6 },
  recentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  national: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: radius.large },
  nationalIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  callPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.pill },
  comingSoon: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
});
