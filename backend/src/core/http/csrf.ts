import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { CsrfError } from '../errors';
import { ACCESS_COOKIE, CookiePolicy, CSRF_COOKIE, REFRESH_COOKIE } from './cookies';

export const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Signed double-submit cookie. A state-changing request that authenticates with cookies must echo
 * the CSRF cookie in the X-CSRF-Token header; a cross-site page can trigger the request (and the
 * browser attaches the cookies) but can neither read the token nor set custom headers.
 */
export class CsrfProtection {
  constructor(
    private readonly secret: string,
    private readonly cookies: CookiePolicy,
    private readonly exemptPaths: readonly string[] = [],
  ) {}

  private sign(nonce: string): string {
    return createHmac('sha256', this.secret).update(nonce).digest('base64url');
  }

  isValid(token: string | undefined): boolean {
    if (!token) return false;
    const [nonce, signature, extra] = token.split('.');
    return !!nonce && !!signature && extra === undefined && safeEqual(signature, this.sign(nonce));
  }

  /** Returns the caller's current token, minting a new one when absent, invalid or `rotate` is set. */
  issue(req: Request, res: Response, { rotate = false } = {}): string {
    const current = req.cookies?.[CSRF_COOKIE] as string | undefined;
    let token = current;
    if (rotate || !this.isValid(current)) {
      const nonce = randomBytes(32).toString('base64url');
      token = `${nonce}.${this.sign(nonce)}`;
    }
    res.cookie(CSRF_COOKIE, token, this.cookies.csrf());
    return token!;
  }

  private exempt(path: string) {
    return this.exemptPaths.some(p => path === p || path.startsWith(`${p}/`));
  }

  readonly middleware: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method) || this.exempt(req.path)) return next();
    if (req.get('authorization')?.startsWith('Bearer ')) return next();
    const cookieAuthenticated = req.cookies?.[ACCESS_COOKIE] || req.cookies?.[REFRESH_COOKIE];
    if (!cookieAuthenticated) return next();
    const header = req.get(CSRF_HEADER);
    const cookie = req.cookies?.[CSRF_COOKIE] as string | undefined;
    if (!header || !cookie || !safeEqual(header, cookie) || !this.isValid(cookie)) return next(new CsrfError());
    next();
  };
}
