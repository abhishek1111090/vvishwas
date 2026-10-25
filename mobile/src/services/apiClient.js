/**
 * apiClient.js — minimal HTTPS client for the (optional) VISHWAS server
 *
 * The server URL comes from EXPO_PUBLIC_VISHWAS_API_URL (see .env.example).
 * EXPO_PUBLIC_VISHWAS_API_KEY is sent as x-vishwas-key so the server only
 * accepts this app. It ships inside the app, so it is a gate against casual
 * misuse, not a secret; SMS-provider credentials stay on the server.
 * When the URL is unset, isApiConfigured() is false and features that need
 * the server say "not configured".
 */

import {
  uploadAsync, FileSystemUploadType, getInfoAsync, readAsStringAsync, writeAsStringAsync, deleteAsync, cacheDirectory,
} from 'expo-file-system/legacy';

export class ApiError extends Error {
  constructor(message, { status = null, code = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function getApiBaseUrl() {
  return (process.env.EXPO_PUBLIC_VISHWAS_API_URL ?? '').trim().replace(/\/+$/, '');
}

export function isApiConfigured() {
  // HTTPS only — emergency data must not travel over plain HTTP.
  return /^https:\/\//i.test(getApiBaseUrl());
}

// Bearer token of the signed-in server account (set by authService; null
// when signed out or using an on-device account).
let authToken = null;
export function setAuthToken(token) {
  authToken = token || null;
}
export const hasAuthToken = () => authToken !== null;

function headers() {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json' };
  const key = (process.env.EXPO_PUBLIC_VISHWAS_API_KEY ?? '').trim();
  if (key) h['x-vishwas-key'] = key;
  if (authToken) h.Authorization = `Bearer ${authToken}`;
  return h;
}

export function apiPost(path, body, options) {
  return request('POST', path, body, options);
}

export function apiGet(path, options) {
  return request('GET', path, undefined, options);
}

export function apiPatch(path, body, options) {
  return request('PATCH', path, body, options);
}

export function apiDelete(path, options) {
  return request('DELETE', path, undefined, options);
}

async function request(method, path, body, { timeoutMs = 15_000, fetchImpl = globalThis.fetch } = {}) {
  if (!isApiConfigured()) throw new ApiError('VISHWAS server is not configured.', { code: 'NOT_CONFIGURED' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(`${getApiBaseUrl()}${path}`, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw new ApiError('The server did not respond in time.', { code: 'TIMEOUT' });
    throw new ApiError('No internet connection or the server is unreachable.', { code: 'NETWORK' });
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const message = typeof data?.message === 'string' ? data.message : `Server error (${response.status}).`;
    throw new ApiError(message, { status: response.status, code: data?.code ?? 'HTTP_ERROR' });
  }
  return data;
}

/**
 * Upload a saved file (raw bytes, not multipart) and return the JSON reply.
 * Used for SOS evidence clips; the file is streamed from disk by the OS.
 */
export async function apiUploadFile(path, fileUri, contentType, { upload = uploadAsync } = {}) {
  if (!isApiConfigured()) throw new ApiError('VISHWAS server is not configured.', { code: 'NOT_CONFIGURED' });
  let res;
  try {
    res = await upload(`${getApiBaseUrl()}${path}`, fileUri, {
      httpMethod: 'POST',
      uploadType: FileSystemUploadType.BINARY_CONTENT,
      headers: { ...headers(), 'Content-Type': contentType },
    });
  } catch (err) {
    throw new ApiError(err?.message ?? 'Upload failed — no connection?', { code: 'NETWORK' });
  }
  let data = null;
  try {
    data = JSON.parse(res.body);
  } catch {
    data = null;
  }
  if (res.status < 200 || res.status >= 300) {
    throw new ApiError(typeof data?.message === 'string' ? data.message : `Server error (${res.status}).`, { status: res.status, code: data?.code ?? 'HTTP_ERROR' });
  }
  return data;
}

export const CHUNK_BYTES = 1024 * 1024;

/**
 * Upload a big file in pieces (`&offset=&total=`), each small enough to
 * finish on a slow link before a proxy time limit (Cloudflare: 100 s). The
 * server says how much it has after every piece, so an interrupted upload
 * (or a retry after an app restart) continues where it stopped. Small files
 * go in one request. Returns the server's final reply ({ recording }).
 */
export async function apiUploadFileChunked(path, fileUri, contentType, {
  chunkBytes = CHUNK_BYTES,
  fs = { getInfoAsync, readAsStringAsync, writeAsStringAsync, deleteAsync, cacheDirectory },
  uploadFile = apiUploadFile,
} = {}) {
  const info = await fs.getInfoAsync(fileUri);
  if (!info?.exists) throw new ApiError('The recording file is no longer on this phone.', { status: 410, code: 'FILE_GONE' });
  const total = info.size ?? 0;
  if (total <= chunkBytes) return uploadFile(path, fileUri, contentType);

  const piece = `${fs.cacheDirectory}vishwas-upload-${Date.now()}-${Math.random().toString(36).slice(2)}.part`;
  try {
    let offset = 0;
    for (let guard = 0; guard < Math.ceil(total / chunkBytes) * 3 + 3; guard += 1) {
      const length = Math.min(chunkBytes, total - offset);
      const b64 = await fs.readAsStringAsync(fileUri, { encoding: 'base64', position: offset, length });
      await fs.writeAsStringAsync(piece, b64, { encoding: 'base64' });
      const res = await uploadFile(`${path}&offset=${offset}&total=${total}`, piece, contentType);
      if (res?.recording) return res;
      const received = Number(res?.received);
      if (!Number.isFinite(received) || received < 0 || received >= total) throw new ApiError('Unexpected upload reply.', { code: 'BAD_REPLY' });
      offset = received;
    }
    throw new ApiError('Upload did not finish.', { code: 'NO_PROGRESS' });
  } finally {
    fs.deleteAsync(piece, { idempotent: true }).catch(() => {});
  }
}
