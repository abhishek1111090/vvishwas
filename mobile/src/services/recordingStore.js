import { File, Directory, Paths } from 'expo-file-system';

/**
 * recordingStore.js — moves finished recordings into private app storage
 *
 * expo-camera and expo-audio write to the app's cache directory, which the
 * OS may purge. Finished files are moved to
 *   <Documents>/recordings/<sessionId>/<kind>-<timestamp>.<ext>
 * inside the app sandbox — not the Photos library, not shared storage.
 * Only a successful move is reported as 'saved'.
 */

const DEFAULT_EXT = { audio: '.m4a', video: '.mp4', photo: '.jpg' };

export async function saveRecording({ uri, sessionId, kind, fs = { File, Directory, Paths } }) {
  if (!uri) return { status: 'error', error: `No ${kind} file was produced.`, bytes: 0 };
  try {
    const source = new fs.File(uri);
    if (!source.exists) return { status: 'error', error: `The ${kind} file is missing.`, bytes: 0 };
    const bytes = source.size ?? 0;
    if (!bytes) return { status: 'error', error: `No ${kind} data was captured.`, bytes: 0 };

    const dir = new fs.Directory(fs.Paths.document, 'recordings', sessionId);
    if (!dir.exists) dir.create({ intermediates: true });

    const rawExt = source.extension || DEFAULT_EXT[kind];
    const ext = rawExt.startsWith('.') ? rawExt : `.${rawExt}`;
    const destination = new fs.File(dir, `${kind}-${Date.now()}${ext}`);
    await source.move(destination);
    return { status: 'saved', uri: destination.uri, bytes };
  } catch (err) {
    return { status: 'error', error: `Could not save ${kind} recording: ${err?.message ?? err}`, bytes: 0 };
  }
}
