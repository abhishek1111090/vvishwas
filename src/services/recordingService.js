import { createRecordingWriter } from './recordingStore';

/**
 * recordingService.js — audio + video evidence recording
 *
 * Uses getUserMedia + MediaRecorder, which ARE available inside the native
 * app's WebView (Android System WebView / iOS 14.5+ WKWebView). Capacitor
 * routes the WebView's media request to the real OS permission dialog
 * (RECORD_AUDIO / CAMERA on Android; NSMicrophone/NSCameraUsageDescription
 * on iOS), so no extra native recorder plugin is needed. This has to be
 * confirmed on physical devices — see README "Physical device tests".
 *
 * Lifecycle guarantees:
 *  • At most one recorder per kind. A second start() while requesting or
 *    recording is refused — duplicate sessions can't leak camera/mic.
 *  • Chunks are flushed every second to recordingStore (app-private file
 *    on native, memory on web).
 *  • If the OS ends a track (call comes in, another app grabs the camera,
 *    permission revoked) the recorder is finalized and marked interrupted.
 *  • stopAll() resolves only after files are flushed, with the REAL outcome
 *    per kind ('saved' | 'ready' | 'error' | 'idle'); nothing is reported
 *    saved unless the write succeeded.
 *  • Every stop path releases the camera/microphone tracks.
 */

export function getSupportedMimeType(kind) {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates =
    kind === 'video'
      ? [
          'video/mp4;codecs=avc1,mp4a.40.2',
          'video/mp4;codecs=avc1',
          'video/mp4',
          'video/webm;codecs=vp9',
          'video/webm;codecs=vp8',
          'video/webm',
        ]
      : [
          'audio/mp4;codecs=mp4a.40.2',
          'audio/mp4',
          'audio/webm;codecs=opus',
          'audio/webm',
          'audio/ogg;codecs=opus',
        ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

const CONSTRAINTS = {
  audio: {
    audio: { echoCancellation: true, noiseSuppression: true },
    video: false,
  },
  video: {
    video: {
      facingMode: { ideal: 'environment' },   // back camera for evidence
      width: { ideal: 1280, max: 1920 },
      height: { ideal: 720, max: 1080 },
    },
    audio: false,                              // audio is captured separately
  },
};

function friendlyMediaError(err, kind) {
  const device = kind === 'audio' ? 'Microphone' : 'Camera';
  switch (err?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return `${device} permission denied.`;
    case 'NotFoundError':
    case 'OverconstrainedError':
      return `No ${device.toLowerCase()} found on this device.`;
    case 'NotReadableError':
    case 'AbortError':
      return `${device} is in use by another app.`;
    default:
      return err?.message ?? `${device} unavailable.`;
  }
}

const IDLE_KIND = { status: 'idle', error: null, mime: '', url: null, path: null, bytes: 0, interrupted: false };

export function createRecordingService({ createWriter = createRecordingWriter } = {}) {
  const slots = {
    audio: { stream: null, recorder: null, writer: null, done: null },
    video: { stream: null, recorder: null, writer: null, done: null },
  };

  let snapshot = {
    audio: { ...IDLE_KIND },
    video: { ...IDLE_KIND },
    isSupported:
      typeof MediaRecorder !== 'undefined' &&
      typeof globalThis.navigator?.mediaDevices?.getUserMedia === 'function',
  };

  const listeners = new Set();

  function _set(kind, patch) {
    snapshot = { ...snapshot, [kind]: { ...snapshot[kind], ...patch } };
    listeners.forEach((l) => l());
  }

  function _releaseStream(kind) {
    const slot = slots[kind];
    if (slot.stream) slot.stream.getTracks().forEach((t) => t.stop());
    slot.stream = null;
  }

  async function start(kind, sessionId) {
    const status = snapshot[kind].status;
    if (status === 'requesting' || status === 'recording' || status === 'stopping') {
      return { success: false, error: `${kind} recording already in progress`, duplicate: true };
    }
    if (!snapshot.isSupported) {
      const error = 'Recording is not supported on this device.';
      _set(kind, { ...IDLE_KIND, status: 'error', error });
      return { success: false, error };
    }

    _set(kind, { ...IDLE_KIND, status: 'requesting' });
    const slot = slots[kind];

    try {
      slot.stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS[kind]);
    } catch (err) {
      const error = friendlyMediaError(err, kind);
      _set(kind, { status: 'error', error });
      return { success: false, error };
    }

    // stopAll()/reset() may have run while the permission prompt was up.
    if (snapshot[kind].status !== 'requesting') {
      _releaseStream(kind);
      return { success: false, error: 'Recording was stopped before it started.' };
    }

    try {
      const mimeType = getSupportedMimeType(kind);
      const recorder = new MediaRecorder(slot.stream, mimeType ? { mimeType } : {});
      const effectiveMime = recorder.mimeType || mimeType;
      const writer = createWriter({ sessionId, kind, mime: effectiveMime });
      slot.recorder = recorder;
      slot.writer = writer;

      slot.done = new Promise((resolve) => {
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) writer.append(e.data);
        };
        recorder.onstop = () => resolve();
        recorder.onerror = (e) => {
          _set(kind, { error: e.error?.message ?? 'Recording error' });
          resolve();
        };
      });

      // The OS can end a track under us (incoming call, camera taken by
      // another app, permission revoked from Settings).
      slot.stream.getTracks().forEach((track) => {
        track.onended = () => {
          if (snapshot[kind].status === 'recording') {
            _set(kind, { interrupted: true });
            finalize(kind);
          }
        };
      });

      recorder.start(1000); // 1s chunks → flushed to storage as they arrive
      _set(kind, { status: 'recording', mime: effectiveMime });
      return { success: true };
    } catch (err) {
      _releaseStream(kind);
      const error = err?.message ?? String(err);
      _set(kind, { status: 'error', error });
      return { success: false, error };
    }
  }

  /** Stop one recorder, flush its file, release hardware. Resolves with the real result. */
  async function finalize(kind) {
    const slot = slots[kind];
    const current = snapshot[kind];

    if (current.status === 'requesting') {
      // Permission prompt still open — start() will see this and release.
      _set(kind, { status: 'idle' });
      return { ...snapshot[kind] };
    }
    if (current.status !== 'recording' || !slot.recorder) {
      _releaseStream(kind);
      return { ...current };
    }

    _set(kind, { status: 'stopping' });
    try {
      if (slot.recorder.state !== 'inactive') slot.recorder.stop();
    } catch {
      // Recorder already stopped by the browser; `done` resolves via onstop/onerror.
    }
    await Promise.race([slot.done, new Promise((r) => setTimeout(r, 5000))]);
    _releaseStream(kind);

    const result = await slot.writer.finalize();
    slot.recorder = null;
    slot.writer = null;
    slot.done = null;

    _set(kind, {
      status: result.status,
      error: result.error ?? snapshot[kind].error ?? null,
      url: result.url ?? null,
      path: result.path ?? null,
      bytes: result.bytes ?? 0,
      mime: result.mime ?? snapshot[kind].mime,
    });
    return { ...snapshot[kind] };
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSnapshot() {
      return snapshot;
    },

    startAudio(sessionId) {
      return start('audio', sessionId);
    },

    startVideo(sessionId) {
      return start('video', sessionId);
    },

    isBusy() {
      return ['requesting', 'recording', 'stopping'].some(
        (s) => snapshot.audio.status === s || snapshot.video.status === s
      );
    },

    /** Stop both recorders and wait until files are written. */
    async stopAll() {
      const [audio, video] = await Promise.all([finalize('audio'), finalize('video')]);
      return { audio, video };
    },

    /** Stop everything and return to idle (revokes in-memory web URLs). */
    async reset() {
      const results = await this.stopAll();
      for (const kind of ['audio', 'video']) {
        if (snapshot[kind].url) {
          try { URL.revokeObjectURL(snapshot[kind].url); } catch { /* already revoked */ }
        }
      }
      snapshot = { ...snapshot, audio: { ...IDLE_KIND }, video: { ...IDLE_KIND } };
      listeners.forEach((l) => l());
      return results;
    },
  };
}

export const recordingService = createRecordingService();
