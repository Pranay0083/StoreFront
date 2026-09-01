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
  const res = await fetch(`${BASE}/api${path}`, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data?.error || 'Something went wrong', res.status);
  return data as T;
}

export const fmtINR = (n: number) => `₹${(n ?? 0).toLocaleString('en-IN')}`;

export const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export const fmtDateTime = (d: string | Date) =>
  new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
