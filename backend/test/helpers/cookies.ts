import type { Response } from 'supertest';

/** Returns `name=value` for a cookie set by the response, or undefined. */
export function cookieFrom(res: Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as string[] | string | undefined;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list
    .filter(c => c.startsWith(`${name}=`))
    .map(c => c.split(';')[0])
    .at(-1);
}
