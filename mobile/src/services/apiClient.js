/**
 * apiClient.js — minimal HTTPS client for the (optional) VISHWAS server
 *
 * The server URL comes from EXPO_PUBLIC_VISHWAS_API_URL (see .env.example).
 * No credentials live in the app bundle. When unset, isApiConfigured() is
 * false and features that need the server say "not configured".
 */

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

export async function apiPost(path, body, { timeoutMs = 15_000, fetchImpl = globalThis.fetch } = {}) {
  if (!isApiConfigured()) throw new ApiError('VISHWAS server is not configured.', { code: 'NOT_CONFIGURED' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(`${getApiBaseUrl()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
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
