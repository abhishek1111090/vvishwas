import { useState } from 'react';
import { View, ScrollView, Pressable, Linking, Platform, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn } from 'react-native-reanimated';
import {
  ShieldCheck, ShieldAlert, Users, MapPin, Battery, BatteryCharging, BatteryLow, BatteryMedium, BatteryFull, BatteryWarning,
  Mic, Timer, PhoneIncoming, BadgeCheck, Route, CircleCheck, Siren, Phone, ChevronRight, Sparkles, Hospital, Shield, Radar,
} from 'lucide-react-native';
import { useEmergency } from '../../context/EmergencyContext';
import { usePermissions } from '../../context/PermissionsContext';
import { useContacts } from '../../context/ContactsContext';
import { useAuth } from '../../context/AuthContext';
import { useBattery, useLocationStatus } from '../../utils/deviceHooks';
import { formatShortTime, formatShortDate } from '../../utils/formatDate';
import { TRIGGER_SOURCE } from '../../utils/constants';
import { haptics } from '../../services/hapticService';
import { COARSE_ACCURACY_M } from '../../services/locationService';
import { VoiceStatus } from '../../services/voiceActivationService';
import { SOSButton } from '../../features/sos/SOSButton';
import { SOSConfirmSheet } from '../../features/sos/SOSConfirmSheet';
import { BottomSheet } from '../../components/BottomSheet';
import { OsmMap } from '../../components/OsmMap';
import { RadialGlow } from '../../components/Glow';
import { Card, Badge, StatusPill, IconTile, Avatar, SectionHeader, PrimaryButton, VText } from '../../components/ui';
import { Enter, PressableScale, PulseDot, AmbientBackground, Float } from '../../components/motion';
import { TAB_BAR_SPACE } from '../../components/FloatingTabBar';
import { useTheme, withAlpha, radius, spacing, elevation } from '../../theme/theme';

const TOOLKIT = [
  { id: 'safetyTimer', title: 'Safety Timer', subtitle: 'Auto-SOS if you don’t check in', icon: Timer, tint: '#F5A524' },
  { id: 'fakeCall', title: 'Fake Call', subtitle: 'Simulate an incoming call', icon: PhoneIncoming, tint: '#2DD46B' },
  { id: 'checkIn', title: 'Check In', subtitle: 'Tell contacts you’re safe', icon: BadgeCheck, tint: '#5AA9FF' },
  { id: 'safeRoute', title: 'Safe Route', subtitle: 'Well-lit, busy pathways', icon: Route, tint: '#B58CFF' },
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

/** Opens the phone's maps app searching for `what` around a position. */
function openNearby(what, loc) {
  haptics.selection();
  const q = encodeURIComponent(what);
  const url = !loc
    ? `https://www.google.com/maps/search/${q}`
    : Platform.OS === 'ios'
      ? `http://maps.apple.com/?q=${q}&sll=${loc.latitude},${loc.longitude}&z=15`
      : `geo:${loc.latitude},${loc.longitude}?q=${q}`;
  Linking.openURL(url).catch(() => Linking.openURL(`https://www.google.com/maps/search/${q}`));
}

function StatTile({ icon: Icon, title, subtitle, color }) {
  const { colors } = useTheme();
  return (
    <Card style={styles.stat}>
      <View style={[styles.statIcon, { backgroundColor: withAlpha(color, 0.14) }]}>
        <Icon size={17} color={color} strokeWidth={2.2} />
      </View>
      <VText variant="headline" numberOfLines={1} style={{ fontSize: 14 }}>{title}</VText>
      <VText variant="caption" numberOfLines={1} color={colors.textSecondary}>{subtitle}</VText>
    </Card>
  );
}

function NearbyButton({ icon: Icon, label, onPress }) {
  const { colors } = useTheme();
  return (
    <PressableScale accessibilityRole="button" onPress={onPress} style={[styles.nearbyBtn, { borderColor: colors.border, backgroundColor: colors.surfaceMuted }]}>
      <Icon size={15} color={colors.textPrimary} />
      <VText variant="caption" weight="semibold">{label}</VText>
    </PressableScale>
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
  const coarse = locationOk && (loc.location.accuracy ?? 0) > COARSE_ACCURACY_M;
  const isProtected = contacts.length > 0 && locationOk;
  const missing = [contacts.length === 0 && 'add a trusted contact', !locationOk && 'turn on location'].filter(Boolean);

  const BatteryIcon = batteryIcon(battery.level, battery.charging);
  const batteryLow = battery.level !== null && battery.level < 0.2 && !battery.charging;
  const guardColor = isProtected ? colors.safe : colors.warning;

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: colors.background }]}>
      <AmbientBackground />
      <View style={styles.topbar}>
        <View style={styles.brand}>
          <VText variant="display" style={styles.wordmark}>Vishwas</VText>
          <VText variant="overline" style={styles.subWordmark}>Personal safety · {isProtected ? 'Active' : 'Setup needed'}</VText>
        </View>
        <View style={styles.topRight}>
          <StatusPill text={isProtected ? 'Active' : 'Setup'} tone={isProtected ? 'safe' : 'warning'} />
          <Pressable accessibilityRole="button" accessibilityLabel="Account" onPress={() => router.navigate('/profile')}>
            <Avatar name={currentUser?.fullName} size={36} tone="muted" />
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Enter index={0}>
          <Card style={styles.guard}>
            <RadialGlow size={220} color={guardColor} opacity={0.22} style={styles.guardGlow} />
            <View style={styles.guardRow}>
              <View style={[styles.guardIcon, { backgroundColor: withAlpha(guardColor, 0.14), borderColor: withAlpha(guardColor, 0.35) }]}>
                {isProtected ? <ShieldCheck size={24} color={guardColor} /> : <ShieldAlert size={24} color={guardColor} />}
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <View style={styles.guardTitle}>
                  <VText variant="headline">System Guard</VText>
                  <View style={[styles.monitorChip, { backgroundColor: withAlpha(guardColor, 0.14) }]}>
                    <PulseDot color={guardColor} size={6} active={isProtected} />
                    <VText variant="overline" color={guardColor} style={{ fontSize: 9 }}>{isProtected ? 'Monitoring' : 'Setup'}</VText>
                  </View>
                </View>
                <VText variant="caption" secondary>
                  {isProtected
                    ? 'Location, guardians and evidence capture are ready.'
                    : `To be fully protected, ${missing.join(' and ')}.`}
                </VText>
              </View>
            </View>
          </Card>
        </Enter>

        <Enter index={1} style={styles.stats}>
          <StatTile
            icon={Users}
            color={contacts.length > 0 ? colors.textPrimary : colors.warning}
            title={`${contacts.length} Guardian${contacts.length === 1 ? '' : 's'}`}
            subtitle={contacts.length > 0 ? 'Ready to alert' : 'Add contacts'}
          />
          <StatTile
            icon={MapPin}
            color={locationOk ? colors.safe : loc.state === 'checking' ? colors.textSecondary : colors.warning}
            title={locationOk ? 'GPS Active' : loc.state === 'checking' ? 'Locating…' : loc.state === 'off' ? 'GPS Off' : 'No Signal'}
            subtitle={locationOk ? `±${loc.location?.accuracy ?? '?'} m` : loc.state === 'off' ? 'Allow location' : 'Tap to retry'}
          />
          <StatTile
            icon={BatteryIcon}
            color={batteryLow ? colors.warning : colors.textPrimary}
            title={battery.level === null ? 'Battery —' : `Battery ${Math.round(battery.level * 100)}%`}
            subtitle={battery.level === null ? 'Not available' : battery.charging ? 'Charging' : batteryLow ? 'Low battery' : 'Power optimal'}
          />
        </Enter>
        {coarse ? (
          <Pressable accessibilityRole="button" onPress={() => Linking.openSettings()} style={[styles.coarse, { backgroundColor: colors.warningTint, borderColor: withAlpha(colors.warning, 0.4) }]}>
            <MapPin size={16} color={colors.warning} />
            <VText variant="caption" color={colors.warning} style={{ flex: 1 }}>
              Your phone is only giving an approximate location (±{loc.location.accuracy} m). {Platform.OS === 'ios'
                ? 'Turn on Settings → VISHWAS/Expo Go → Location → Precise Location.'
                : 'Turn on "Use precise location" for this app in Settings.'} Tap to open Settings.
            </VText>
          </Pressable>
        ) : null}
        {loc.state === 'error' ? (
          <Pressable accessibilityRole="button" onPress={loc.recheck} hitSlop={6}>
            <VText variant="caption" color={colors.warning} style={{ textAlign: 'center' }}>{loc.error} Tap to retry.</VText>
          </Pressable>
        ) : null}

        <Enter index={2}>
          <View style={[styles.hero, { backgroundColor: colors.surface, borderColor: 'rgba(255,255,255,0.85)' }, elevation.card]}>
            <Float distance={4} style={styles.sos}>
              <SOSButton
                isActive={emergency.isActive}
                onTrigger={() => emergency.trigger('button')}
                onAccessibleActivate={() => setShowConfirm(true)}
              />
            </Float>
            <View style={styles.heroActions}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Call 112, national emergency"
                onPress={() => { haptics.medium(); Linking.openURL('tel:112'); }}
                style={[styles.blackPill, { backgroundColor: colors.ink }]}
              >
                <VText variant="overline" color={colors.onInk} style={{ fontSize: 10 }}>Emergency · Call 112</VText>
              </PressableScale>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Call 112"
                onPress={() => { haptics.medium(); Linking.openURL('tel:112'); }}
                scaleTo={0.9}
                style={[styles.roundBtn, { backgroundColor: colors.ink }]}
              >
                <Phone size={18} color={colors.onInk} />
              </PressableScale>
            </View>
          </View>
          {emergency.voice.status === VoiceStatus.listening ? (
            <Animated.View entering={FadeIn.duration(400)} style={[styles.voiceChip, { backgroundColor: withAlpha(colors.safe, 0.12), borderColor: withAlpha(colors.safe, 0.35) }]}>
              <PulseDot color={colors.safe} size={7} active />
              <Mic size={14} color={colors.safe} />
              <VText variant="caption" weight="semibold" color={colors.safe}>Voice SOS · say “{emergency.voice.phrase}”</VText>
            </Animated.View>
          ) : null}
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
                <View style={[styles.toolIcon, { backgroundColor: withAlpha(t.tint, 0.14) }]}>
                  <t.icon size={19} color={t.tint} strokeWidth={2.2} />
                </View>
                <VText variant="headline">{t.title}</VText>
                <VText variant="caption" secondary>{t.subtitle}</VText>
              </PressableScale>
            ))}
          </View>
        </Enter>

        <Enter index={4}>
          <Card style={{ gap: 12 }}>
            <View style={styles.cardHead}>
              <View style={[styles.statIcon, { backgroundColor: colors.surfaceMuted }]}><Radar size={17} color={colors.textPrimary} /></View>
              <View style={{ flex: 1 }}>
                <VText variant="headline">Your Surroundings</VText>
                <VText variant="caption" secondary>
                  {locationOk ? `Live position · ±${loc.location.accuracy} m` : 'Turn on location to see the map'}
                </VText>
              </View>
              {locationOk ? <StatusPill text="Live" tone="safe" /> : null}
            </View>
            {locationOk ? (
              <Animated.View entering={FadeIn.duration(500)}>
                <OsmMap latitude={loc.location.latitude} longitude={loc.location.longitude} accuracy={loc.location.accuracy} height={150} color={colors.safe} tone="light" />
              </Animated.View>
            ) : (
              <View style={[styles.mapEmpty, { backgroundColor: colors.surfaceMuted }]}>
                <MapPin size={22} color={colors.textTertiary} />
              </View>
            )}
            <View style={styles.nearbyRow}>
              <NearbyButton icon={Shield} label="Police nearby" onPress={() => openNearby('police station', loc.location)} />
              <NearbyButton icon={Hospital} label="Hospitals nearby" onPress={() => openNearby('hospital', loc.location)} />
            </View>
          </Card>
        </Enter>

        <Enter index={5}>
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
                    <VText variant="caption" secondary numberOfLines={1}>
                      {formatShortDate(s.startedAt)} · {formatShortTime(s.startedAt)}{s.address?.label ? ` · ${s.address.label}` : ''}
                    </VText>
                  </View>
                  <Badge text={STATUS_TEXT[s.status] ?? s.status} tone={STATUS_TONE[s.status] ?? 'muted'} />
                </View>
              ))
            )}
          </Card>
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
  brand: { gap: 0 },
  wordmark: { fontSize: 30, lineHeight: 32, letterSpacing: -0.8 },
  subWordmark: { fontSize: 9, letterSpacing: 2.4, marginTop: 2 },
  hero: { borderRadius: 32, borderWidth: 1, paddingTop: 18, paddingBottom: 16, paddingHorizontal: 16, overflow: 'hidden' },
  heroActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  blackPill: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999 },
  roundBtn: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  content: { paddingHorizontal: 18, paddingBottom: TAB_BAR_SPACE, gap: 14 },
  guard: { overflow: 'hidden' },
  guardGlow: { position: 'absolute', left: -70, top: -90 },
  guardRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  guardIcon: { width: 50, height: 50, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  guardTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  monitorChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  stats: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, padding: 12, gap: 6 },
  statIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  coarse: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.medium, borderWidth: 1 },
  voiceChip: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1 },
  sos: { alignItems: 'center', paddingVertical: 34 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  toolTile: { width: '48%', flexGrow: 1, borderRadius: radius.large, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 6 },
  toolIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mapEmpty: { height: 110, borderRadius: radius.medium, alignItems: 'center', justifyContent: 'center' },
  nearbyRow: { flexDirection: 'row', gap: 10 },
  nearbyBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 42, borderRadius: radius.pill, borderWidth: 1 },
  recentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  comingSoon: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
});
