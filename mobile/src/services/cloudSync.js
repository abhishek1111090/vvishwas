import * as Crypto from 'expo-crypto';
import { sha256 } from '@noble/hashes/sha2.js';
import { apiGet, apiPost, apiPatch, apiUploadFileChunked, getApiBaseUrl, hasAuthToken, isApiConfigured } from './apiClient';
import { contentTypeFor } from './evidenceService';
import { readJSON, writeJSON } from '../utils/storage';
import { STORAGE_KEYS } from '../utils/constants';

/**
 * cloudSync.js — back up everything the app keeps on the phone to the
 * VISHWAS server (signed-in server accounts only): SOS events, live
 * location, recordings (audio, back/front video, photos), past SOS history,
 * and app data (emergency contacts, Voice SOS settings).
 *
 * Everything goes through a persisted queue, worked by two lanes so a big
 * video never holds up live location:
 *   data lane: sos (create) → locations → end (status + alert outcome) → app-data backup
 *   file lane: recording uploads, each only after its SOS reached the server
 * Recordings are uploaded while the SOS is still running (each saved part,
 * see emergencyController) and again at the end for anything left; a file
 * is never sent twice. The server is idempotent (SOS by clientId, files by
 * event/kind/part), so a retry after a lost reply never creates duplicates.
 * Network / server errors keep the item and retry with backoff; the queue
 * survives app restarts. Nothing here ever blocks or delays the SOS itself.
 *
 * Upload status per local file ('pending' | 'uploaded' | 'failed') is kept
 * for the History screen, so it only claims "backed up" after the server
 * confirmed it stored the file.
 */

const LOCATION_EVERY_MS = 30_000;
const LOCATION_EVERY_M = 50;
const MAX_QUEUE = 2000;
const BACKOFF_MS = [5_000, 30_000, 120_000, 600_000];

const metres = (a, b) => {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const digest = (value) => toHex(sha256(new TextEncoder().encode(JSON.stringify(value))));

/** 256-bit random token, base64url — the secret part of an emergency link. */
export function newShareToken(randomBytes = Crypto.getRandomBytes) {
  const bytes = randomBytes(32);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return globalThis.btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

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

/**
 * The recorder's live snapshot (parts saved so far during an SOS) in the
 * same shape the SOS keeps when it ends, so part numbers always match.
 */
export function recordingsSoFar(snap) {
  if (!snap) return null;
  return {
    audio: { parts: snap.audio?.parts ?? [] },
    video: { clips: snap.video?.clips ?? [], front: { clips: snap.video?.frontClips ?? [] } },
    photos: snap.photos ?? [],
  };
}

const contactsOf = (session) =>
  (session.alerts?.recipients ?? []).map((r) => ({ id: r.contactId, name: r.name, phoneNumber: r.phoneNumber }));

export function createCloudSync({
  post = apiPost,
  patch = apiPatch,
  get = apiGet,
  upload = apiUploadFileChunked,
  isSignedIn = () => isApiConfigured() && hasAuthToken(),
  read = (key, fallback) => readJSON(key, fallback),
  write = (key, value) => writeJSON(key, value),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = () => Date.now(),
  makeShareToken = newShareToken,
  baseUrl = getApiBaseUrl,
} = {}) {
  let queue = null;
  let status = null;
  let synced = null; // SOS ids already queued for the server (live or from history)
  const running = { data: false, file: false };
  const attempt = { data: 0, file: 0 };
  let retryTimer = null;
  const lastLoc = new Map(); // clientId → { at, loc }
  const listeners = new Set();

  const load = () => {
    if (queue === null) queue = read(STORAGE_KEYS.cloudQueue, []) ?? [];
    if (status === null) status = read(STORAGE_KEYS.cloudUploads, {}) ?? {};
    if (synced === null) synced = new Set(read(STORAGE_KEYS.cloudSynced, []) ?? []);
    if (!read(STORAGE_KEYS.cloudResync, false)) {
      // One-time re-check: a server before chunk support kept only the first 1 MB of big
      // files while reporting success. Send history again; complete files are recognised
      // by the server after one piece, cut-short ones are replaced. Final failures stay.
      synced = new Set();
      status = Object.fromEntries(Object.entries(status).filter(([, v]) => v !== 'uploaded'));
      write(STORAGE_KEYS.cloudResync, true);
      persist();
    }
  };
  const persist = () => {
    write(STORAGE_KEYS.cloudQueue, queue.slice(-MAX_QUEUE));
    write(STORAGE_KEYS.cloudUploads, status);
    write(STORAGE_KEYS.cloudSynced, [...synced]);
  };
  const notify = () => listeners.forEach((l) => l());
  const setStatus = (uri, value) => {
    status = { ...status, [uri]: value };
    notify();
  };

  /** Upload items for files that were never queued (or already sent) before. */
  const newFiles = (items) => {
    const seen = new Set(queue.filter((i) => i.type === 'upload').map((i) => i.uri));
    return items.filter((i) => {
      if (status[i.uri] !== undefined || seen.has(i.uri)) return false;
      seen.add(i.uri);
      return true;
    });
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
        return post('/sos', {
          clientId: item.clientId, triggerSource: item.triggerSource, startedAt: item.startedAt, contacts: item.contacts,
          shareToken: item.shareToken, ...(item.location ? { location: item.location } : {}),
        });
      case 'loc':
        return post('/location', { sosClientId: item.clientId, latitude: item.latitude, longitude: item.longitude, accuracy: item.accuracy, recordedAt: item.recordedAt });
      case 'end':
        return patch(`/sos/${encodeURIComponent(item.clientId)}`, { status: item.status, endedAt: item.endedAt, alertSummary: item.alertSummary });
      case 'backup':
        await post('/backup', item.doc);
        write(STORAGE_KEYS.cloudBackupHash, item.hash);
        return null;
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

  // Data items go strictly in order. A file waits until its SOS has reached the
  // server; small files (audio, photos) go before videos, and a file waiting to
  // retry never holds up the others.
  const FILE_ORDER = { audio: 0, photo: 1, video: 2 };
  const nextFor = (lane) => {
    if (lane === 'data') return queue.find((i) => i.type !== 'upload');
    const ready = queue.filter((i) => i.type === 'upload' && !(i.retryAt > now()) && !queue.some((q) => q.type === 'sos' && q.clientId === i.clientId));
    return ready.sort((a, b) => (FILE_ORDER[a.kind] ?? 3) - (FILE_ORDER[b.kind] ?? 3))[0];
  };
  const scheduleRetry = (delay) => {
    if (retryTimer) return;
    retryTimer = setTimer(() => { retryTimer = null; process(); }, delay);
  };

  async function runLane(lane) {
    if (running[lane]) return;
    running[lane] = true;
    try {
      for (;;) {
        if (!isSignedIn()) break;
        const item = nextFor(lane);
        if (!item) break;
        try {
          await send(item);
          if (item.type === 'upload') {
            setStatus(item.uri, 'uploaded');
            console.log(`[cloud] uploaded ${item.kind} ${item.part}`);
          }
          attempt[lane] = 0;
        } catch (err) {
          // Diagnostics without secrets: item kind and the server's answer only.
          console.warn(`[cloud] ${item.type}${item.kind ? ` ${item.kind} ${item.part}` : ''} failed: ${err?.status ?? err?.code ?? '?'} ${err?.message ?? err}`);
          if (err?.status === 401) break; // signed out / expired: keep everything until the next sign-in
          const retryable = !err?.status || err.status >= 500 || err.status === 429 || err.status === 408;
          if (retryable && lane === 'file') {
            // This file waits; the others keep going.
            item.tries = (item.tries ?? 0) + 1;
            const delay = BACKOFF_MS[Math.min(item.tries - 1, BACKOFF_MS.length - 1)];
            item.retryAt = now() + delay;
            persist();
            scheduleRetry(delay);
            continue;
          }
          if (retryable) {
            const delay = BACKOFF_MS[Math.min(attempt[lane], BACKOFF_MS.length - 1)];
            attempt[lane] += 1;
            scheduleRetry(delay);
            break;
          }
          // The server refused this item for good (e.g. file type, unknown event): don't retry forever.
          if (item.type === 'upload') setStatus(item.uri, 'failed');
        }
        queue.splice(queue.indexOf(item), 1);
        persist();
        if (item.type === 'sos') runLane('file'); // its files can go now
      }
    } finally {
      running[lane] = false;
      persist();
    }
  }

  async function process({ retryNow = false } = {}) {
    load();
    if (!isSignedIn() || queue.length === 0) return;
    if (retryTimer) {
      clearTimer(retryTimer);
      retryTimer = null;
    }
    // App reopened / signed in again: files waiting to retry may go now.
    if (retryNow) queue.forEach((i) => { if (i.retryAt) i.retryAt = 0; });
    await Promise.all([runLane('data'), runLane('file')]);
    const waiting = queue.filter((i) => i.retryAt > now()).map((i) => i.retryAt - now());
    if (waiting.length && !retryTimer) scheduleRetry(Math.min(...waiting));
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
    isBackingUp: () => isSignedIn(),

    /**
     * Queue the SOS for the server. For signed-in server accounts it also
     * returns the emergency link for the alert text: <server>/share/<token>
     * opens this SOS's location and recordings (and nothing else) once the
     * server has it. The token is made here, so the link exists even if the
     * phone is offline when the alert goes out. null when not backing up.
     */
    sosStarted(session, contacts = []) {
      if (!isSignedIn()) return null;
      load();
      let shareToken = null;
      try {
        shareToken = makeShareToken();
      } catch {
        shareToken = null; // no secure randomness: back up without a link rather than a guessable one
      }
      synced.add(session.id);
      enqueue([{
        type: 'sos',
        clientId: session.id,
        triggerSource: session.triggerSource,
        startedAt: session.startedAt,
        contacts: contacts.map((c) => ({ id: c.id, name: c.name, phoneNumber: c.phoneNumber })),
        ...(shareToken ? { shareToken } : {}),
      }]);
      return shareToken ? { shareUrl: `${baseUrl()}/share/${shareToken}` } : null;
    },

    /** Throttled: at most every 30 s, or after moving 50 m. */
    location(clientId, loc) {
      if (!loc || !isSignedIn()) return;
      const prev = lastLoc.get(clientId);
      if (prev && now() - prev.at < LOCATION_EVERY_MS && metres(prev.loc, loc) < LOCATION_EVERY_M) return;
      lastLoc.set(clientId, { at: now(), loc });
      enqueue([{ type: 'loc', clientId, latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy, recordedAt: loc.timestamp }]);
    },

    /** Upload recordings saved so far during an active SOS (each file once). */
    filesSaved(clientId, recordings) {
      if (!isSignedIn()) return;
      load();
      enqueue(newFiles(uploadsFor(clientId, recordings)));
    },

    sosEnded({ clientId, status: endStatus, endedAt, alertSummary, recordings }) {
      lastLoc.delete(clientId);
      if (!isSignedIn()) return;
      load();
      enqueue([{ type: 'end', clientId, status: endStatus, endedAt, alertSummary }, ...newFiles(uploadsFor(clientId, recordings))]);
    },

    /**
     * Past SOS events kept only on this phone (before signing in to the
     * server, or from a phone-only account): upload each one once — the
     * event, its last location, its alert outcome and every recording.
     */
    backfillHistory(history = []) {
      if (!isSignedIn()) return 0;
      load();
      const items = [];
      for (const s of history) {
        if (!s?.id || !s.startedAt || synced.has(s.id) || s.status === 'active' || s.status === 'ending') continue;
        synced.add(s.id);
        const loc = s.location;
        items.push({
          type: 'sos', clientId: s.id, triggerSource: s.triggerSource, startedAt: s.startedAt, contacts: contactsOf(s),
          ...(loc?.latitude != null ? { location: { latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy ?? null, timestamp: loc.timestamp } } : {}),
        });
        items.push({
          type: 'end', clientId: s.id, status: s.status === 'cancelled' ? 'cancelled' : 'resolved', endedAt: s.endedAt ?? s.startedAt,
          alertSummary: (s.alerts?.recipients ?? []).map((r) => ({ contactId: r.contactId, status: r.status, whatsapp: r.whatsapp?.status ?? null })),
        });
        items.push(...newFiles(uploadsFor(s.id, s.recordings)));
      }
      enqueue(items);
      return items.filter((i) => i.type === 'sos').length;
    },

    /** Back up app data (contacts, settings) when it changed since the last backup. */
    backupAppData(doc) {
      if (!isSignedIn() || !doc) return;
      load();
      const hash = digest(doc);
      const pending = queue.find((i) => i.type === 'backup');
      if (pending ? pending.hash === hash : read(STORAGE_KEYS.cloudBackupHash, null) === hash) return;
      queue = queue.filter((i) => i.type !== 'backup'); // only the newest copy matters
      enqueue([{ type: 'backup', doc, hash }]);
    },

    /** The app data saved on the server, or null (none / offline / not signed in). */
    async fetchAppData() {
      if (!isSignedIn()) return null;
      try {
        return (await get('/backup', { timeoutMs: 8000 }))?.backup ?? null;
      } catch {
        return null;
      }
    },

    /** Retry anything left from before (app start, back online, signed in again). */
    process: () => process({ retryNow: true }),
  };
}

export const cloudSync = createCloudSync();
