import { useEffect, useRef } from 'react';
import { View, ScrollView, Pressable, BackHandler, Alert, Linking, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView } from 'expo-camera';
import { MapPin, MessageSquare, RotateCcw } from 'lucide-react-native';
import { useEmergency } from '../../context/EmergencyContext';
import { emergencyController } from '../../services/emergencyController';
import { recordingService } from '../../services/recordingService';
import { mapsUrl } from '../../services/locationService';
import { AlertStatus, ALERT_STATUS_LABEL, CONFIRMED_STATUSES } from '../../services/alertService';
import { haptics } from '../../services/hapticService';
import { TRIGGER_SOURCE } from '../../utils/constants';
import { formatShortTime, formatStandardTime } from '../../utils/formatDate';
import { PrimaryButton, SecondaryButton, VText } from '../../components/ui';
import { useTheme, radius, spacing } from '../../theme/theme';

/**
 * EmergencyOverlay — full screen while an SOS session is active
 * (mirrors EmergencyActiveView.swift). Everything shown comes from real
 * service state. The only ways out are "I'm Safe" and "False Alarm"; the
 * Android back button is swallowed while this is mounted.
 */

const RECORDING_TEXT = {
  idle: 'Idle',
  requesting: 'Starting…',
  recording: 'Recording',
  stopping: 'Saving…',
  saved: 'Saved on phone',
  error: 'Unavailable',
};

function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <VText variant="caption" secondary style={styles.sectionTitle}>{title}</VText>
      {children}
    </View>
  );
}

function RecordingBadge({ label, state }) {
  const { colors } = useTheme();
  let color = colors.textSecondary;
  if (state.status === 'recording') color = '#ff3b30';
  if (state.status === 'saved') color = colors.safe;
  if (state.status === 'error') color = colors.warning;
  return (
    <View style={[styles.badge, { borderColor: color, backgroundColor: colors.backgroundSecondary }]}>
      <View style={styles.badgeRow}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <VText variant="subheadline" color={color} style={{ fontWeight: '600' }}>{label} {RECORDING_TEXT[state.status] ?? state.status}</VText>
      </View>
      {state.interrupted ? <VText variant="caption" color={colors.warning}>Interrupted by the system</VText> : null}
      {state.status === 'error' && state.error ? <VText variant="caption" color={colors.warning}>{state.error}</VText> : null}
    </View>
  );
}

function EvidenceCamera() {
  const ref = useRef(null);
  useEffect(() => () => recordingService.attachCamera(null), []);
  return (
    <CameraView
      ref={ref}
      style={styles.camera}
      facing="back"
      mode="video"
      mute
      onCameraReady={() => {
        recordingService.attachCamera(ref.current);
        emergencyController.onCameraReady();
      }}
      onMountError={(e) => emergencyController.onCameraError(e?.message ?? 'Camera could not start')}
    />
  );
}

export function EmergencyOverlay() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const {
    activeSession, log, alerts, isEnding,
    location, locationStatus, locationError,
    audio, video, cameraAllowed,
    resolve, cancel, openSmsComposer, restartRecording,
  } = useEmergency();

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  if (!activeSession) return null;
  const loc = location ?? activeSession.location;

  const canTextContacts =
    !isEnding &&
    !!alerts &&
    alerts.status !== AlertStatus.noContacts &&
    alerts.status !== AlertStatus.sending &&
    !(alerts.recipients ?? []).every((r) => CONFIRMED_STATUSES.includes(r.status));

  const live = (s) => s === 'recording' || s === 'requesting';
  const recordingDown = !isEnding && (!live(audio.status) || (cameraAllowed && !live(video.status)));

  function confirmCancel() {
    Alert.alert(
      'Cancel this emergency?',
      'This stops recording and location sharing now. Only do this if you triggered SOS by accident. Anything already recorded is kept.',
      [
        { text: 'Keep Emergency', style: 'cancel' },
        { text: 'Cancel Emergency', style: 'destructive', onPress: () => { haptics.warning(); cancel(); } },
      ]
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]} accessibilityViewIsModal testID="emergency-overlay">
      <View style={[styles.header, { backgroundColor: colors.emergency, paddingTop: insets.top + spacing.md }]}>
        <VText variant="title" color="#fff">🚨 Emergency Active</VText>
        <VText variant="caption" color="rgba(255,255,255,0.85)">
          {TRIGGER_SOURCE[activeSession.triggerSource] ?? activeSession.triggerSource} · {formatShortTime(activeSession.startedAt)}
        </VText>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Section title="LIVE LOCATION">
          <View style={[styles.box, { backgroundColor: colors.backgroundSecondary }]}>
            <MapPin size={16} color={loc ? colors.safe : colors.warning} />
            {loc ? (
              <View style={{ flex: 1, gap: 2 }}>
                <VText variant="subheadline" style={styles.mono}>{loc.latitude.toFixed(6)}, {loc.longitude.toFixed(6)}</VText>
                <VText variant="caption" secondary>
                  ±{loc.accuracy}m{loc.timestamp ? ` · ${formatShortTime(loc.timestamp)}` : ''}
                </VText>
                {locationStatus === 'error' && locationError ? (
                  <VText variant="caption" color={colors.warning}>Last known position — {locationError}</VText>
                ) : null}
                <Pressable accessibilityRole="link" onPress={() => Linking.openURL(mapsUrl(loc))} hitSlop={8}>
                  <VText variant="caption" color={colors.accent}>Open in Maps ↗</VText>
                </Pressable>
              </View>
            ) : (
              <VText variant="subheadline" color={locationStatus === 'error' ? colors.warning : colors.textSecondary} style={{ flex: 1 }}>
                {locationStatus === 'error' ? locationError ?? 'GPS unavailable' : 'Acquiring GPS signal…'}
              </VText>
            )}
          </View>
        </Section>

        <Section title="CONTACT ALERTS">
          {!alerts && <VText variant="subheadline" secondary>Preparing alert…</VText>}
          {alerts?.status === AlertStatus.noContacts && (
            <VText variant="subheadline" color={colors.emergency} style={{ fontWeight: '600' }}>
              No emergency contacts saved — nobody was alerted.
            </VText>
          )}
          {(alerts?.recipients ?? []).map((r) => {
            const ok = CONFIRMED_STATUSES.includes(r.status);
            const bad = [AlertStatus.failed, AlertStatus.manualRequired, AlertStatus.cancelled, AlertStatus.unavailable].includes(r.status);
            return (
              <View key={r.phoneNumber} style={[styles.alertRow, { backgroundColor: colors.backgroundSecondary }]}>
                <VText variant="subheadline" style={{ fontWeight: '600', flex: 1 }}>{r.name}</VText>
                <VText variant="caption" color={ok ? colors.safe : bad ? colors.emergency : colors.warning} style={styles.alertStatus}>
                  {ALERT_STATUS_LABEL[r.status] ?? r.status}
                </VText>
              </View>
            );
          })}
          {canTextContacts && (
            <SecondaryButton icon={MessageSquare} onPress={openSmsComposer}>Text contacts</SecondaryButton>
          )}
        </Section>

        <Section title="EVIDENCE RECORDING">
          {/* Stays mounted while ending: unmounting would cut the video short. */}
          {cameraAllowed ? <EvidenceCamera /> : null}
          <RecordingBadge label="Audio" state={audio} />
          <RecordingBadge label="Video" state={video} />
          {recordingDown && <SecondaryButton icon={RotateCcw} onPress={restartRecording}>Restart recording</SecondaryButton>}
        </Section>

        <Section title="ACTIVITY LOG">
          {log.map((entry) => (
            <View key={entry.id} style={styles.logRow}>
              <VText variant="caption" secondary style={styles.logTime}>{formatStandardTime(entry.timestamp)}</VText>
              <VText
                variant="caption"
                color={entry.level === 'error' ? colors.emergency : entry.level === 'warning' ? colors.warning : colors.textPrimary}
                style={{ flex: 1 }}
              >
                {entry.message}
              </VText>
            </View>
          ))}
        </Section>
      </ScrollView>

      <View style={[styles.actions, { borderTopColor: colors.separator, paddingBottom: insets.bottom + spacing.md }]}>
        <PrimaryButton onPress={() => { haptics.success(); resolve(); }} loading={isEnding} disabled={isEnding}>
          {isEnding ? 'Ending emergency…' : "✅ I'm Safe — End Emergency"}
        </PrimaryButton>
        <SecondaryButton onPress={confirmCancel} disabled={isEnding}>False Alarm — Cancel</SecondaryButton>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { alignItems: 'center', gap: 4, paddingBottom: spacing.lg, paddingHorizontal: spacing.lg },
  body: { padding: spacing.lg, gap: spacing.lg },
  section: { gap: 8 },
  sectionTitle: { fontWeight: '700', letterSpacing: 0.6 },
  box: { flexDirection: 'row', gap: 8, padding: 12, borderRadius: radius.small, alignItems: 'flex-start' },
  mono: { fontVariant: ['tabular-nums'], fontWeight: '600' },
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: radius.small },
  alertStatus: { fontWeight: '600', textAlign: 'right', flexShrink: 1 },
  camera: { height: 180, borderRadius: radius.medium, overflow: 'hidden' },
  badge: { borderWidth: 1.5, borderRadius: radius.small, padding: 10, gap: 2 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  logRow: { flexDirection: 'row', gap: 8 },
  logTime: { width: 84, fontVariant: ['tabular-nums'] },
  actions: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
});
