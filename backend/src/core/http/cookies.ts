import type { CookieOptions, Response } from 'express';
import type { Env } from '../config/env';
import { API_PREFIX } from './paths';

export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';
export const CSRF_COOKIE = 'csrf_token';
/** The refresh token is only ever sent to the auth endpoints that consume it. */
export const REFRESH_COOKIE_PATH = `${API_PREFIX}/auth`;

type CookieEnv = Pick<Env, 'NODE_ENV' | 'COOKIE_SAMESITE' | 'COOKIE_SECURE' | 'COOKIE_DOMAIN'>;

/**
 * Production defaults to SameSite=None; Secure because the storefront and API live on different
 * sites; elsewhere Lax over plain HTTP so local development works without TLS.
 */
export class CookiePolicy {
  readonly base: CookieOptions;

  constructor(env: CookieEnv) {
    const sameSite = env.COOKIE_SAMESITE ?? (env.NODE_ENV === 'production' ? 'none' : 'lax');
    const secure = env.COOKIE_SECURE ?? (sameSite === 'none' || env.NODE_ENV === 'production');
    this.base = { sameSite, secure, path: '/', ...(env.COOKIE_DOMAIN && { domain: env.COOKIE_DOMAIN }) };
  }

  access(maxAge: number): CookieOptions {
    return { ...this.base, httpOnly: true, maxAge };
  }

  refresh(maxAge: number): CookieOptions {
    return { ...this.base, httpOnly: true, path: REFRESH_COOKIE_PATH, maxAge };
  }

  /** Readable by same-site scripts; cross-site clients get the value from the response body instead. */
  csrf(): CookieOptions {
    return { ...this.base, httpOnly: false };
  }

  clearAuth(res: Response): void {
    res.clearCookie(ACCESS_COOKIE, this.base);
    res.clearCookie(REFRESH_COOKIE, { ...this.base, path: REFRESH_COOKIE_PATH });
    res.clearCookie(REFRESH_COOKIE, this.base);
  }
}
