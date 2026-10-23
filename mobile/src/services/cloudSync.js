import { apiPost, apiPatch, apiUploadFile, hasAuthToken, isApiConfigured } from './apiClient';
import { contentTypeFor } from './evidenceService';
import { readJSON, writeJSON } from '../utils/storage';
import { STORAGE_KEYS } from '../utils/constants';

/**
 * cloudSync.js — back up SOS events, location and recordings to the
 * VISHWAS server (signed-in server accounts only).
 *
 * Everything goes through a persisted queue, sent in order:
 *   sos (create) → locations → end (status + alert outcome) → file uploads
 * The server is idempotent (SOS by clientId, files by event/kind/part), so a
 * retry after a lost reply never creates duplicates. Network / server
 * errors keep the item and retry with backoff; the queue survives app
 * restarts. Nothing here ever blocks or delays the SOS itself.
 *
 * Upload status per local file ('pending' | 'uploaded' | 'failed') is kept
 * for the History screen, so it only claims "backed up" after the server
 * confirmed it stored the file.
 */

const LOCATION_EVERY_MS = 30_000;
const LOCATION_EVERY_M = 50;
const MAX_QUEUE = 500;
const BACKOFF_MS = [5_000, 30_000, 120_000, 600_000];

const metres = (a, b) => {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/** Every saved file of an SOS → upload items with stable kind/part numbers. */
export function uploadsFor(clientId, recordings) {
  if (!recordings) return [];
  const items = [];
  const add = (kind, part, file) => {
    if (file?.uri && (file.status === undefined || file.status === 'saved')) items.push({ type: 'upload', clientId, kind, part, uri: file.uri });
  };
  const audio = recordings.audio;
  if (audio?.parts?.length) audio.parts.forEach((p, i) => add('audio', i + 1, p));
  else add('audio', 1, audio);
  const video = recordings.video;
  if (video?.clips?.length) video.clips.forEach((c, i) => add('video', i + 1, c));
  else add('video', 1, video);
  const front = video?.front;
  if (front?.clips?.length) front.clips.forEach((c, i) => add('video', 1001 + i, c));
  else add('video', 1001, front);
  (recordings.photos ?? []).forEach((p, i) => add('photo', i + 1, p));
  return items;
}

export function createCloudSync({
  post = apiPost,
  patch = apiPatch,
  upload = apiUploadFile,
  isSignedIn = () => isApiConfigured() && hasAuthToken(),
  read = (key, fallback) => readJSON(key, fallback),
  write = (key, value) => writeJSON(key, value),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = () => Date.now(),
} = {}) {
  let queue = null;
  let status = null;
  let running = false;
  let retryTimer = null;
  let attempt = 0;
  const lastLoc = new Map(); // clientId → { at, loc }
  const listeners = new Set();

  const load = () => {
    if (queue === null) queue = read(STORAGE_KEYS.cloudQueue, []) ?? [];
    if (status === null) status = read(STORAGE_KEYS.cloudUploads, {}) ?? {};
  };
  const persist = () => {
    write(STORAGE_KEYS.cloudQueue, queue.slice(-MAX_QUEUE));
    write(STORAGE_KEYS.cloudUploads, status);
  };
  const notify = () => listeners.forEach((l) => l());
  const setStatus = (uri, value) => {
    status = { ...status, [uri]: value };
    notify();
  };

  function enqueue(items) {
    if (!isSignedIn() || items.length === 0) return;
    load();
    queue.push(...items);
    items.filter((i) => i.type === 'upload').forEach((i) => setStatus(i.uri, 'pending'));
    persist();
    process();
  }

  async function send(item) {
    switch (item.type) {
      case 'sos':
        return post('/sos', { clientId: item.clientId, triggerSource: item.triggerSource, startedAt: item.startedAt, contacts: item.contacts });
      case 'loc':
        return post('/location', { sosClientId: item.clientId, latitude: item.latitude, longitude: item.longitude, accuracy: item.accuracy, recordedAt: item.recordedAt });
      case 'end':
        return patch(`/sos/${encodeURIComponent(item.clientId)}`, { status: item.status, endedAt: item.endedAt, alertSummary: item.alertSummary });
      case 'upload':
        return upload(
          `/recordings?sosClientId=${encodeURIComponent(item.clientId)}&kind=${item.kind}&part=${item.part}`,
          item.uri,
          item.kind === 'photo' ? 'image/jpeg' : contentTypeFor(item.uri, item.kind)
        );
      default:
        return null;
    }
  }

  async function process() {
    load();
    if (running || !isSignedIn() || queue.length === 0) return;
    running = true;
    clearTimer(retryTimer);
    retryTimer = null;
    try {
      while (queue.length > 0) {
        const item = queue[0];
        try {
          await send(item);
          if (item.type === 'upload') setStatus(item.uri, 'uploaded');
          attempt = 0;
        } catch (err) {
          const retryable = !err?.status || err.status >= 500 || err.status === 429 || err.status === 408;
          if (err?.status === 401) break; // signed out / expired: keep everything until the next sign-in
          if (retryable) {
            const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
            attempt += 1;
            retryTimer = setTimer(() => { retryTimer = null; process(); }, delay);
            break;
          }
          // The server refused this item for good (e.g. file type, unknown event): don't retry forever.
          if (item.type === 'upload') setStatus(item.uri, 'failed');
        }
        queue.shift();
        persist();
      }
    } finally {
      running = false;
      persist();
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** 'pending' | 'uploaded' | 'failed' | undefined (not backed up). */
    statusOf(uri) {
      load();
      return status[uri];
    },
    getStatusMap() {
      load();
      return status;
    },
    pendingCount() {
      load();
      return queue.length;
    },

    sosStarted(session, contacts = []) {
      enqueue([{
        type: 'sos',
        clientId: session.id,
        triggerSource: session.triggerSource,
        startedAt: session.startedAt,
        contacts: contacts.map((c) => ({ id: c.id, name: c.name, phoneNumber: c.phoneNumber })),
      }]);
    },

    /** Throttled: at most every 30 s, or after moving 50 m. */
    location(clientId, loc) {
      if (!loc || !isSignedIn()) return;
      const prev = lastLoc.get(clientId);
      if (prev && now() - prev.at < LOCATION_EVERY_MS && metres(prev.loc, loc) < LOCATION_EVERY_M) return;
      lastLoc.set(clientId, { at: now(), loc });
      enqueue([{ type: 'loc', clientId, latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy, recordedAt: loc.timestamp }]);
    },

    sosEnded({ clientId, status: endStatus, endedAt, alertSummary, recordings }) {
      lastLoc.delete(clientId);
      enqueue([{ type: 'end', clientId, status: endStatus, endedAt, alertSummary }, ...uploadsFor(clientId, recordings)]);
    },

    /** Retry anything left from before (app start, back online, signed in again). */
    process,
  };
}

export const cloudSync = createCloudSync();
