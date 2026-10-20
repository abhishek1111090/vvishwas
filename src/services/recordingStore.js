import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { isNative } from '../platform/platform';

/**
 * recordingStore.js — where evidence recordings are written
 *
 * NATIVE APP: chunks are appended to a file in the app's PRIVATE data
 * directory (Directory.Data → Android: /data/data/com.vishwas.safety/files,
 * iOS: Application Support). Other apps, the gallery and the public
 * Downloads folder cannot see these files. Writing chunk-by-chunk (every
 * second, as MediaRecorder hands them over) means a recording survives up
 * to its last second even if the app is killed mid-emergency.
 *
 * BROWSER: there is no private persistent file store we can rely on, so
 * chunks are kept in memory and exposed as an object URL the user can
 * download. The status for that case is 'ready', never 'saved'.
 */

export const RECORDINGS_DIR = 'recordings';

export function extensionForMime(mime) {
  const m = (mime ?? '').toLowerCase();
  if (m.includes('mp4')) return m.startsWith('audio') ? 'm4a' : 'mp4';
  if (m.includes('webm')) return 'webm';
  if (m.includes('ogg')) return 'ogg';
  return 'bin';
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read recording chunk.'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

function createNativeWriter({ sessionId, kind, mime, fs }) {
  const path = `${RECORDINGS_DIR}/${sessionId}/${kind}-${Date.now()}.${extensionForMime(mime)}`;
  let queue = Promise.resolve();
  let bytes = 0;
  let started = false;
  let failure = null;

  return {
    append(blob) {
      queue = queue.then(async () => {
        if (failure) return;
        try {
          const data = await blobToBase64(blob);
          if (!started) {
            await fs.writeFile({ path, data, directory: Directory.Data, recursive: true });
            started = true;
          } else {
            await fs.appendFile({ path, data, directory: Directory.Data });
          }
          bytes += blob.size;
        } catch (err) {
          failure = err;
        }
      });
      return queue;
    },
    async finalize() {
      await queue;
      if (failure) {
        return { status: 'error', error: `Could not save ${kind} recording: ${failure.message ?? failure}`, bytes, path: started ? path : null };
      }
      if (!started || bytes === 0) return { status: 'error', error: `No ${kind} data was captured.`, bytes: 0, path: null };
      return { status: 'saved', path, directory: 'DATA', bytes, mime };
    },
    async discard() {
      await queue;
      if (started) await fs.deleteFile({ path, directory: Directory.Data }).catch(() => {});
    },
  };
}

function createMemoryWriter({ kind, mime }) {
  const chunks = [];
  let bytes = 0;
  return {
    append(blob) {
      chunks.push(blob);
      bytes += blob.size;
      return Promise.resolve();
    },
    async finalize() {
      if (bytes === 0) return { status: 'error', error: `No ${kind} data was captured.`, bytes: 0 };
      const blob = new Blob(chunks, { type: mime || (kind === 'audio' ? 'audio/mp4' : 'video/mp4') });
      return { status: 'ready', url: URL.createObjectURL(blob), bytes, mime: blob.type };
    },
    async discard() {
      chunks.length = 0;
    },
  };
}

export function createRecordingWriter({ sessionId, kind, mime, native = isNative(), fs = Filesystem }) {
  return native
    ? createNativeWriter({ sessionId, kind, mime, fs })
    : createMemoryWriter({ kind, mime });
}

/** Turn a saved recording reference into a URL the WebView can play. */
export async function getPlayableUrl(recording, fs = Filesystem) {
  if (!recording) return null;
  if (recording.url) return recording.url;
  if (!recording.path) return null;
  const { uri } = await fs.getUri({ path: recording.path, directory: Directory.Data });
  return Capacitor.convertFileSrc(uri);
}

export async function deleteSessionRecordings(sessionId, fs = Filesystem) {
  if (!isNative()) return;
  await fs.rmdir({ path: `${RECORDINGS_DIR}/${sessionId}`, directory: Directory.Data, recursive: true }).catch(() => {});
}
