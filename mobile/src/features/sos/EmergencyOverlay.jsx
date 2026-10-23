import { useEffect, useRef, useState } from 'react';
import { View, ScrollView, Pressable, BackHandler, Alert, Linking, Platform, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView } from 'expo-camera';
import { StatusBar } from 'expo-status-bar';
import Animated, { FadeInDown, FadeIn, FadeOut, SlideInUp, useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing, cancelAnimation } from 'react-native-reanimated';
import { MapPin, MessageSquare, RotateCcw, Navigation, Mic, Video, ShieldCheck, Siren, X, ChevronDown, ChevronUp, Building2, Layers, SwitchCamera, Camera, ZoomIn, ZoomOut, Images } from 'lucide-react-native';
import { useEmergency } from '../../context/EmergencyContext';
import { emergencyController } from '../../services/emergencyController';
import { recordingService } from '../../services/recordingService';
import { mapsUrl, GOOD_ACCURACY_M, COARSE_ACCURACY_M } from '../../services/locationService';
import { OSM_ATTRIBUTION } from '../../services/geoService';
import { floorLabel } from '../../services/floorService';
import { AlertStatus, ALERT_STATUS_LABEL, CONFIRMED_STATUSES, SKIPPED_STATUSES } from '../../services/alertService';
import { haptics } from '../../services/hapticService';
import { TRIGGER_SOURCE } from '../../utils/constants';
import { formatShortTime, formatStandardTime } from '../../utils/formatDate';
import { RadarPing, RecDot, PressableScale, useReduceMotion } from '../../components/motion';
import { OsmMap } from '../../components/OsmMap';
import { isDualCameraAvailable, DualCameraNativeView } from '../../../modules/vishwas-dual-camera';
import { GradientFill, RadialGlow } from '../../components/Glow';
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

/** A slow red pulse of light behind the top of the screen. */
/**
 * The moment SOS starts: a red flash and one expanding ring, ~600 ms, so the
 * switch into emergency mode is unmistakable. Decorative only — alerts,
 * recording and GPS have already started. Skipped with "Reduce motion".
 */
function ActivationBurst() {
  const reduce = useReduceMotion();
  const v = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    v.value = withTiming(1, { duration: 650, easing: Easing.out(Easing.cubic) });
  }, [reduce, v]);
  const flash = useAnimatedStyle(() => ({ opacity: (1 - v.value) * 0.55 }));
  const ring = useAnimatedStyle(() => ({ opacity: 1 - v.value, transform: [{ scale: 0.2 + v.value * 2.6 }] }));
  if (reduce) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: c.danger }, flash]} />
      <View style={styles.burstCenter}>
        <Animated.View style={[styles.burstRing, { borderColor: c.danger }, ring]} />
      </View>
    </View>
  );
}

function AlarmAmbience() {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(v);
  }, [v]);
  const style = useAnimatedStyle(() => ({ opacity: 0.35 + v.value * 0.5 }));
  return (
    <Animated.View pointerEvents="none" style={[styles.ambience, style]}>
      <RadialGlow size={520} color={c.danger} opacity={0.45} />
    </Animated.View>
  );
}

/** Hero card border that breathes with the alarm. */
function HeroPulse() {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => cancelAnimation(v);
  }, [v]);
  const style = useAnimatedStyle(() => ({ opacity: 0.4 + v.value * 0.6 }));
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.heroBorder, style]} />;
}

const ZOOM_STEP = 0.03;
const ZOOM_MAX = 0.6;
// expo-camera zoom z (0..1) → factor = maxZoom^z. iPhone video formats
// report a max of ~124×, so these presets land on ≈1× / ≈2× of the main lens.
const EST_MAX_ZOOM = 123.75;
const zoomFor = (factor) => Math.log(factor) / Math.log(EST_MAX_ZOOM);

/**
 * The iPhone "virtual" back camera (ultra-wide + wide in one device). On it,
 * 0.5× → 1× → 2× are just zoom levels and iOS swaps the physical lens itself,
 * so ONE video keeps recording through every zoom change.
 */
function virtualBackLens(lenses) {
  return lenses.find((l) => /triple/i.test(l)) ?? lenses.find((l) => /dual\s*wide/i.test(l)) ?? null;
}

const camLog = (...args) => {
  if (__DEV__) console.log('[camera]', ...args);
};

/**
 * Live evidence camera with iPhone-style controls: 0.5× / 1× / 2×, zoom − +,
 * flip front/back and a silent photo button.
 *
 * Recording is ONE video: zoom presets never stop it. Only flipping to the
 * other camera has to (iOS can't move a running recording to another
 * camera); the video then continues straight away and History plays the
 * parts back to back as a single video.
 */
function EvidenceCamera() {
  const ref = useRef(null);
  const { changeCamera, takePhoto, photos, video } = useEmergency();
  const [facing, setFacing] = useState('back');
  const [lens, setLens] = useState(null);
  const [zoom, setZoom] = useState(0);
  const [virtualLens, setVirtualLens] = useState(null);
  const [switching, setSwitching] = useState(false);
  const [flash, setFlash] = useState(null);
  const [ready, setReady] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [mountKey, setMountKey] = useState(0); // bumped only by the manual retry
  const started = useRef(false);
  useEffect(() => () => recordingService.attachCamera(null), []);

  // Tell the person if the camera never starts, instead of a silent black box.
  useEffect(() => {
    if (ready) return undefined;
    const t = setTimeout(() => { camLog('not ready after 6 s'); setStuck(true); }, 6000);
    return () => clearTimeout(t);
  }, [ready, mountKey]);

  /** Start (or continue) recording once the camera has settled; retry once. */
  function startRecording(delay = 900, attempt = 0) {
    setTimeout(() => {
      emergencyController.onCameraReady();
      setTimeout(() => {
        const st = recordingService.getSnapshot().video.status;
        camLog('video', st, 'attempt', attempt);
        if (st !== 'recording' && st !== 'requesting' && attempt === 0) startRecording(1500, 1);
      }, 1200);
    }, delay);
  }

  async function onReady() {
    camLog('ready', facing, lens ?? 'default');
    setReady(true);
    setStuck(false);
    recordingService.attachCamera(ref.current);
    if (started.current) return;
    started.current = true;
    // Pick the multi-lens camera BEFORE recording starts, so 0.5×/1×/2× never interrupt the video.
    let lenses = [];
    try {
      lenses = (await ref.current?.getAvailableLensesAsync?.()) ?? [];
    } catch (err) {
      camLog('lens query failed', err?.message);
    }
    const virtual = Platform.OS === 'ios' ? virtualBackLens(lenses) : null;
    camLog('lenses', lenses, '→ using', virtual ?? 'default');
    setVirtualLens(virtual);
    if (virtual) {
      setLens(virtual);
      setZoom(zoomFor(2)); // start at 1×, like the Camera app
      startRecording(900);
    } else {
      startRecording(0);
    }
  }

  async function flip() {
    if (switching) return;
    setSwitching(true);
    haptics.selection();
    const next = facing === 'back' ? 'front' : 'back';
    try {
      await changeCamera(() => {
        camLog('flip to', next);
        recordingService.setFacing(next);
        setFacing(next);
        setLens(next === 'back' ? virtualLens : null);
        setZoom(next === 'back' && virtualLens ? zoomFor(2) : 0);
      }, next === 'front' ? 'front camera' : 'back camera');
      startRecording(900);
    } finally {
      setSwitching(false);
    }
  }

  async function shoot() {
    haptics.light();
    const res = await takePhoto();
    setFlash(res.status === 'saved' ? 'Photo saved' : res.error ?? 'Photo failed');
    setTimeout(() => setFlash(null), 1600);
  }

  // Zoom presets: with the multi-lens camera 0 = 0.5×; otherwise 0 = 1×.
  const multi = facing === 'back' && !!lens;
  const presets = multi
    ? [{ label: '0.5×', z: 0 }, { label: '1×', z: zoomFor(2) }, { label: '2×', z: zoomFor(4) }]
    : [{ label: '1×', z: 0 }, { label: '2×', z: zoomFor(2) }];
  const nearest = presets.reduce((a, b) => (Math.abs(b.z - zoom) < Math.abs(a.z - zoom) ? b : a));
  const onPreset = Math.abs(nearest.z - zoom) < 0.005;
  const recording = video.status === 'recording';

  return (
    <View style={styles.cameraWrap}>
      <CameraView
        key={mountKey}
        ref={ref}
        style={styles.camera}
        onLayout={(e) => { const { width, height } = e.nativeEvent.layout; camLog('preview size', Math.round(width), 'x', Math.round(height)); }}
        facing={facing}
        mode="video"
        mute
        videoQuality="720p"
        videoBitrate={2_000_000}
        zoom={zoom}
        selectedLens={lens ?? undefined}
        animateShutter
        onCameraReady={onReady}
        onMountError={(e) => {
          camLog('mount error', e?.message);
          emergencyController.onCameraError(e?.message ?? 'Camera could not start');
        }}
      />

      {stuck && !ready ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => { camLog('manual retry'); started.current = false; setStuck(false); setMountKey((k) => k + 1); }}
          style={styles.camStuck}
        >
          <T variant="subheadline" weight="semibold" color="#fff" style={{ textAlign: 'center' }}>Camera didn’t start. Tap to retry.</T>
          <T variant="caption" color={c.textSecondary} style={{ textAlign: 'center' }}>If it stays black, close other apps using the camera and check Settings → Expo Go → Camera.</T>
        </Pressable>
      ) : null}

      <View style={styles.camTop} pointerEvents="box-none">
        <View style={styles.camBadge}>
          {recording ? <RecDot color={c.danger} size={6} /> : <View style={[styles.dot, { backgroundColor: c.textSecondary }]} />}
          <T variant="caption" weight="bold" color="#fff">
            {switching ? 'Switching…' : recording ? 'REC' : 'Camera'} · {facing === 'front' ? 'Front' : 'Back'} {onPreset ? nearest.label : ''}
          </T>
        </View>
        <PressableScale accessibilityRole="button" accessibilityLabel={facing === 'back' ? 'Switch to front camera' : 'Switch to back camera'} disabled={switching || !ready} onPress={flip} scaleTo={0.88} style={styles.camRound}>
          <SwitchCamera size={18} color="#fff" />
        </PressableScale>
      </View>

      {flash ? (
        <Animated.View entering={SlideInUp.duration(250)} exiting={FadeOut.duration(250)} style={styles.camFlash}>
          <T variant="caption" weight="bold" color="#fff">{flash}</T>
        </Animated.View>
      ) : null}

      <View style={styles.camBottom} pointerEvents="box-none">
        <View style={styles.zoomRow}>
          <PressableScale accessibilityRole="button" accessibilityLabel="Zoom out" disabled={zoom <= 0} onPress={() => setZoom((z) => Math.max(0, +(z - ZOOM_STEP).toFixed(3)))} scaleTo={0.88} style={[styles.camSmall, zoom <= 0 && { opacity: 0.4 }]}>
            <ZoomOut size={16} color="#fff" />
          </PressableScale>
          {presets.map((p) => {
            const on = onPreset && nearest.label === p.label;
            return (
              <PressableScale
                key={p.label}
                accessibilityRole="button"
                accessibilityLabel={`Zoom ${p.label}`}
                accessibilityState={{ selected: on }}
                onPress={() => { haptics.selection(); setZoom(p.z); }}
                scaleTo={0.88}
                style={[styles.lensChip, on && styles.lensChipOn]}
              >
                <T variant="caption" weight="bold" color={on ? '#FFD60A' : '#fff'}>{p.label}</T>
              </PressableScale>
            );
          })}
          <PressableScale accessibilityRole="button" accessibilityLabel="Zoom in" disabled={zoom >= ZOOM_MAX} onPress={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(3)))} scaleTo={0.88} style={[styles.camSmall, zoom >= ZOOM_MAX && { opacity: 0.4 }]}>
            <ZoomIn size={16} color="#fff" />
          </PressableScale>
        </View>
        <View style={styles.shutterRow}>
          <View style={styles.photoCount}>
            <Images size={14} color="#fff" />
            <T variant="caption" weight="bold" color="#fff">{photos.length}</T>
          </View>
          <PressableScale accessibilityRole="button" accessibilityLabel="Take photo" disabled={switching || !ready} onPress={shoot} scaleTo={0.86} style={styles.shutter}>
            <View style={styles.shutterInner}><Camera size={20} color="#0A0A0B" /></View>
          </PressableScale>
          <View style={{ width: 52 }} />
        </View>
      </View>
    </View>
  );
}

const DUAL_AVAILABLE = isDualCameraAvailable();

/**
 * Custom iPhone build only: front AND back record at the same time
 * (back full-size, front in the corner). Falls back to the single camera
 * if the phone can't run both (onError before it's ready).
 */
function DualEvidenceCamera({ onFallback }) {
  const ref = useRef(null);
  const { takePhoto, photos, video } = useEmergency();
  const [zoom, setZoom] = useState(0);
  const [ready, setReady] = useState(false);
  const [flash, setFlash] = useState(null);
  useEffect(() => () => recordingService.attachDualCamera(null), []);

  async function shoot() {
    haptics.light();
    const res = await takePhoto();
    setFlash(res.status === 'saved' ? 'Photo saved' : res.error ?? 'Photo failed');
    setTimeout(() => setFlash(null), 1600);
  }

  const presets = [{ label: '1×', z: 0 }, { label: '2×', z: zoomFor(2) }];
  const nearest = presets.reduce((a, b) => (Math.abs(b.z - zoom) < Math.abs(a.z - zoom) ? b : a));
  const onPreset = Math.abs(nearest.z - zoom) < 0.005;
  const recording = video.status === 'recording';

  return (
    <View style={styles.cameraWrap}>
      <DualCameraNativeView
        ref={ref}
        style={styles.camera}
        zoom={zoom}
        onReady={() => {
          camLog('dual ready');
          setReady(true);
          recordingService.attachDualCamera(ref.current);
          emergencyController.onCameraReady();
        }}
        onError={(e) => {
          const message = e?.nativeEvent?.message ?? 'Dual camera error';
          camLog('dual error', message);
          emergencyController.onCameraError(message);
          if (!ready) onFallback();
        }}
        onInterrupted={(e) => {
          camLog('dual interrupted', e?.nativeEvent?.camera);
          recordingService.onDualInterrupted();
        }}
      />
      <View style={styles.camTop} pointerEvents="box-none">
        <View style={styles.camBadge}>
          {recording ? <RecDot color={c.danger} size={6} /> : <View style={[styles.dot, { backgroundColor: c.textSecondary }]} />}
          <T variant="caption" weight="bold" color="#fff">{recording ? 'REC' : ready ? 'Camera' : 'Starting…'} · Front + Back</T>
        </View>
      </View>
      {flash ? (
        <Animated.View entering={FadeIn.duration(150)} style={styles.camFlash}>
          <T variant="caption" weight="bold" color="#fff">{flash}</T>
        </Animated.View>
      ) : null}
      <View style={styles.camBottom} pointerEvents="box-none">
        <View style={styles.zoomRow}>
          <PressableScale accessibilityRole="button" accessibilityLabel="Zoom out" disabled={zoom <= 0} onPress={() => setZoom((z) => Math.max(0, +(z - ZOOM_STEP).toFixed(3)))} scaleTo={0.88} style={[styles.camSmall, zoom <= 0 && { opacity: 0.4 }]}>
            <ZoomOut size={16} color="#fff" />
          </PressableScale>
          {presets.map((p) => {
            const on = onPreset && nearest.label === p.label;
            return (
              <PressableScale key={p.label} accessibilityRole="button" accessibilityLabel={`Zoom ${p.label}`} onPress={() => { haptics.selection(); setZoom(p.z); }} scaleTo={0.88} style={[styles.lensChip, on && styles.lensChipOn]}>
                <T variant="caption" weight="bold" color={on ? '#FFD60A' : '#fff'}>{p.label}</T>
              </PressableScale>
            );
          })}
          <PressableScale accessibilityRole="button" accessibilityLabel="Zoom in" disabled={zoom >= ZOOM_MAX} onPress={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(3)))} scaleTo={0.88} style={[styles.camSmall, zoom >= ZOOM_MAX && { opacity: 0.4 }]}>
            <ZoomIn size={16} color="#fff" />
          </PressableScale>
        </View>
        <View style={styles.shutterRow}>
          <View style={styles.photoCount}>
            <Images size={14} color="#fff" />
            <T variant="caption" weight="bold" color="#fff">{photos.length}</T>
          </View>
          <PressableScale accessibilityRole="button" accessibilityLabel="Take photo" disabled={!ready} onPress={shoot} scaleTo={0.86} style={styles.shutter}>
            <View style={styles.shutterInner}><Camera size={20} color="#0A0A0B" /></View>
          </PressableScale>
          <View style={{ width: 52 }} />
        </View>
      </View>
    </View>
  );
}

/** Dual camera when this build has it, otherwise the single camera with flip. */
function EvidenceCameraSwitch() {
  const [fallback, setFallback] = useState(false);
  if (DUAL_AVAILABLE && !fallback) return <DualEvidenceCamera onFallback={() => setFallback(true)} />;
  return <EvidenceCamera />;
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

/** One plain sentence about the emergency messages, for a glance during an SOS. */
function messageSummary(alerts, isManualFallback) {
  if (!alerts || alerts.status === AlertStatus.sending) return { text: 'Sending emergency messages…', tone: 'warning' };
  if (alerts.status === AlertStatus.noContacts) return { text: 'No emergency contacts saved — nobody was alerted.', tone: 'danger' };
  const live = (alerts.recipients ?? []).filter((r) => !SKIPPED_STATUSES.includes(r.status));
  const ok = live.filter((r) => CONFIRMED_STATUSES.includes(r.status));
  const delivered = live.filter((r) => r.status === AlertStatus.delivered);
  if (live.length === 0) return { text: 'Could not send — no contact has a valid phone number.', tone: 'danger' };
  if (ok.length === live.length) {
    if (delivered.length === live.length) return { text: `Emergency message delivered to all ${live.length} contact${live.length === 1 ? '' : 's'}.`, tone: 'safe' };
    return { text: `Emergency message sent to all ${live.length} contact${live.length === 1 ? '' : 's'}.`, tone: 'safe' };
  }
  if (ok.length > 0) return { text: `Sent to ${ok.length} of ${live.length} contacts — some could not be delivered.`, tone: 'warning' };
  if (isManualFallback) return { text: 'Messages not sent yet — tap “Text contacts”.', tone: 'danger' };
  return { text: 'Emergency messages could not be delivered.', tone: 'danger' };
}

const FLOOR_OPTIONS = [-2, -1, 0, ...Array.from({ length: 60 }, (_, i) => i + 1)];
const chipText = (n) => (n < 0 ? `B${Math.abs(n)}` : n === 0 ? 'G' : String(n));

function AddressAndFloor({ address, floor, onSetFloor }) {
  const [picking, setPicking] = useState(false);
  const confirmed = floor?.confirmed !== null && floor?.confirmed !== undefined;
  const estimate = floor?.estimate ?? null;

  let floorText = 'Not detected';
  let floorColor = c.textSecondary;
  if (confirmed) {
    floorText = `${floorLabel(floor.confirmed)} · confirmed`;
    floorColor = c.safe;
  } else if (estimate) {
    floorText = `About ${floorLabel(estimate.floor)} · estimate ±${estimate.uncertainty}`;
    floorColor = c.warning;
  } else if (!floor) {
    floorText = 'Estimating…';
  }

  return (
    <View style={{ gap: 10 }}>
      <View style={styles.infoRow}>
        <View style={styles.infoIcon}><Building2 size={16} color={c.textPrimary} /></View>
        <View style={{ flex: 1, gap: 2 }}>
          <T variant="caption" color={c.textSecondary} weight="semibold">ADDRESS</T>
          <T variant="subheadline" weight="semibold">{address?.label ?? 'Looking up address…'}</T>
          {address ? (
            <T variant="caption" color={c.textTertiary}>{address.source === 'openstreetmap' ? `Address ${OSM_ATTRIBUTION}` : 'Address from the phone’s map service'}</T>
          ) : null}
        </View>
      </View>

      <View style={styles.infoRow}>
        <View style={styles.infoIcon}><Layers size={16} color={c.textPrimary} /></View>
        <View style={{ flex: 1, gap: 2 }}>
          <T variant="caption" color={c.textSecondary} weight="semibold">FLOOR</T>
          <T variant="subheadline" weight="semibold" color={floorColor}>{floorText}</T>
          {!confirmed && floor?.unavailable ? <T variant="caption" color={c.textTertiary}>{floor.unavailable}</T> : null}
        </View>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={confirmed ? 'Change floor' : 'Set floor'}
          onPress={() => setPicking((v) => !v)}
          style={styles.floorBtn}
        >
          <T variant="caption" color={c.onInk} weight="bold">{picking ? 'Close' : confirmed ? 'Change' : 'Set floor'}</T>
        </PressableScale>
      </View>

      {picking ? (
        <Animated.View entering={FadeIn.duration(200)}>
          <T variant="caption" color={c.textSecondary} style={{ marginBottom: 6 }}>Which floor are you on? This is added to the alert.</T>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {FLOOR_OPTIONS.map((n) => {
              const selected = floor?.confirmed === n;
              const suggested = !confirmed && estimate?.floor === n;
              return (
                <PressableScale
                  key={n}
                  accessibilityRole="button"
                  accessibilityLabel={floorLabel(n)}
                  onPress={() => { haptics.selection(); onSetFloor(n); setPicking(false); }}
                  scaleTo={0.9}
                  style={[styles.floorChip, selected && { backgroundColor: c.ink, borderColor: c.ink }, suggested && { borderColor: c.warning }]}
                >
                  <T variant="subheadline" weight="bold" color={selected ? c.onInk : c.textPrimary}>{chipText(n)}</T>
                </PressableScale>
              );
            })}
          </ScrollView>
        </Animated.View>
      ) : null}
    </View>
  );
}

export function EmergencyOverlay() {
  const insets = useSafeAreaInsets();
  const {
    activeSession, log, alerts, isEnding,
    location, locationStatus, locationError, address, floor,
    audio, video, cameraAllowed,
    resolve, cancel, openSmsComposer, restartRecording, setConfirmedFloor,
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
  const sendable = recipients.filter((r) => !SKIPPED_STATUSES.includes(r.status));
  const confirmedCount = sendable.filter((r) => CONFIRMED_STATUSES.includes(r.status)).length;
  const canTextContacts =
    !isEnding && !!alerts && alerts.status !== AlertStatus.noContacts && alerts.status !== AlertStatus.sending &&
    sendable.some((r) => !CONFIRMED_STATUSES.includes(r.status));
  const summary = messageSummary(alerts, alerts?.method === 'manual');
  const summaryColor = summary.tone === 'safe' ? c.safe : summary.tone === 'danger' ? c.danger : c.warning;

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
      <AlarmAmbience />
      <View style={styles.topbar}>
        <T variant="headline" weight="heavy" style={{ letterSpacing: 0.5 }}>VISHWAS</T>
        <View style={styles.timerPill}>
          <RecDot color={c.danger} size={6} />
          <T variant="caption" weight="bold" color="#fff" style={{ fontVariant: ['tabular-nums'] }}>{elapsed}</T>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInDown.duration(450).easing(Easing.out(Easing.cubic))} style={styles.hero}>
          <GradientFill from="#FF3440" to="#5E0710" />
          <HeroPulse />
          <View style={{ flex: 1, gap: 6 }}>
            <View style={styles.heroChip}>
              <RecDot color="#fff" size={5} />
              <T variant="overline" color="#fff" style={{ fontSize: 9 }}>SOS live · {elapsed}</T>
            </View>
            <T variant="title" weight="heavy" color="#fff" style={{ fontSize: 27, letterSpacing: -0.4 }}>EMERGENCY ACTIVE</T>
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
          {loc ? (
            <View>
              <OsmMap latitude={loc.latitude} longitude={loc.longitude} accuracy={loc.accuracy} height={180} color={c.danger} zoom={17} />
              <View style={styles.coordChip}>
                <MapPin size={12} color={c.danger} />
                <T variant="caption" weight="semibold" style={{ fontVariant: ['tabular-nums'] }}>
                  {loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)} · ±{loc.accuracy} m
                </T>
              </View>
            </View>
          ) : (
            <View style={styles.radarBox}>
              <RadarPing color={c.warning} size={110} active />
              <T variant="subheadline" color={locationStatus === 'error' ? c.warning : c.textSecondary} style={{ flex: 1 }}>
                {locationStatus === 'error' ? locationError ?? 'GPS unavailable' : 'Waiting for the first GPS fix…'}
              </T>
            </View>
          )}
          {loc && (loc.accuracy ?? 0) > GOOD_ACCURACY_M && locationStatus !== 'error' ? (
            <T variant="caption" color={c.warning}>
              {(loc.accuracy ?? 0) > COARSE_ACCURACY_M
                ? `Approximate location only (±${loc.accuracy} m). Turn on Precise Location for this app in Settings, and move near a window or outside.`
                : `Improving accuracy (±${loc.accuracy} m)… GPS is still locking on.`}
            </T>
          ) : null}
          {loc && locationStatus === 'error' && locationError ? (
            <T variant="caption" color={c.warning}>Last known position — {locationError}</T>
          ) : null}
          <AddressAndFloor address={address} floor={floor} onSetFloor={setConfirmedFloor} />
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
              <T variant="headline">Guardians Notified{sendable.length ? ` (${confirmedCount}/${sendable.length})` : ''}</T>
              <T variant="caption" color={summaryColor} weight="semibold" testID="alert-summary">{summary.text}</T>
            </View>
          </View>
          {recipients.map((r) => {
            const ok = CONFIRMED_STATUSES.includes(r.status);
            const bad = [AlertStatus.failed, AlertStatus.manualRequired, AlertStatus.cancelled, AlertStatus.unavailable, ...SKIPPED_STATUSES].includes(r.status);
            const col = ok ? c.safe : bad ? c.danger : c.warning;
            return (
              <View key={r.contactId ?? r.phoneNumber} style={styles.guardian}>
                <View style={styles.gAvatar}><T variant="caption" weight="bold">{r.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}</T></View>
                <View style={{ flex: 1 }}>
                  <T variant="subheadline" weight="semibold">{r.name}</T>
                  <T variant="caption" color={col}>{ALERT_STATUS_LABEL[r.status] ?? r.status}{r.error && r.status === AlertStatus.failed ? ` — ${r.error}` : ''}</T>
                  {r.whatsapp ? (
                    <T variant="caption" color={r.whatsapp.status === 'failed' ? c.danger : r.whatsapp.status === 'delivered' ? c.safe : c.textSecondary}>
                      WhatsApp: {r.whatsapp.status === 'failed' ? `not sent${r.whatsapp.error ? ` — ${r.whatsapp.error}` : ''}` : ALERT_STATUS_LABEL[r.whatsapp.status] ?? r.whatsapp.status}
                    </T>
                  ) : null}
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
          {cameraAllowed ? <EvidenceCameraSwitch /> : null}
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
      <ActivationBurst />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.background },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 10 },
  timerPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.dangerDeep, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  body: { paddingHorizontal: 16, paddingBottom: spacing.lg, gap: 12 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 18, borderRadius: radius.large, overflow: 'hidden', backgroundColor: c.dangerDeep },
  heroBorder: { borderRadius: radius.large, borderWidth: 1.5, borderColor: '#FF8A90' },
  heroChip: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: 'rgba(0,0,0,0.28)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  burstCenter: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  burstRing: { width: 260, height: 260, borderRadius: 130, borderWidth: 6 },
  ambience: { position: 'absolute', top: -300, alignSelf: 'center' },
  coordChip: { position: 'absolute', left: 8, top: 8, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(8,8,10,0.82)', paddingHorizontal: 9, paddingVertical: 5, borderRadius: radius.pill },
  beacon: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  beaconHalo: { borderRadius: 26, backgroundColor: '#fff' },
  beaconCore: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: 'rgba(19,19,22,0.94)', borderColor: c.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.large, padding: 16, gap: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: c.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  liveChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill },
  radarBox: { flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: c.surfaceMuted, borderRadius: radius.medium, padding: 12 },
  mapsBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, alignSelf: 'flex-end', backgroundColor: c.ink, paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill },
  guardian: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  infoIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: c.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  floorBtn: { backgroundColor: c.ink, paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill },
  floorChip: { minWidth: 44, height: 40, paddingHorizontal: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
  gAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  outlineBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 46, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border },
  cameraWrap: { height: 300, borderRadius: radius.medium, overflow: 'hidden', backgroundColor: '#111114' },
  camera: { flex: 1 },
  camStuck: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 20, backgroundColor: 'rgba(0,0,0,0.6)' },
  camTop: { position: 'absolute', top: 10, left: 10, right: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  camBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  camRound: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  camFlash: { position: 'absolute', top: 56, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill },
  camBottom: { position: 'absolute', left: 0, right: 0, bottom: 10, alignItems: 'center', gap: 10 },
  zoomRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.45)', padding: 4, borderRadius: radius.pill },
  camSmall: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  lensChip: { minWidth: 38, height: 32, paddingHorizontal: 8, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  lensChipOn: { backgroundColor: 'rgba(0,0,0,0.6)' },
  shutterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingHorizontal: 18 },
  photoCount: { width: 52, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 8, paddingVertical: 5, borderRadius: radius.pill },
  shutter: { width: 62, height: 62, borderRadius: 31, borderWidth: 3, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  evRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  evIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: c.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  evStatus: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill },
  logRow: { flexDirection: 'row', gap: 8 },
  logTime: { width: 78, fontVariant: ['tabular-nums'] },
  actions: { gap: 10, paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, backgroundColor: c.background },
  safeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 56, borderRadius: radius.pill, backgroundColor: c.ink },
  cancelBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 46, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border },
});
