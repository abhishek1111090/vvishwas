import { apiUploadFile } from './apiClient';

/**
 * evidenceService.js — send SOS audio/video to contacts on WhatsApp
 *
 * While an SOS is active and the server has WhatsApp, every CLIP_MS the
 * recording so far is saved as a part (recording continues) and uploaded:
 *   POST /alerts/:sessionId/media?kind=audio|video&part=N
 * The server sends each clip to every emergency contact on WhatsApp.
 * When the SOS ends, the final parts are sent the same way.
 *
 * Uploads run one at a time, retry, and are idempotent on the server, so a
 * flaky connection never sends a clip twice. Every outcome is logged.
 */

export const CLIP_MS = 30_000;
const RETRIES = 3;

const TYPE_BY_EXT = { m4a: 'audio/mp4', aac: 'audio/aac', mp4: 'video/mp4', mov: 'video/quicktime' };

export function contentTypeFor(uri, kind) {
  const ext = String(uri ?? '').split('?')[0].split('.').pop().toLowerCase();
  return TYPE_BY_EXT[ext] ?? (kind === 'audio' ? 'audio/mp4' : 'video/mp4');
}

export function createEvidenceService({ recording, upload = apiUploadFile, log, setTimer = setInterval, clearTimer = clearInterval, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  let sessionId = null;
  let timer = null;
  let rotating = null; // in-flight rotation
  let queue = Promise.resolve();
  const counters = { audio: 0, video: 0 };
  const sent = { audio: 0, video: 0 };

  async function sendOne(id, kind, part, file) {
    const label = kind === 'audio' ? '🎙 Audio' : '🎥 Video';
    for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
      try {
        const res = await upload(
          `/alerts/${encodeURIComponent(id)}/media?kind=${kind}&part=${part}`,
          file.uri,
          contentTypeFor(file.uri, kind)
        );
        sent[kind] += 1;
        const n = res?.sentTo ?? 0;
        log(`${label} clip ${part} sent on WhatsApp to ${n} contact${n === 1 ? '' : 's'}`, n > 0 ? 'success' : 'warning');
        return;
      } catch (err) {
        if (err?.status && err.status < 500 && err.status !== 429) {
          log(`${label} clip ${part} not sent: ${err.message}`, 'error');
          return; // permanent (bad type, WhatsApp off…) — retrying won't help
        }
        if (attempt === RETRIES) {
          log(`${label} clip ${part} not sent after ${RETRIES} tries: ${err?.message ?? 'upload failed'}`, 'error');
          return;
        }
        await sleep(2000 * attempt);
      }
    }
  }

  function enqueue(kind, file) {
    if (!file?.uri || !sessionId) return queue;
    counters[kind] += 1;
    const part = counters[kind];
    const id = sessionId;
    queue = queue.then(() => sendOne(id, kind, part, file));
    return queue;
  }

  function tick() {
    if (!sessionId || rotating) return rotating;
    rotating = (async () => {
      try {
        const parts = await recording.rotate(sessionId);
        enqueue('audio', parts.audio);
        enqueue('video', parts.video);
        enqueue('video', parts.front);
      } finally {
        rotating = null;
      }
    })();
    return rotating;
  }

  return {
    isRunning: () => sessionId !== null,

    start(id) {
      if (sessionId) return;
      sessionId = id;
      counters.audio = 0;
      counters.video = 0;
      sent.audio = 0;
      sent.video = 0;
      log(`📤 Evidence will be sent to contacts on WhatsApp every ${CLIP_MS / 1000} s`);
      timer = setTimer(tick, CLIP_MS);
    },

    /** Stop the timer and let a rotation in progress finish (before the recorders are stopped). */
    async stop() {
      clearTimer(timer);
      timer = null;
      if (rotating) await rotating;
    },

    /** Test hook / manual trigger: save and send what's recorded so far. */
    tick,

    /**
     * Send the final parts saved when the SOS ended, then wait (up to
     * `waitMs`) for queued uploads so their results land in this SOS's log.
     */
    async finish({ audio, video, front } = {}, waitMs = 12_000) {
      if (!sessionId) return;
      enqueue('audio', audio);
      enqueue('video', video);
      enqueue('video', front);
      const done = await Promise.race([queue.then(() => true), new Promise((r) => setTimeout(() => r(false), waitMs))]);
      if (!done) log('📤 Some clips are still uploading — they will keep sending in the background', 'warning');
      sessionId = null;
    },
  };
}
