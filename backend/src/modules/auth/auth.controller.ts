import type { LoginInput, RegisterInput } from '@storefront/contracts';
import type { CookieOptions, Request, Response } from 'express';
import type { AuthedReq, IdParams, Req } from '../../core/http/types';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './auth.guards';
import type { AuthService, ClientMeta, Session } from './auth.service';
import { ACCESS_TOKEN_TTL_MS } from './token.service';

const cookieOptions: CookieOptions = { httpOnly: true, secure: true, sameSite: 'none', path: '/' };

type AnyReq = Pick<Request, 'ip' | 'cookies' | 'get'>;

const clientMeta = (req: AnyReq): ClientMeta => ({ ip: req.ip, userAgent: req.get('user-agent') });
const refreshCookie = (req: AnyReq) => req.cookies?.[REFRESH_COOKIE] as string | undefined;

export class AuthController {
  constructor(private readonly auth: AuthService) {}

  register = async (req: Req<RegisterInput>, res: Response) => {
    const session = await this.auth.register(req.body, clientMeta(req));
    this.setCookies(res, session);
    res.status(201).json({ user: session.user, token: session.accessToken });
  };

  login = async (req: Req<LoginInput>, res: Response) => {
    const session = await this.auth.login(req.body, clientMeta(req));
    this.setCookies(res, session);
    res.json({ user: session.user, token: session.accessToken });
  };

  refresh = async (req: Request, res: Response) => {
    const session = await this.auth.refresh(refreshCookie(req), clientMeta(req));
    this.setCookies(res, session);
    res.json({ user: session.user });
  };

  logout = async (req: Request, res: Response) => {
    await this.auth.logout(refreshCookie(req));
    this.clearCookies(res);
    res.json({ ok: true });
  };

  logoutAll = async (req: AuthedReq, res: Response) => {
    const revoked = await this.auth.logoutAll(req.user.id);
    this.clearCookies(res);
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

  private setCookies(res: Response, session: Session) {
    res.cookie(ACCESS_COOKIE, session.accessToken, { ...cookieOptions, maxAge: ACCESS_TOKEN_TTL_MS });
    res.cookie(REFRESH_COOKIE, session.refreshToken, { ...cookieOptions, maxAge: session.refreshExpiresAt.getTime() - Date.now() });
  }

  private clearCookies(res: Response) {
    res.clearCookie(ACCESS_COOKIE, cookieOptions);
    res.clearCookie(REFRESH_COOKIE, cookieOptions);
  }
}
