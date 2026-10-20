/**
 * recordingService.js — Real audio + video recording with Safari/iOS compatibility
 *
 * Safari-specific constraints:
 *  • MediaRecorder supported from Safari 14.1 (iOS 14.5, Apr 2021)
 *  • Supported MIME types: audio/mp4, video/mp4  (NOT webm/ogg)
 *  • getUserMedia must be called within a user-gesture call stack on iOS
 *  • Cannot combine audio+video in one stream reliably — record separately
 *  • timeslice on start() works but ondataavailable may fire irregularly
 *
 * Architecture: plain pub-sub singleton (same shape as emergencyManager)
 * so EmergencyContext can subscribe via useSyncExternalStore.
 */

function getSupportedMimeType(kind) {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates =
    kind === 'video'
      ? [
          'video/mp4;codecs=avc1,mp4a.40.2',
          'video/mp4;codecs=avc1',
          'video/mp4',
          'video/webm;codecs=vp9,opus',
          'video/webm;codecs=vp8,opus',
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

function createRecordingService() {
  // Internal mutable state
  let audioStream = null;
  let videoStream = null;
  let audioRecorder = null;
  let videoRecorder = null;
  let audioChunks = [];
  let videoChunks = [];

  // Stable snapshot object — only replaced in _notify(), never mutated in place
  // (same pattern as the fixed emergencyManager to satisfy useSyncExternalStore)
  let snapshot = {
    audioStatus: 'idle',   // idle | requesting | recording | stopped | error
    videoStatus: 'idle',
    audioUrl: null,        // object URL for download once stopped
    videoUrl: null,
    audioMime: '',
    videoMime: '',
    audioError: null,
    videoError: null,
    isSupported: false,    // set on first access
  };

  const listeners = new Set();

  function _notify(patch) {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((l) => l());
  }

  function _stopStream(stream) {
    if (stream) stream.getTracks().forEach((t) => t.stop());
  }

  function _revokeIfNeeded(url) {
    if (url) {
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    }
  }

  // ─── public API ──────────────────────────────────────────────────────────

  return {
    subscribe(listener) {
      listeners.add(listener);
      // Hydrate isSupported on first subscription (can't access navigator at module init on SSR)
      if (!snapshot.isSupported) {
        const supported =
          typeof MediaRecorder !== 'undefined' &&
          typeof navigator?.mediaDevices?.getUserMedia === 'function';
        snapshot = { ...snapshot, isSupported: supported };
      }
      return () => listeners.delete(listener);
    },

    getSnapshot() {
      return snapshot;
    },

    /**
     * Start microphone audio recording.
     * Must be called within (or in a Promise chain from) a user-gesture handler
     * on iOS Safari so getUserMedia is allowed.
     */
    async startAudio() {
      // Revoke any previous recording URL to free memory
      _revokeIfNeeded(snapshot.audioUrl);
      _notify({ audioStatus: 'requesting', audioUrl: null, audioError: null });

      try {
        audioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            sampleRate: 44100,
          },
          video: false,
        });

        audioChunks = [];
        const mimeType = getSupportedMimeType('audio');
        const options = mimeType ? { mimeType } : {};
        audioRecorder = new MediaRecorder(audioStream, options);

        audioRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) audioChunks.push(e.data);
        };

        audioRecorder.onstop = () => {
          const effectiveMime = audioRecorder.mimeType || mimeType || 'audio/mp4';
          const blob = new Blob(audioChunks, { type: effectiveMime });
          const url = URL.createObjectURL(blob);
          _notify({ audioStatus: 'stopped', audioUrl: url, audioMime: effectiveMime });
        };

        audioRecorder.onerror = (e) => {
          _notify({ audioStatus: 'error', audioError: e.error?.message ?? 'Recording error' });
        };

        // timeslice=1000ms — collect a chunk every second so data isn't lost
        // if the tab is backgrounded (iOS will terminate background media after ~3 min)
        audioRecorder.start(1000);
        _notify({ audioStatus: 'recording', audioMime: mimeType });
        return { success: true };
      } catch (err) {
        const msg = err?.message ?? String(err);
        _notify({ audioStatus: 'error', audioError: msg });
        return { success: false, error: msg };
      }
    },

    /**
     * Start back-camera video recording (no audio — audio is captured separately).
     */
    async startVideo() {
      _revokeIfNeeded(snapshot.videoUrl);
      _notify({ videoStatus: 'requesting', videoUrl: null, videoError: null });

      try {
        // Prefer back (environment) camera for evidence capture
        const constraints = {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
          },
          audio: false,
        };

        videoStream = await navigator.mediaDevices.getUserMedia(constraints);

        videoChunks = [];
        const mimeType = getSupportedMimeType('video');
        const options = mimeType ? { mimeType } : {};
        videoRecorder = new MediaRecorder(videoStream, options);

        videoRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) videoChunks.push(e.data);
        };

        videoRecorder.onstop = () => {
          const effectiveMime = videoRecorder.mimeType || mimeType || 'video/mp4';
          const blob = new Blob(videoChunks, { type: effectiveMime });
          const url = URL.createObjectURL(blob);
          _notify({ videoStatus: 'stopped', videoUrl: url, videoMime: effectiveMime });
        };

        videoRecorder.onerror = (e) => {
          _notify({ videoStatus: 'error', videoError: e.error?.message ?? 'Recording error' });
        };

        videoRecorder.start(1000);
        _notify({ videoStatus: 'recording', videoMime: mimeType });
        return { success: true };
      } catch (err) {
        const msg = err?.message ?? String(err);
        _notify({ videoStatus: 'error', videoError: msg });
        return { success: false, error: msg };
      }
    },

    /** Stop both recorders gracefully. onstop callbacks fire async and create the URLs. */
    stopAll() {
      if (audioRecorder && audioRecorder.state !== 'inactive') {
        try { audioRecorder.stop(); } catch { /* already stopped */ }
      }
      _stopStream(audioStream);
      audioStream = null;

      if (videoRecorder && videoRecorder.state !== 'inactive') {
        try { videoRecorder.stop(); } catch { /* already stopped */ }
      }
      _stopStream(videoStream);
      videoStream = null;
    },

    /** Hard reset — stop everything and clear URLs (used on SOS cancel). */
    reset() {
      this.stopAll();
      _revokeIfNeeded(snapshot.audioUrl);
      _revokeIfNeeded(snapshot.videoUrl);
      audioChunks = [];
      videoChunks = [];
      _notify({
        audioStatus: 'idle',
        videoStatus: 'idle',
        audioUrl: null,
        videoUrl: null,
        audioError: null,
        videoError: null,
      });
    },
  };
}

export const recordingService = createRecordingService();
