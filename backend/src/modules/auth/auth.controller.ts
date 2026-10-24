import type { LoginInput, RegisterInput } from '@storefront/contracts';
import type { Request, Response } from 'express';
import { ACCESS_COOKIE, REFRESH_COOKIE, type CookiePolicy } from '../../core/http/cookies';
import type { CsrfProtection } from '../../core/http/csrf';
import type { AuthedReq, IdParams, Req } from '../../core/http/types';
import type { AuthService, ClientMeta, Session } from './auth.service';
import { ACCESS_TOKEN_TTL_MS } from './token.service';

type AnyReq = Pick<Request, 'ip' | 'cookies' | 'get'>;

const clientMeta = (req: AnyReq): ClientMeta => ({ ip: req.ip, userAgent: req.get('user-agent') });
const refreshCookie = (req: AnyReq) => req.cookies?.[REFRESH_COOKIE] as string | undefined;

export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: CookiePolicy,
    private readonly csrf: CsrfProtection,
  ) {}

  csrfToken = (req: Request, res: Response) => {
    res.json({ csrfToken: this.csrf.issue(req, res) });
  };

  register = async (req: Req<RegisterInput>, res: Response) => {
    const session = await this.auth.register(req.body, clientMeta(req));
    this.setCookies(res, session);
    const csrfToken = this.csrf.issue(req as Request, res, { rotate: true });
    res.status(201).json({ user: session.user, token: session.accessToken, csrfToken });
  };

  login = async (req: Req<LoginInput>, res: Response) => {
    const session = await this.auth.login(req.body, clientMeta(req));
    this.setCookies(res, session);
    const csrfToken = this.csrf.issue(req as Request, res, { rotate: true });
    res.json({ user: session.user, token: session.accessToken, csrfToken });
  };

  refresh = async (req: Request, res: Response) => {
    const session = await this.auth.refresh(refreshCookie(req), clientMeta(req));
    this.setCookies(res, session);
    res.json({ user: session.user, csrfToken: this.csrf.issue(req, res) });
  };

  logout = async (req: Request, res: Response) => {
    await this.auth.logout(refreshCookie(req));
    this.cookies.clearAuth(res);
    res.json({ ok: true, csrfToken: this.csrf.issue(req, res, { rotate: true }) });
  };

  logoutAll = async (req: AuthedReq, res: Response) => {
    const revoked = await this.auth.logoutAll(req.user.id);
    this.cookies.clearAuth(res);
    res.json({ ok: true, revoked });
  };

  sessions = async (req: AuthedReq, res: Response) => {
    res.json({ sessions: await this.auth.listSessions(req.user.id, refreshCookie(req)) });
  };

  revokeSession = async (req: AuthedReq<unknown, unknown, IdParams>, res: Response) => {
    await this.auth.revokeSession(req.user.id, req.params.id);
    res.json({ ok: true });
  };

  me = (req: AuthedReq, res: Response) => {
    res.json({ user: req.user });
  };

  /** Like `me`, but a guest is a normal answer (200, `user: null`) rather than an error. */
  session = (req: Request, res: Response) => {
    res.json({ user: req.user ?? null });
  };

  private setCookies(res: Response, session: Session) {
    res.cookie(ACCESS_COOKIE, session.accessToken, this.cookies.access(ACCESS_TOKEN_TTL_MS));
    res.cookie(REFRESH_COOKIE, session.refreshToken, this.cookies.refresh(session.refreshExpiresAt.getTime() - Date.now()));
  }
}
