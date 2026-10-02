export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const isServer = typeof window === 'undefined';
const BASE = (isServer ? process.env.INTERNAL_API_URL : process.env.NEXT_PUBLIC_API_URL) || process.env.NEXT_PUBLIC_API_URL || '';

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data?.error || 'Something went wrong', res.status);
  return data as T;
}

/** Formats an integer paise amount as rupees, e.g. 249900 → ₹2,499. */
export { formatINR as fmtINR } from '@storefront/contracts';

export const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export const fmtDateTime = (d: string | Date) =>
  new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
