export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const isServer = typeof window === 'undefined';
const BASE = (isServer ? process.env.INTERNAL_API_URL : process.env.NEXT_PUBLIC_API_URL) || process.env.NEXT_PUBLIC_API_URL || '';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Endpoints that must never trigger a silent refresh-and-retry. */
const NO_REFRESH = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout', '/auth/csrf'];

// The API may live on another site, so the CSRF cookie is not readable here; the token is
// taken from response bodies and kept in memory instead.
let csrfToken: string | null = null;
let csrfRequest: Promise<string> | null = null;
let refreshRequest: Promise<boolean> | null = null;

/** Hint (not a credential) that a refresh cookie probably exists, so guests skip a pointless refresh. */
const SESSION_HINT = 'sf_has_session';
const sessionHint = {
  get: () => {
    try {
      return localStorage.getItem(SESSION_HINT) === '1';
    } catch {
      return false;
    }
  },
  set: (on: boolean) => {
    try {
      if (on) localStorage.setItem(SESSION_HINT, '1');
      else localStorage.removeItem(SESSION_HINT);
    } catch {}
  },
};

async function ensureCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  csrfRequest ??= fetch(`${BASE}/api/v1/auth/csrf`, { credentials: 'include' })
    .then(r => r.json())
    .then((d: { csrfToken: string }) => (csrfToken = d.csrfToken))
    .finally(() => (csrfRequest = null));
  return csrfRequest;
}

/** Single-flight: concurrent 401s share one refresh so the rotated token is not replayed. */
function refreshSession(): Promise<boolean> {
  refreshRequest ??= api('/auth/refresh', { method: 'POST' })
    .then(() => true)
    .catch(() => {
      sessionHint.set(false);
      return false;
    })
    .finally(() => (refreshRequest = null));
  return refreshRequest;
}

export async function api<T = any>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...((options.headers as Record<string, string>) || {}) };
  if (!isServer && !SAFE_METHODS.has(method)) headers['X-CSRF-Token'] = await ensureCsrfToken();

  const res = await fetch(`${BASE}/api/v1${path}`, { credentials: 'include', ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (typeof data?.csrfToken === 'string') csrfToken = data.csrfToken;
  if (!isServer && res.ok && ['/auth/login', '/auth/register', '/auth/refresh'].includes(path)) sessionHint.set(true);
  if (!isServer && path === '/auth/logout') sessionHint.set(false);

  if (!res.ok) {
    if (retry && !isServer) {
      if (res.status === 403 && data?.code === 'CSRF_INVALID') {
        csrfToken = null;
        return api<T>(path, options, false);
      }
      if (res.status === 401 && !NO_REFRESH.includes(path) && sessionHint.get() && (await refreshSession())) {
        return api<T>(path, options, false);
      }
    }
    throw new ApiError(data?.error || 'Something went wrong', res.status, data?.code);
  }
  return data as T;
}

/** Streaming POST (e.g. Server-Sent Events) with the same credentials and CSRF header as `api`. */
export async function apiStream(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
  if (!isServer) headers['X-CSRF-Token'] = await ensureCsrfToken();
  return fetch(`${BASE}/api/v1${path}`, { method: 'POST', credentials: 'include', headers, body: JSON.stringify(body), signal });
}

/** Multipart upload (e.g. CSV import); lets the browser set the boundary and still sends the CSRF token. */
export async function apiUpload<T = unknown>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-CSRF-Token': await ensureCsrfToken() },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data?.error || 'Upload failed', res.status, data?.code);
  return data as T;
}

export const apiUrl = (path: string) => `${BASE}/api/v1${path}`;

/** Formats an integer paise amount as rupees, e.g. 249900 → ₹2,499. */
export { formatINR as fmtINR } from '@storefront/contracts';

export const fmtDate = (d: string | Date) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export const fmtDateTime = (d: string | Date) =>
  new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
