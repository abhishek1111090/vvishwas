import { useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ShieldAlert, ShieldCheck, TriangleAlert, Users, MapPin, AudioLines, CircleCheck,
  Battery, BatteryCharging, BatteryWarning, BatteryLow, BatteryMedium, BatteryFull,
  Timer, PhoneIncoming, BadgeCheck, Map, Sparkles,
} from 'lucide-react-native';
import { useEmergency } from '../../context/EmergencyContext';
import { usePermissions } from '../../context/PermissionsContext';
import { useContacts } from '../../context/ContactsContext';
import { useBattery, useLocationStatus } from '../../utils/deviceHooks';
import { formatShortTime, formatShortDate } from '../../utils/formatDate';
import { TRIGGER_SOURCE, SESSION_STATUS } from '../../utils/constants';
import { SOSButton } from '../../features/sos/SOSButton';
import { SOSConfirmSheet } from '../../features/sos/SOSConfirmSheet';
import { BottomSheet } from '../../components/BottomSheet';
import { Card, StatusPill, IconBadge, PrimaryButton, VText } from '../../components/ui';
import { useTheme, withAlpha, radius, spacing } from '../../theme/theme';

const QUICK_ACTIONS = [
  { id: 'safetyTimer', title: 'Safety Timer', subtitle: "Auto-SOS if you don't check in", icon: Timer, tint: '#ff9500' },
  { id: 'fakeCall', title: 'Fake Call', subtitle: 'Simulate an incoming call', icon: PhoneIncoming, tint: '#af52de' },
  { id: 'checkIn', title: 'Check In', subtitle: "Tell contacts you're safe", icon: BadgeCheck, tint: '#34c759' },
  { id: 'safeRoute', title: 'Safe Route', subtitle: 'Find a well-lit, busy path', icon: Map, tint: '#0a84ff' },
];

const LOCATION_LABEL = { ok: 'Location OK', checking: 'Locating…', error: 'No Location', off: 'Location Off' };

function batteryIcon(level, charging) {
  if (level === null) return Battery;
  if (charging) return BatteryCharging;
  if (level < 0.2) return BatteryWarning;
  if (level < 0.5) return BatteryLow;
  if (level < 0.8) return BatteryMedium;
  return BatteryFull;
}

function StatusItem({ icon: Icon, label, tint, onPress, accessibilityHint }) {
  const content = (
    <>
      <Icon size={18} color={tint} strokeWidth={2.25} />
      <VText variant="caption" secondary numberOfLines={1}>{label}</VText>
    </>
  );
  if (onPress) {
    return (
      <Pressable accessibilityRole="button" accessibilityHint={accessibilityHint} onPress={onPress} style={styles.statusItem}>
        {content}
      </Pressable>
    );
  }
  return <View style={styles.statusItem}>{content}</View>;
}

export default function Home() {
  const { colors } = useTheme();
  const router = useRouter();
  const emergency = useEmergency();
  const { statuses } = usePermissions();
  const { contacts } = useContacts();
  const battery = useBattery();
  const loc = useLocationStatus(statuses.location);
  const [showConfirm, setShowConfirm] = useState(false);
  const [comingSoon, setComingSoon] = useState(null);

  const isProtected = contacts.length > 0 && loc.state === 'ok';
  const isRecording = emergency.audio.status === 'recording' || emergency.video.status === 'recording';
  const BatteryIcon = batteryIcon(battery.level, battery.charging);

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.topbar}>
        <View style={styles.brand}>
          <View style={[styles.logo, { backgroundColor: withAlpha(colors.accent, 0.12) }]}>
            <ShieldAlert size={20} strokeWidth={2.4} color={colors.accent} />
          </View>
          <VText variant="headline" style={{ fontWeight: '800' }}>VISHWAS</VText>
        </View>
        <StatusPill text={isProtected ? 'Protected' : 'Setup Needed'} color={isProtected ? colors.safe : colors.warning} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <View style={{ gap: spacing.md }}>
            {isRecording ? (
              <StatusPill text="Recording Active" color={colors.emergency} icon={AudioLines} />
            ) : (
              <StatusPill
                text={isProtected ? 'Protected' : 'Setup Needed'}
                color={isProtected ? colors.safe : colors.warning}
                icon={isProtected ? ShieldCheck : TriangleAlert}
              />
            )}
            <View style={styles.statusRow}>
              <StatusItem
                icon={Users}
                label={`${contacts.length} Contact${contacts.length === 1 ? '' : 's'}`}
                tint={contacts.length > 0 ? colors.info : colors.warning}
              />
              <StatusItem
                icon={MapPin}
                label={LOCATION_LABEL[loc.state]}
                tint={loc.state === 'ok' ? colors.safe : loc.state === 'checking' ? colors.textSecondary : colors.warning}
                onPress={loc.state === 'error' ? loc.recheck : undefined}
                accessibilityHint="Retries getting your location"
              />
              <StatusItem
                icon={BatteryIcon}
                label={battery.level === null ? '—' : `${Math.round(battery.level * 100)}%`}
                tint={battery.level !== null && battery.level < 0.2 && !battery.charging ? colors.warning : colors.textSecondary}
              />
            </View>
            {loc.state === 'error' && loc.error ? (
              <VText variant="caption" color={colors.warning}>{loc.error} Tap “No Location” to retry.</VText>
            ) : null}
          </View>
        </Card>

        <View style={styles.sos}>
          <SOSButton isActive={emergency.isActive} onPress={() => { if (!emergency.isActive) setShowConfirm(true); }} />
          <VText variant="caption" secondary style={{ textAlign: 'center' }}>
            Tap button for emergency · Triple-tap anywhere for instant SOS
          </VText>
        </View>

        <View style={styles.grid}>
          {QUICK_ACTIONS.map((a) => (
            <Pressable
              key={a.id}
              accessibilityRole="button"
              onPress={() => setComingSoon(a)}
              style={({ pressed }) => [styles.tile, { backgroundColor: colors.backgroundSecondary, opacity: pressed ? 0.8 : 1 }]}
            >
              <IconBadge icon={a.icon} tint={a.tint} />
              <VText variant="headline">{a.title}</VText>
              <VText variant="caption" secondary>{a.subtitle}</VText>
            </Pressable>
          ))}
        </View>

        <Card>
          <View style={{ gap: spacing.sm }}>
            <View style={styles.recentHeader}>
              <VText variant="headline">Recent Activity</VText>
              {emergency.history.length > 0 && (
                <Pressable accessibilityRole="button" onPress={() => router.push('/history')} hitSlop={10}>
                  <VText variant="subheadline" color={colors.accent} style={{ fontWeight: '600' }}>See All</VText>
                </Pressable>
              )}
            </View>
            {emergency.history.length === 0 ? (
              <View style={styles.recentRow}>
                <CircleCheck size={18} color={colors.textSecondary} />
                <VText variant="subheadline" secondary>No recent activity. You’re all clear.</VText>
              </View>
            ) : (
              emergency.history.slice(0, 3).map((s) => {
                const st = SESSION_STATUS[s.status] ?? { text: s.status, color: colors.textSecondary };
                return (
                  <View style={styles.recentRow} key={s.id}>
                    <VText variant="caption" secondary style={styles.recentTime}>
                      {formatShortDate(s.startedAt)}{'\n'}{formatShortTime(s.startedAt)}
                    </VText>
                    <VText variant="subheadline" style={{ flex: 1 }}>SOS via {TRIGGER_SOURCE[s.triggerSource] ?? s.triggerSource}</VText>
                    <VText variant="caption" color={st.color} style={{ fontWeight: '700' }}>{st.text}</VText>
                  </View>
                );
              })
            )}
          </View>
        </Card>
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
          <View style={[styles.sparkle, { backgroundColor: withAlpha(colors.accent, 0.12) }]}>
            <Sparkles size={28} color={colors.accent} />
          </View>
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
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logo: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  statusRow: { flexDirection: 'row', justifyContent: 'space-around' },
  statusItem: { flex: 1, alignItems: 'center', gap: 4, minHeight: 44, justifyContent: 'center' },
  sos: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { width: '48%', flexGrow: 1, borderRadius: radius.large, padding: spacing.md, gap: 6 },
  recentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  recentTime: { width: 64 },
  comingSoon: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  sparkle: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
});
