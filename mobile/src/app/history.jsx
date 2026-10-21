import { useState } from 'react';
import { View, ScrollView, Pressable, Alert, Linking, StyleSheet } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import { useVideoPlayer, VideoView } from 'expo-video';
import { ChevronLeft, ChevronDown, ChevronUp, MapPin, Trash2, History as HistoryIcon } from 'lucide-react-native';
import { useEmergency } from '../context/EmergencyContext';
import { useAuth } from '../context/AuthContext';
import { mapsUrl } from '../services/locationService';
import { ALERT_STATUS_LABEL, describeFloor } from '../services/alertService';
import { OSM_ATTRIBUTION } from '../services/geoService';
import { TRIGGER_SOURCE, SESSION_STATUS } from '../utils/constants';
import { formatDateTime, formatStandardTime, formatDuration } from '../utils/formatDate';
import { Card, Badge, VText } from '../components/ui';
import { Enter } from '../components/motion';
import { useTheme, radius, spacing } from '../theme/theme';

// Emergency History — every ended SOS session with its timeline, the REAL
// per-contact alert outcome, last location and playable evidence.

const STATUS_TONE = { resolved: 'safe', cancelled: 'muted', active: 'danger', ending: 'warning' };

const RECORDING_STATUS = { saved: 'Saved privately on this phone', error: 'Not saved', idle: 'Not recorded' };

const clock = (sec) => {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Plays a saved audio recording and shows what the player is REALLY doing
 * (loading / playing with time / finished / error). Before playing, the
 * audio session is switched to playback: on iPhone this makes it audible
 * with the silent switch on and routes it to the loudspeaker instead of
 * the earpiece used while recording.
 */
function AudioPlayback({ uri }) {
  const { colors } = useTheme();
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const [error, setError] = useState(null);

  async function toggle() {
    setError(null);
    try {
      if (status.playing) {
        player.pause();
        return;
      }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      const atEnd = status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration - 0.25);
      if (atEnd) await player.seekTo(0);
      player.play();
    } catch (err) {
      setError(err?.message ?? 'Could not play this recording.');
    }
  }

  const loadError = status.error || error;
  let label = 'Loading audio…';
  if (status.isLoaded) {
    label = status.playing
      ? `Pause · ${clock(status.currentTime)} / ${clock(status.duration)}`
      : `Play audio · ${clock(status.duration)}`;
  }

  return (
    <View style={{ gap: 2 }}>
      <Pressable accessibilityRole="button" onPress={toggle} disabled={!status.isLoaded} hitSlop={8}>
        <VText variant="subheadline" color={status.isLoaded ? colors.ink : colors.textSecondary} weight="semibold">
          {label}
        </VText>
      </Pressable>
      {loadError ? <VText variant="caption" color={colors.emergency}>{loadError}</VText> : null}
    </View>
  );
}

function VideoPlayback({ uri }) {
  const player = useVideoPlayer(uri);
  return <VideoView player={player} style={styles.video} nativeControls contentFit="contain" />;
}

function RecordingRow({ label, recording }) {
  const { colors } = useTheme();
  const [show, setShow] = useState(false);
  if (!recording) return null;
  const canPlay = recording.status === 'saved' && recording.uri;
  return (
    <View style={{ gap: 4 }}>
      <VText variant="subheadline">{label}</VText>
      <VText variant="caption" secondary>
        {RECORDING_STATUS[recording.status] ?? recording.status}
        {recording.bytes ? ` · ${Math.max(1, Math.round(recording.bytes / 1024))} KB` : ''}
        {recording.interrupted ? ' · interrupted' : ''}
      </VText>
      {recording.error ? <VText variant="caption" color={colors.emergency}>{recording.error}</VText> : null}
      {canPlay && label === 'Audio' && <AudioPlayback uri={recording.uri} />}
      {canPlay && label === 'Video' && (show
        ? <VideoPlayback uri={recording.uri} />
        : (
          <Pressable accessibilityRole="button" onPress={() => setShow(true)} hitSlop={8}>
            <VText variant="subheadline" weight="semibold">Play video</VText>
          </Pressable>
        ))}
    </View>
  );
}

function SessionCard({ session, onDelete }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const status = SESSION_STATUS[session.status] ?? { text: session.status, color: colors.textSecondary };
  const alerts = session.alerts;

  return (
    <Card>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((v) => !v)} style={styles.summary}>
        <View style={{ flex: 1, gap: 2 }}>
          <VText variant="headline">SOS via {TRIGGER_SOURCE[session.triggerSource] ?? session.triggerSource}</VText>
          <VText variant="caption" secondary>
            {formatDateTime(session.startedAt)}{session.endedAt ? ` · ${formatDuration(session.startedAt, session.endedAt)}` : ''}
          </VText>
        </View>
        <Badge text={status.text} tone={STATUS_TONE[session.status] ?? 'muted'} />
        {open ? <ChevronUp size={18} color={colors.textSecondary} /> : <ChevronDown size={18} color={colors.textSecondary} />}
      </Pressable>

      {open && (
        <View style={styles.details}>
          <VText variant="overline" secondary style={styles.sectionTitle}>Contact alerts</VText>
          {!alerts && <VText variant="caption" secondary>No alert was attempted.</VText>}
          {alerts && (alerts.recipients ?? []).length === 0 && (
            <VText variant="caption" secondary>{ALERT_STATUS_LABEL[alerts.status] ?? alerts.status}</VText>
          )}
          {(alerts?.recipients ?? []).map((r) => (
            <View key={r.phoneNumber} style={styles.row}>
              <VText variant="subheadline">{r.name}</VText>
              <VText variant="caption" secondary style={{ flexShrink: 1, textAlign: 'right' }}>{ALERT_STATUS_LABEL[r.status] ?? r.status}</VText>
            </View>
          ))}

          <VText variant="overline" secondary style={styles.sectionTitle}>Last location</VText>
          {session.location ? (
            <Pressable accessibilityRole="link" onPress={() => Linking.openURL(mapsUrl(session.location))} style={styles.row}>
              <MapPin size={14} color={colors.ink} />
              <VText variant="subheadline" weight="semibold" style={{ flex: 1, textDecorationLine: 'underline' }}>
                {session.location.latitude.toFixed(5)}, {session.location.longitude.toFixed(5)} (±{session.location.accuracy}m)
              </VText>
            </Pressable>
          ) : (
            <VText variant="caption" secondary>No location fix was obtained.</VText>
          )}
          {session.address?.label ? (
            <VText variant="subheadline">{session.address.label}</VText>
          ) : null}
          {describeFloor(session.floor) ? (
            <VText variant="caption" secondary>Floor: {describeFloor(session.floor)}</VText>
          ) : null}
          {session.address?.source === 'openstreetmap' ? <VText variant="caption" tertiary>Address {OSM_ATTRIBUTION}</VText> : null}

          <VText variant="overline" secondary style={styles.sectionTitle}>Evidence</VText>
          {session.recordings ? (
            <>
              <RecordingRow label="Audio" recording={session.recordings.audio} />
              <RecordingRow label="Video" recording={session.recordings.video} />
            </>
          ) : (
            <VText variant="caption" secondary>No recordings.</VText>
          )}

          <VText variant="overline" secondary style={styles.sectionTitle}>Timeline</VText>
          {session.log.map((e) => (
            <View key={e.id} style={styles.logRow}>
              <VText variant="caption" secondary style={styles.logTime}>{formatStandardTime(e.timestamp)}</VText>
              <VText
                variant="caption"
                color={e.level === 'error' ? colors.emergency : e.level === 'warning' ? colors.warning : colors.textPrimary}
                style={{ flex: 1 }}
              >
                {e.message}
              </VText>
            </View>
          ))}

          <Pressable accessibilityRole="button" onPress={() => onDelete(session)} style={[styles.delete, { borderColor: colors.separator }]}>
            <Trash2 size={16} color={colors.emergency} />
            <VText variant="subheadline" color={colors.emergency}>Remove from history</VText>
          </Pressable>
        </View>
      )}
    </Card>
  );
}

export default function HistoryScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { history, deleteHistoryItem } = useEmergency();
  const { isAuthenticated } = useAuth();

  function confirmDelete(session) {
    Alert.alert(
      'Remove from history?',
      'The timeline entry is removed. Saved recordings stay in the app’s private storage.',
      [
        { text: 'Keep', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => deleteHistoryItem(session.id) },
      ]
    );
  }

  // Emergency history is private: signed-in users only.
  if (!isAuthenticated) return <Redirect href="/auth" />;

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.topbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))} hitSlop={10} style={styles.back}>
          <ChevronLeft size={22} color={colors.textPrimary} />
        </Pressable>
        <VText variant="headline">Emergency History</VText>
        <View style={styles.back} />
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {history.length === 0 ? (
          <View style={styles.empty}>
            <HistoryIcon size={40} color={colors.textSecondary} />
            <VText variant="subheadline" secondary style={{ textAlign: 'center' }}>No emergencies yet. Ended SOS sessions appear here.</VText>
          </View>
        ) : (
          history.map((s, i) => (
            <Enter key={s.id} index={i}>
              <SessionCard session={s} onDelete={confirmDelete} />
            </Enter>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.sm, minHeight: 52 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  list: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl },
  summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  details: { gap: 6, marginTop: spacing.md },
  sectionTitle: { marginTop: 10 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  logRow: { flexDirection: 'row', gap: 8 },
  logTime: { width: 84 },
  video: { width: '100%', height: 220, borderRadius: radius.medium, backgroundColor: '#000' },
  delete: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, borderWidth: 1, borderRadius: radius.small, marginTop: spacing.sm },
});
