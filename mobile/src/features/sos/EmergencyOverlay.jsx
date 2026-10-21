import { useEffect, useRef, useState } from 'react';
import { View, ScrollView, Pressable, BackHandler, Alert, Linking, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView } from 'expo-camera';
import { StatusBar } from 'expo-status-bar';
import Animated, { FadeInDown, FadeIn, useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing, cancelAnimation } from 'react-native-reanimated';
import { MapPin, MessageSquare, RotateCcw, Navigation, Mic, Video, ShieldCheck, Siren, X, ChevronDown, ChevronUp } from 'lucide-react-native';
import { useEmergency } from '../../context/EmergencyContext';
import { emergencyController } from '../../services/emergencyController';
import { recordingService } from '../../services/recordingService';
import { mapsUrl } from '../../services/locationService';
import { AlertStatus, ALERT_STATUS_LABEL, CONFIRMED_STATUSES } from '../../services/alertService';
import { haptics } from '../../services/hapticService';
import { TRIGGER_SOURCE } from '../../utils/constants';
import { formatShortTime, formatStandardTime } from '../../utils/formatDate';
import { RadarPing, RecDot, PressableScale } from '../../components/motion';
import { palettes, font, fonts, radius, spacing } from '../../theme/theme';

/**
 * EmergencyOverlay — full screen while an SOS session is active
 * (mirrors EmergencyActiveView.swift). Always dark, so it reads as a
 * different "mode" at a glance. Everything shown comes from real service
 * state. The only ways out are "I'm Safe" and "False Alarm"; the Android
 * back button is swallowed while this is mounted.
 */

const c = palettes.dark;

const RECORDING_TEXT = {
  idle: 'Idle',
  requesting: 'Starting…',
  recording: 'Recording',
  stopping: 'Saving…',
  saved: 'Saved on phone',
  error: 'Unavailable',
};

function T({ variant = 'body', color = c.textPrimary, weight, style, children, ...rest }) {
  const w = weight ? { fontFamily: fonts[weight] } : null;
  return <Text style={[font[variant], w, { color }, style]} {...rest}>{children}</Text>;
}

function DarkCard({ children, style, index = 0, animated = true }) {
  // The camera preview (a native surface) can render black on Android when
  // its parent runs a layout animation, so that card opts out.
  if (!animated) return <View style={[styles.card, style]}>{children}</View>;
  return (
    <Animated.View
      entering={FadeInDown.duration(420).delay(120 + index * 80).easing(Easing.out(Easing.cubic))}
      style={[styles.card, style]}
    >
      {children}
    </Animated.View>
  );
}

function useElapsed(startIso) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.floor((now - new Date(startIso).getTime()) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function Beacon() {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withRepeat(withTiming(1, { duration: 1200, easing: Easing.out(Easing.quad) }), -1, false);
    return () => cancelAnimation(v);
  }, [v]);
  const halo = useAnimatedStyle(() => ({ opacity: (1 - v.value) * 0.6, transform: [{ scale: 1 + v.value * 0.9 }] }));
  return (
    <View style={styles.beacon}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.beaconHalo, halo]} />
      <View style={styles.beaconCore}>
        <Siren size={20} color={c.danger} />
      </View>
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

function EvidenceRow({ icon: Icon, label, state, offNote }) {
  const live = state.status === 'recording';
  const off = offNote && state.status === 'idle';
  const color = live ? c.danger : state.status === 'saved' ? c.safe : state.status === 'error' ? c.warning : c.textSecondary;
  return (
    <View style={styles.evRow}>
      <View style={styles.evIcon}><Icon size={18} color={c.textPrimary} /></View>
      <View style={{ flex: 1 }}>
        <T variant="subheadline" weight="semibold">{label}</T>
        <T variant="caption" color={state.status === 'error' ? c.warning : c.textSecondary}>
          {off ? offNote : state.status === 'error' && state.error ? state.error : state.interrupted ? 'Interrupted by the system' : 'Private to this phone'}
        </T>
      </View>
      <View style={[styles.evStatus, { borderColor: color }]}>
        {live ? <RecDot color={c.danger} size={7} /> : <View style={[styles.dot, { backgroundColor: color }]} />}
        <T variant="caption" color={color} weight="semibold">{live ? 'REC' : off ? 'Off' : RECORDING_TEXT[state.status] ?? state.status}</T>
      </View>
    </View>
  );
}

export function EmergencyOverlay() {
  const insets = useSafeAreaInsets();
  const {
    activeSession, log, alerts, isEnding,
    location, locationStatus, locationError,
    audio, video, cameraAllowed,
    resolve, cancel, openSmsComposer, restartRecording,
  } = useEmergency();
  const [showLog, setShowLog] = useState(false);
  const elapsed = useElapsed(activeSession?.startedAt ?? new Date().toISOString());

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  if (!activeSession) return null;
  const loc = location ?? activeSession.location;

  const recipients = alerts?.recipients ?? [];
  const confirmedCount = recipients.filter((r) => CONFIRMED_STATUSES.includes(r.status)).length;
  const canTextContacts =
    !isEnding && !!alerts && alerts.status !== AlertStatus.noContacts && alerts.status !== AlertStatus.sending &&
    !recipients.every((r) => CONFIRMED_STATUSES.includes(r.status));

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
    <Animated.View entering={FadeIn.duration(250)} style={[styles.screen, { paddingTop: insets.top }]} accessibilityViewIsModal testID="emergency-overlay">
      <StatusBar style="light" />
      <View style={styles.topbar}>
        <T variant="headline" weight="heavy" style={{ letterSpacing: 0.5 }}>VISHWAS</T>
        <View style={styles.timerPill}>
          <RecDot color={c.danger} size={6} />
          <T variant="caption" weight="bold" color="#fff" style={{ fontVariant: ['tabular-nums'] }}>{elapsed}</T>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInDown.duration(450).easing(Easing.out(Easing.cubic))} style={styles.hero}>
          <View style={{ flex: 1, gap: 6 }}>
            <View style={styles.heroChip}><T variant="overline" color="#fff" style={{ fontSize: 9 }}>Priority dispatch</T></View>
            <T variant="title" weight="heavy" color="#fff" style={{ fontSize: 26 }}>🚨 Emergency Active</T>
            <T variant="caption" color="rgba(255,255,255,0.85)">
              Triggered via {TRIGGER_SOURCE[activeSession.triggerSource] ?? activeSession.triggerSource} · {formatShortTime(activeSession.startedAt)}
            </T>
          </View>
          <Beacon />
        </Animated.View>

        <DarkCard index={0}>
          <View style={styles.cardHead}>
            <View style={styles.headIcon}><Navigation size={16} color={c.textPrimary} /></View>
            <View style={{ flex: 1 }}>
              <T variant="headline">Live Location</T>
              <T variant="caption" color={c.textSecondary}>
                {loc ? `Updated ${formatShortTime(loc.timestamp)}` : locationStatus === 'error' ? 'Location problem' : 'Acquiring GPS signal…'}
              </T>
            </View>
            {loc && locationStatus !== 'error' ? (
              <View style={[styles.liveChip, { backgroundColor: c.safeTint }]}>
                <RecDot color={c.safe} size={6} />
                <T variant="caption" color={c.safe} weight="bold">LIVE</T>
              </View>
            ) : null}
          </View>
          <View style={styles.radarBox}>
            <RadarPing color={loc ? c.safe : c.warning} size={130} active />
            <View style={{ flex: 1, gap: 4 }}>
              {loc ? (
                <>
                  <T variant="headline" style={{ fontVariant: ['tabular-nums'] }}>{loc.latitude.toFixed(5)}°</T>
                  <T variant="headline" style={{ fontVariant: ['tabular-nums'] }}>{loc.longitude.toFixed(5)}°</T>
                  <T variant="caption" color={c.textSecondary}>Accuracy ±{loc.accuracy} m</T>
                </>
              ) : (
                <T variant="subheadline" color={locationStatus === 'error' ? c.warning : c.textSecondary}>
                  {locationStatus === 'error' ? locationError ?? 'GPS unavailable' : 'Waiting for the first fix…'}
                </T>
              )}
              {loc && locationStatus === 'error' && locationError ? (
                <T variant="caption" color={c.warning}>Last known position — {locationError}</T>
              ) : null}
            </View>
          </View>
          {loc ? (
            <PressableScale accessibilityRole="link" onPress={() => Linking.openURL(mapsUrl(loc))} style={styles.mapsBtn}>
              <MapPin size={14} color={c.ink} />
              <T variant="caption" color={c.onInk} weight="bold">Open in Maps</T>
            </PressableScale>
          ) : null}
        </DarkCard>

        <DarkCard index={1}>
          <View style={styles.cardHead}>
            <View style={styles.headIcon}><ShieldCheck size={16} color={c.textPrimary} /></View>
            <View style={{ flex: 1 }}>
              <T variant="headline">Guardians Notified{recipients.length ? ` (${confirmedCount}/${recipients.length})` : ''}</T>
              <T variant="caption" color={c.textSecondary}>Shows only what was actually confirmed</T>
            </View>
          </View>
          {!alerts && <T variant="subheadline" color={c.textSecondary}>Preparing alert…</T>}
          {alerts?.status === AlertStatus.noContacts && (
            <T variant="subheadline" color={c.danger} weight="semibold">No emergency contacts saved — nobody was alerted.</T>
          )}
          {recipients.map((r) => {
            const ok = CONFIRMED_STATUSES.includes(r.status);
            const bad = [AlertStatus.failed, AlertStatus.manualRequired, AlertStatus.cancelled, AlertStatus.unavailable].includes(r.status);
            const col = ok ? c.safe : bad ? c.danger : c.warning;
            return (
              <View key={r.phoneNumber} style={styles.guardian}>
                <View style={styles.gAvatar}><T variant="caption" weight="bold">{r.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}</T></View>
                <View style={{ flex: 1 }}>
                  <T variant="subheadline" weight="semibold">{r.name}</T>
                  <T variant="caption" color={col}>{ALERT_STATUS_LABEL[r.status] ?? r.status}</T>
                </View>
                <View style={[styles.dot, { backgroundColor: col }]} />
              </View>
            );
          })}
          {canTextContacts && (
            <PressableScale accessibilityRole="button" onPress={openSmsComposer} style={styles.outlineBtn}>
              <MessageSquare size={16} color={c.textPrimary} />
              <T variant="subheadline" weight="semibold">Text contacts</T>
            </PressableScale>
          )}
        </DarkCard>

        <DarkCard index={2} animated={false}>
          <View style={styles.cardHead}>
            <View style={styles.headIcon}><Video size={16} color={c.textPrimary} /></View>
            <View style={{ flex: 1 }}>
              <T variant="headline">Evidence Vault</T>
              <T variant="caption" color={c.textSecondary}>Saved privately on this phone</T>
            </View>
          </View>
          {/* Stays mounted while ending: unmounting would cut the video short. */}
          {cameraAllowed ? <EvidenceCamera /> : null}
          <EvidenceRow icon={Mic} label="Audio Recording" state={audio} />
          <EvidenceRow icon={Video} label="Rear Camera Video" state={video} offNote={cameraAllowed ? null : 'Camera access not allowed'} />
          {recordingDown && (
            <PressableScale accessibilityRole="button" onPress={restartRecording} style={styles.outlineBtn}>
              <RotateCcw size={16} color={c.textPrimary} />
              <T variant="subheadline" weight="semibold">Restart recording</T>
            </PressableScale>
          )}
        </DarkCard>

        <DarkCard index={3}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: showLog }} onPress={() => setShowLog((v) => !v)} style={styles.cardHead}>
            <T variant="headline" style={{ flex: 1 }}>Activity Log</T>
            <T variant="caption" color={c.textSecondary}>{log.length} events</T>
            {showLog ? <ChevronUp size={18} color={c.textSecondary} /> : <ChevronDown size={18} color={c.textSecondary} />}
          </Pressable>
          {(showLog ? log : log.slice(-3)).map((entry) => (
            <Animated.View key={entry.id} entering={FadeIn.duration(300)} style={styles.logRow}>
              <T variant="caption" color={c.textTertiary} style={styles.logTime}>{formatStandardTime(entry.timestamp)}</T>
              <T
                variant="caption"
                color={entry.level === 'error' ? c.danger : entry.level === 'warning' ? c.warning : c.textPrimary}
                style={{ flex: 1 }}
              >
                {entry.message}
              </T>
            </Animated.View>
          ))}
        </DarkCard>
      </ScrollView>

      <View style={[styles.actions, { paddingBottom: insets.bottom + spacing.md }]}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="I'm Safe — End Emergency"
          disabled={isEnding}
          onPress={() => { haptics.success(); resolve(); }}
          style={[styles.safeBtn, isEnding && { opacity: 0.6 }]}
        >
          <ShieldCheck size={18} color={c.onInk} />
          <T variant="headline" color={c.onInk}>{isEnding ? 'Ending emergency…' : "I'm Safe — End Emergency"}</T>
        </PressableScale>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="False Alarm — Cancel"
          disabled={isEnding}
          onPress={confirmCancel}
          style={styles.cancelBtn}
        >
          <X size={16} color={c.textSecondary} />
          <T variant="subheadline" color={c.textSecondary} weight="semibold">False Alarm — Cancel</T>
        </PressableScale>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.background },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 10 },
  timerPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.dangerDeep, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  body: { paddingHorizontal: 16, paddingBottom: spacing.lg, gap: 12 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 18, borderRadius: radius.large, backgroundColor: c.dangerDeep, borderWidth: 1, borderColor: c.danger },
  heroChip: { alignSelf: 'flex-start', backgroundColor: 'rgba(0,0,0,0.25)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  beacon: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  beaconHalo: { borderRadius: 26, backgroundColor: '#fff' },
  beaconCore: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: c.surface, borderColor: c.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.large, padding: 16, gap: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: c.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  liveChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill },
  radarBox: { flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: c.surfaceMuted, borderRadius: radius.medium, padding: 12 },
  mapsBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, alignSelf: 'flex-end', backgroundColor: c.ink, paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill },
  guardian: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  gAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  outlineBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 46, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border },
  camera: { height: 170, borderRadius: radius.medium, overflow: 'hidden' },
  evRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  evIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: c.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  evStatus: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill },
  logRow: { flexDirection: 'row', gap: 8 },
  logTime: { width: 78, fontVariant: ['tabular-nums'] },
  actions: { gap: 10, paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, backgroundColor: c.background },
  safeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 56, borderRadius: radius.pill, backgroundColor: c.ink },
  cancelBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 46, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border },
});
