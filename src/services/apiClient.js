/**
 * apiClient.js — minimal HTTPS client for the (optional) VISHWAS server
 *
 * The server URL comes from the build-time env var VITE_VISHWAS_API_URL
 * (see .env.example). Nothing is hardcoded and no credentials live in the
 * app bundle. When the variable is unset, isApiConfigured() is false and
 * every feature that needs the server reports "not configured" instead of
 * pretending to work.
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
  const url = (import.meta.env?.VITE_VISHWAS_API_URL ?? '').trim();
  return url.replace(/\/+$/, '');
}

export function isApiConfigured() {
  const url = getApiBaseUrl();
  // Only HTTPS (or localhost during development) — emergency data must not
  // travel over plain HTTP.
  return /^https:\/\//i.test(url) || /^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:\d+)?$/i.test(url);
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
    data = null; // empty or non-JSON body
  }
  if (!response.ok) {
    // Never surface raw server internals; use the server's safe message if it gave one.
    const message = typeof data?.message === 'string' ? data.message : `Server error (${response.status}).`;
    throw new ApiError(message, { status: response.status, code: data?.code ?? 'HTTP_ERROR' });
  }
  return data;
}
