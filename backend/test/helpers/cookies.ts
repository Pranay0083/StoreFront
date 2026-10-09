import type { Response } from 'supertest';
import type { TestApp } from './app';
import { API } from './app';

/** Returns `name=value` for a cookie set by the response, or undefined. */
export function cookieFrom(res: Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as string[] | string | undefined;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list
    .filter(c => c.startsWith(`${name}=`))
    .map(c => c.split(';')[0])
    .at(-1);
}

/** Raw Set-Cookie attributes for `name`, e.g. to assert Path/SameSite/HttpOnly. */
export function setCookieHeader(res: Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as string[] | string | undefined;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.filter(c => c.startsWith(`${name}=`)).at(-1);
}

export interface CsrfPair {
  token: string;
  cookie: string;
}

export async function fetchCsrf(t: TestApp): Promise<CsrfPair> {
  const res = await t.http().get(`${API}/auth/csrf`).expect(200);
  return { token: res.body.csrfToken, cookie: cookieFrom(res, 'csrf_token')! };
}
