import { setAudioModeAsync, getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import { saveRecording } from './recordingStore';

/**
 * recordingService.js — audio + video evidence recording
 *
 *   audio → expo-audio AudioRecorder (created by the useAudioRecorder hook
 *           in EmergencyContext and attached here)
 *   video → expo-camera CameraView.recordAsync (the camera preview lives in
 *           the emergency overlay and attaches its ref here when ready)
 *
 * Lifecycle guarantees:
 *  • At most one recording per kind — a second start is refused.
 *  • Permission denial / missing hardware / missing camera → 'error' with a
 *    clear reason, never 'recording'.
 *  • If the OS stops a recording on its own (camera unmounted, interruption,
 *    max duration) it is still saved and marked interrupted.
 *  • stopAll() resolves only after files are moved into private storage,
 *    with the REAL outcome per kind; nothing is 'saved' unless the move worked.
 */

const IDLE = { status: 'idle', error: null, uri: null, bytes: 0, interrupted: false };
const VIDEO_MAX_SECONDS = 60 * 60;
const STOP_TIMEOUT_MS = 10_000;

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(undefined), ms))]);

export function createRecordingService({
  save = saveRecording,
  audioMode = setAudioModeAsync,
  micPermission = { get: getRecordingPermissionsAsync, request: requestRecordingPermissionsAsync },
} = {}) {
  let audioRecorder = null;
  let audioStatusSub = null;
  let camera = null;
  const video = { promise: null, sessionId: null, stopping: false, finishing: null };
  let audioSessionId = null;

  let snapshot = { audio: { ...IDLE }, video: { ...IDLE } };
  const listeners = new Set();

  function _set(kind, patch) {
    snapshot = { ...snapshot, [kind]: { ...snapshot[kind], ...patch } };
    listeners.forEach((l) => l());
  }

  const busy = (kind) => ['requesting', 'recording', 'stopping'].includes(snapshot[kind].status);

  async function _finishVideo(uri) {
    const result = await save({ uri, sessionId: video.sessionId, kind: 'video' });
    _set('video', { status: result.status, error: result.error ?? null, uri: result.uri ?? null, bytes: result.bytes ?? 0 });
    video.promise = null;
    return { ...snapshot.video };
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSnapshot() {
      return snapshot;
    },

    attachAudioRecorder(recorder) {
      audioRecorder = recorder;
      audioStatusSub?.remove?.();
      audioStatusSub = recorder?.addListener?.('recordingStatusUpdate', (status) => {
        if (snapshot.audio.status !== 'recording') return;
        if (status?.hasError) _set('audio', { error: status.error ?? 'Recording error', interrupted: true });
        else if (status?.isFinished) _set('audio', { interrupted: true });
      }) ?? null;
    },

    /** Called by the overlay's CameraView (ref) once onCameraReady fires; null on unmount. */
    attachCamera(cameraRef) {
      camera = cameraRef;
    },

    isCameraAttached() {
      return camera !== null;
    },

    isBusy() {
      return busy('audio') || busy('video');
    },

    async startAudio(sessionId) {
      if (busy('audio')) return { success: false, duplicate: true, error: 'Audio recording already in progress' };
      if (!audioRecorder) {
        const error = 'Audio recorder is not ready.';
        _set('audio', { ...IDLE, status: 'error', error });
        return { success: false, error };
      }
      _set('audio', { ...IDLE, status: 'requesting' });
      try {
        let perm = await micPermission.get();
        if (!perm.granted && perm.canAskAgain !== false) perm = await micPermission.request();
        if (!perm.granted) {
          _set('audio', { status: 'error', error: 'Microphone permission denied.' });
          return { success: false, error: 'Microphone permission denied.' };
        }
        if (snapshot.audio.status !== 'requesting') return { success: false, error: 'Recording was stopped before it started.' };
        await audioMode({ allowsRecording: true, playsInSilentMode: true });
        await audioRecorder.prepareToRecordAsync();
        audioRecorder.record();
        audioSessionId = sessionId;
        _set('audio', { status: 'recording' });
        return { success: true };
      } catch (err) {
        const error = err?.message ?? 'Microphone unavailable.';
        _set('audio', { status: 'error', error });
        return { success: false, error };
      }
    },

    async startVideo(sessionId) {
      if (busy('video')) return { success: false, duplicate: true, error: 'Video recording already in progress' };
      if (!camera) {
        const error = 'Camera is not ready.';
        _set('video', { ...IDLE, status: 'error', error });
        return { success: false, error };
      }
      _set('video', { ...IDLE, status: 'recording' });
      video.sessionId = sessionId;
      video.stopping = false;
      try {
        video.promise = Promise.resolve(camera.recordAsync({ maxDuration: VIDEO_MAX_SECONDS }));
      } catch (err) {
        _set('video', { status: 'error', error: err?.message ?? 'Camera unavailable.' });
        video.promise = null;
        return { success: false, error: snapshot.video.error };
      }
      // If the recording ends without us asking (interruption, camera
      // unmounted, max duration), keep whatever was captured.
      video.promise.then(
        (res) => {
          if (!video.stopping && snapshot.video.status === 'recording') {
            _set('video', { status: 'stopping', interrupted: true });
            video.finishing = _finishVideo(res?.uri).finally(() => { video.finishing = null; });
          }
        },
        (err) => {
          if (!video.stopping) _set('video', { status: 'error', error: err?.message ?? 'Video recording failed.' });
        }
      );
      return { success: true };
    },

    async stopAudio() {
      if (snapshot.audio.status === 'requesting') {
        _set('audio', { status: 'idle' });
        return { ...snapshot.audio };
      }
      if (snapshot.audio.status !== 'recording' || !audioRecorder) return { ...snapshot.audio };
      _set('audio', { status: 'stopping' });
      try {
        await audioRecorder.stop();
      } catch (err) {
        _set('audio', { error: err?.message ?? 'Could not stop the recorder.' });
      }
      const result = await save({ uri: audioRecorder.uri, sessionId: audioSessionId, kind: 'audio' });
      await audioMode({ allowsRecording: false }).catch(() => {});
      _set('audio', { status: result.status, error: result.error ?? snapshot.audio.error, uri: result.uri ?? null, bytes: result.bytes ?? 0 });
      return { ...snapshot.audio };
    },

    async stopVideo() {
      if (video.finishing) return video.finishing; // system already stopped it; wait for the save
      if (snapshot.video.status !== 'recording' || !video.promise) return { ...snapshot.video };
      video.stopping = true;
      _set('video', { status: 'stopping' });
      try {
        camera?.stopRecording();
      } catch {
        // Camera already gone; the record promise settles on its own.
      }
      let res;
      try {
        res = await withTimeout(video.promise, STOP_TIMEOUT_MS);
      } catch (err) {
        _set('video', { status: 'error', error: err?.message ?? 'Video recording failed.' });
        video.promise = null;
        return { ...snapshot.video };
      }
      return _finishVideo(res?.uri);
    },

    async stopAll() {
      const [audio, videoResult] = await Promise.all([this.stopAudio(), this.stopVideo()]);
      return { audio, video: videoResult };
    },

    reset() {
      snapshot = { audio: { ...IDLE }, video: { ...IDLE } };
      listeners.forEach((l) => l());
    },
  };
}

export const recordingService = createRecordingService();
