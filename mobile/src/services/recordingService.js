import { setAudioModeAsync, getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import { Platform } from 'react-native';
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
 *  • Dual camera (custom iPhone build): front + back record at the same
 *    time into two files; video.uri is the back camera, video.front the front.
 *  • rotate() (used to send evidence during an SOS) saves what has been
 *    recorded so far as a part and keeps recording; every saved part is
 *    kept in `audio.parts` / `video.clips` and plays back as one recording.
 *  • Switching camera (front/back, 0.5x lens) ends the current video clip,
 *    saves it, and a new clip starts on the new camera. Every saved clip is
 *    kept in `video.clips`; photos taken during the SOS in `photos`.
 */

const IDLE = { status: 'idle', error: null, uri: null, bytes: 0, interrupted: false, clips: [], parts: [] };
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
  let dual = null; // DualCameraNativeView ref (front + back at once)
  const video = { promise: null, sessionId: null, stopping: false, finishing: null };
  let audioSessionId = null;
  let facing = 'back';
  let photoBusy = false;

  let snapshot = { audio: { ...IDLE }, video: { ...IDLE }, photos: [] };
  const listeners = new Set();

  function _set(kind, patch) {
    snapshot = { ...snapshot, [kind]: { ...snapshot[kind], ...patch } };
    listeners.forEach((l) => l());
  }

  const busy = (kind) => ['requesting', 'recording', 'stopping'].includes(snapshot[kind].status);

  async function _finishVideo(uri) {
    const result = await save({ uri, sessionId: video.sessionId, kind: 'video' });
    const clips = result.status === 'saved'
      ? [...snapshot.video.clips, { uri: result.uri, bytes: result.bytes ?? 0, facing: video.facing }]
      : snapshot.video.clips;
    _set('video', { status: result.status, error: result.error ?? null, uri: result.uri ?? null, bytes: result.bytes ?? 0, clips });
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
      return camera !== null || dual !== null;
    },

    /** The dual-camera view (custom build) once it reports ready; null on unmount. */
    attachDualCamera(ref) {
      dual = ref;
    },

    /** The dual camera stopped recording by itself (interruption): keep what was captured. */
    async onDualInterrupted() {
      if (video.mode !== 'dual' || snapshot.video.status !== 'recording') return;
      _set('video', { interrupted: true });
      await this.stopVideo();
    },

    /** Which camera new clips and photos come from ('back' | 'front'). */
    setFacing(value) {
      facing = value === 'front' ? 'front' : 'back';
    },

    /**
     * End the current video clip and save it (before switching camera).
     * Resolves with the saved clip state; a new clip starts when the
     * new camera reports ready.
     */
    async cutVideoClip() {
      return this.stopVideo();
    },

    /** Silent photo from the live evidence camera, saved privately. */
    async takePhoto(sessionId) {
      if (!camera && !dual) return { status: 'error', error: 'Camera is not ready.' };
      if (photoBusy) return { status: 'busy', error: 'Already taking a photo.' };
      photoBusy = true;
      try {
        const pic = dual ? await dual.takePicture() : await camera.takePictureAsync({ quality: 0.85, shutterSound: false });
        const result = await save({ uri: pic?.uri, sessionId, kind: 'photo' });
        if (result.status !== 'saved') return { status: 'error', error: result.error };
        const photo = { uri: result.uri, bytes: result.bytes ?? 0, facing, takenAt: new Date().toISOString() };
        snapshot = { ...snapshot, photos: [...snapshot.photos, photo] };
        listeners.forEach((l) => l());
        return { status: 'saved', ...photo };
      } catch (err) {
        return { status: 'error', error: err?.message ?? 'Could not take the photo.' };
      } finally {
        photoBusy = false;
      }
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
      if (dual) {
        _set('video', { ...IDLE, clips: snapshot.video.clips, frontClips: snapshot.video.frontClips ?? [], status: 'recording', front: null });
        video.sessionId = sessionId;
        video.mode = 'dual';
        video.stopping = false;
        try {
          await dual.startRecording();
          return { success: true };
        } catch (err) {
          _set('video', { status: 'error', error: err?.message ?? 'Cameras unavailable.' });
          video.mode = null;
          return { success: false, error: snapshot.video.error };
        }
      }
      video.mode = 'single';
      if (!camera) {
        const error = 'Camera is not ready.';
        _set('video', { ...IDLE, status: 'error', error });
        return { success: false, error };
      }
      _set('video', { ...IDLE, clips: snapshot.video.clips, status: 'recording' });
      video.sessionId = sessionId;
      video.facing = facing;
      video.stopping = false;
      try {
        // H.264 on iPhone (not HEVC) so clips play when sent on WhatsApp.
        video.promise = Promise.resolve(camera.recordAsync({ maxDuration: VIDEO_MAX_SECONDS, ...(Platform.OS === 'ios' ? { codec: 'avc1' } : {}) }));
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
      const parts = result.status === 'saved' ? [...snapshot.audio.parts, { uri: result.uri, bytes: result.bytes ?? 0 }] : snapshot.audio.parts;
      _set('audio', {
        status: result.status === 'saved' || parts.length ? 'saved' : result.status,
        error: result.error ?? snapshot.audio.error,
        uri: result.uri ?? parts[parts.length - 1]?.uri ?? null,
        bytes: result.bytes ?? 0,
        parts,
      });
      return { ...snapshot.audio };
    },

    async stopVideo() {
      if (video.mode === 'dual') {
        if (snapshot.video.status !== 'recording') return { ...snapshot.video };
        video.stopping = true;
        _set('video', { status: 'stopping' });
        let res;
        try {
          res = (await withTimeout(dual.stopRecording(), STOP_TIMEOUT_MS)) ?? {};
        } catch (err) {
          res = { back: { error: err?.message ?? 'Could not stop the cameras.' }, front: {} };
        }
        const back = res.back?.uri ? await save({ uri: res.back.uri, sessionId: video.sessionId, kind: 'video' }) : { status: 'error', error: res.back?.error ?? 'No back-camera video was produced.', bytes: 0 };
        const front = res.front?.uri ? await save({ uri: res.front.uri, sessionId: video.sessionId, kind: 'video' }) : { status: 'error', error: res.front?.error ?? 'No front-camera video was produced.', bytes: 0 };
        video.mode = null;
        _set('video', {
          status: back.status === 'saved' || front.status === 'saved' ? 'saved' : 'error',
          error: back.status === 'saved' ? null : back.error,
          uri: back.uri ?? null,
          bytes: back.bytes ?? 0,
          front: { status: front.status, uri: front.uri ?? null, bytes: front.bytes ?? 0, error: front.error ?? null },
          // Every saved part, so rotation + the final stop play back as one recording.
          clips: back.status === 'saved' ? [...snapshot.video.clips, { uri: back.uri, bytes: back.bytes ?? 0, facing: 'back' }] : snapshot.video.clips,
          frontClips: front.status === 'saved' ? [...(snapshot.video.frontClips ?? []), { uri: front.uri, bytes: front.bytes ?? 0, facing: 'front' }] : snapshot.video.frontClips ?? [],
        });
        return { ...snapshot.video };
      }
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

    /**
     * Save what has been recorded so far and keep recording (a few hundred
     * ms gap). Resolves { audio, video, front } with the parts just saved
     * (each { uri, bytes } or null).
     */
    async rotate(sessionId) {
      const out = { audio: null, video: null, front: null };

      if (snapshot.audio.status === 'recording' && audioRecorder) {
        try {
          await audioRecorder.stop();
          const res = await save({ uri: audioRecorder.uri, sessionId: audioSessionId ?? sessionId, kind: 'audio' });
          if (res.status === 'saved') {
            out.audio = { uri: res.uri, bytes: res.bytes ?? 0 };
            _set('audio', { parts: [...snapshot.audio.parts, out.audio] });
          }
          await audioRecorder.prepareToRecordAsync();
          audioRecorder.record();
        } catch (err) {
          _set('audio', { status: 'error', error: err?.message ?? 'Audio stopped while saving a part.' });
        }
      }

      if (snapshot.video.status === 'recording') {
        if (video.mode === 'dual') {
          const v = await this.stopVideo();
          if (v.status === 'saved' && v.uri) out.video = { uri: v.uri, bytes: v.bytes, facing: 'back' };
          if (v.front?.status === 'saved') out.front = { uri: v.front.uri, bytes: v.front.bytes, facing: 'front' };
          await this.startVideo(sessionId);
        } else {
          const count = snapshot.video.clips.length;
          await this.stopVideo();
          if (snapshot.video.clips.length > count) out.video = snapshot.video.clips[snapshot.video.clips.length - 1];
          await this.startVideo(sessionId);
        }
      }
      return out;
    },

    async stopAll() {
      const [audio, videoResult] = await Promise.all([this.stopAudio(), this.stopVideo()]);
      return { audio, video: videoResult, photos: [...snapshot.photos] };
    },

    reset() {
      snapshot = { audio: { ...IDLE }, video: { ...IDLE }, photos: [] };
      facing = 'back';
      video.mode = null;
      listeners.forEach((l) => l());
    },
  };
}

export const recordingService = createRecordingService();
