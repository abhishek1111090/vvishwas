import { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { View, ScrollView, Pressable, Alert, Linking, Image, StyleSheet } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEvent } from 'expo';
import { ChevronLeft, ChevronDown, ChevronUp, MapPin, Trash2, History as HistoryIcon } from 'lucide-react-native';
import { useEmergency } from '../context/EmergencyContext';
import { useAuth } from '../context/AuthContext';
import { mapsUrl } from '../services/locationService';
import { ALERT_STATUS_LABEL, describeFloor } from '../services/alertService';
import { OSM_ATTRIBUTION } from '../services/geoService';
import { TRIGGER_SOURCE, SESSION_STATUS } from '../utils/constants';
import { formatDateTime, formatStandardTime, formatDuration } from '../utils/formatDate';
import { Card, Badge, VText } from '../components/ui';
import { Enter, AmbientBackground } from '../components/motion';
import { cloudSync, uploadsFor } from '../services/cloudSync';
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

/** Audio saved in parts (sent on WhatsApp during the SOS) plays here as one recording. */
function ContinuousAudio({ uris }) {
  const { colors } = useTheme();
  const partRef = useRef(0);
  const [part, setPart] = useState(0);
  const player = useAudioPlayer(uris[0]);
  const status = useAudioPlayerStatus(player);
  const [error, setError] = useState(null);

  // When a part finishes, continue with the next one (then rewind to the start).
  useEffect(() => {
    const sub = player.addListener('playbackStatusUpdate', (st) => {
      if (!st?.didJustFinish) return;
      const next = partRef.current < uris.length - 1 ? partRef.current + 1 : 0;
      partRef.current = next;
      setPart(next);
      player.replace(uris[next]);
      if (next > 0) player.play();
    });
    return () => sub.remove();
  }, [player, uris]);

  async function toggle() {
    setError(null);
    try {
      if (status.playing) {
        player.pause();
        return;
      }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      player.play();
    } catch (err) {
      setError(err?.message ?? 'Could not play this recording.');
    }
  }

  return (
    <View style={{ gap: 2 }}>
      <Pressable accessibilityRole="button" onPress={toggle} disabled={!status.isLoaded} hitSlop={8}>
        <VText variant="subheadline" color={status.isLoaded ? colors.ink : colors.textSecondary} weight="semibold">
          {status.playing ? `Pause · part ${part + 1} of ${uris.length} · ${clock(status.currentTime)}` : 'Play audio'}
        </VText>
      </Pressable>
      {status.error || error ? <VText variant="caption" color={colors.emergency}>{status.error || error}</VText> : null}
    </View>
  );
}

function VideoPlayback({ uri }) {
  const player = useVideoPlayer(uri);
  return <VideoView player={player} style={styles.video} nativeControls contentFit="contain" />;
}

/**
 * One video for the whole SOS. If the person flipped camera, the recording
 * is stored in parts (iOS can't move a running recording to another
 * camera); they play here back to back as a single video.
 */
function ContinuousVideo({ uris }) {
  const index = useRef(0);
  const player = useVideoPlayer(uris[0]);
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  useEffect(() => {
    const sub = player.addListener('playToEnd', () => {
      // replaceAsync loads the next part off the main thread (no UI freeze).
      const load = (uri) => (player.replaceAsync ? player.replaceAsync(uri) : Promise.resolve(player.replace(uri)));
      if (index.current < uris.length - 1) {
        index.current += 1;
        load(uris[index.current]).then(() => player.play()).catch(() => {});
      } else {
        index.current = 0;
        load(uris[0]).catch(() => {});
      }
    });
    return () => sub.remove();
  }, [player, uris]);
  return (
    <View style={{ gap: 4 }}>
      <VideoView player={player} style={styles.video} nativeControls contentFit="contain" />
      {status === 'error' ? <VText variant="caption" color="#FF2E3A">This video could not be played.</VText> : null}
    </View>
  );
}

function PhotoGrid({ photos }) {
  const [open, setOpen] = useState(null);
  if (!photos?.length) return null;
  return (
    <View style={{ gap: 6 }}>
      <VText variant="subheadline">Photos ({photos.length})</VText>
      <View style={styles.photoGrid}>
        {photos.map((p) => (
          <Pressable key={p.uri} accessibilityRole="imagebutton" accessibilityLabel={`Photo, ${p.facing} camera`} onPress={() => setOpen(open === p.uri ? null : p.uri)}>
            <Image source={{ uri: p.uri }} style={styles.thumb} />
          </Pressable>
        ))}
      </View>
      {open ? <Image source={{ uri: open }} style={styles.photoLarge} resizeMode="contain" /> : null}
    </View>
  );
}

function RecordingRow({ label, recording }) {
  const { colors } = useTheme();
  const [show, setShow] = useState(false);
  if (!recording) return null;
  if (label !== 'Audio' && recording.clips?.length > 1) {
    const total = recording.clips.reduce((sum, c) => sum + (c.bytes ?? 0), 0);
    return (
      <View style={{ gap: 4 }}>
        <VText variant="subheadline">Video</VText>
        <VText variant="caption" secondary>Saved privately on this phone · {Math.max(1, Math.round(total / 1024))} KB · front &amp; back camera</VText>
        {show
          ? <ContinuousVideo uris={recording.clips.map((c) => c.uri)} />
          : (
            <Pressable accessibilityRole="button" onPress={() => setShow(true)} hitSlop={8}>
              <VText variant="subheadline" weight="semibold">Play video</VText>
            </Pressable>
          )}
      </View>
    );
  }
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
      {canPlay && label === 'Audio' && (recording.parts?.length > 1
        ? <ContinuousAudio uris={recording.parts.map((p) => p.uri)} />
        : <AudioPlayback uri={recording.uri} />)}
      {canPlay && label !== 'Audio' && (show
        ? <VideoPlayback uri={recording.uri} />
        : (
          <Pressable accessibilityRole="button" onPress={() => setShow(true)} hitSlop={8}>
            <VText variant="subheadline" weight="semibold">Play video</VText>
          </Pressable>
        ))}
    </View>
  );
}

/**
 * Server backup state of one SOS's files, as the server confirmed it:
 * only "backed up" once every file was stored there.
 */
function BackupStatus({ session }) {
  const { colors } = useTheme();
  const statusMap = useSyncExternalStore(cloudSync.subscribe, cloudSync.getStatusMap);
  const uris = uploadsFor(session.id, session.recordings).map((i) => i.uri);
  const states = uris.map((u) => statusMap[u]).filter(Boolean);
  if (uris.length === 0 || states.length === 0) return null; // not a server account / nothing to back up
  const failed = states.filter((s) => s === 'failed').length;
  const done = states.filter((s) => s === 'uploaded').length;
  let text = `Uploading to your VISHWAS server… ${done} of ${uris.length}`;
  let color = colors.textSecondary;
  if (done === uris.length) {
    text = `Backed up to your VISHWAS server (${done} file${done === 1 ? '' : 's'})`;
    color = colors.safe;
  } else if (failed > 0) {
    text = `${failed} file${failed === 1 ? '' : 's'} couldn’t be backed up — kept on this phone`;
    color = colors.warning;
  }
  return <VText variant="caption" color={color}>{text}</VText>;
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
          <BackupStatus session={session} />
          {session.recordings ? (
            <>
              <RecordingRow label="Audio" recording={session.recordings.audio} />
              <RecordingRow label="Video" recording={session.recordings.video} />
              {session.recordings.video?.front ? <RecordingRow label="Front camera video" recording={session.recordings.video.front} /> : null}
              <PhotoGrid photos={session.recordings.photos} />
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
      <AmbientBackground />
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
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  thumb: { width: 72, height: 72, borderRadius: 10, backgroundColor: '#1D1D22' },
  photoLarge: { width: '100%', height: 260, borderRadius: 12, backgroundColor: '#000' },
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
