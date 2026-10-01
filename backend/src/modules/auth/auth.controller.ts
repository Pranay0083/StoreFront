import type { LoginInput, RegisterInput } from '@storefront/contracts';
import type { CookieOptions, Request, Response } from 'express';
import type { AuthedReq, Req } from '../../core/http/types';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './auth.guards';
import type { AuthService, Session } from './auth.service';
import { ACCESS_TOKEN_TTL_MS, REFRESH_TOKEN_TTL_MS } from './token.service';

const cookieOptions: CookieOptions = { httpOnly: true, secure: true, sameSite: 'none', path: '/' };

export class AuthController {
  constructor(private readonly auth: AuthService) {}

  register = async (req: Req<RegisterInput>, res: Response) => {
    const session = await this.auth.register(req.body);
    this.setCookies(res, session);
    res.status(201).json({ user: session.user, token: session.accessToken });
  };

  login = async (req: Req<LoginInput>, res: Response) => {
    const session = await this.auth.login(req.body);
    this.setCookies(res, session);
    res.json({ user: session.user, token: session.accessToken });
  };

  refresh = async (req: Request, res: Response) => {
    const session = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE] as string | undefined);
    this.setCookies(res, session);
    res.json({ user: session.user });
  };

  logout = (_req: Request, res: Response) => {
    res.clearCookie(ACCESS_COOKIE, cookieOptions);
    res.clearCookie(REFRESH_COOKIE, cookieOptions);
    res.json({ ok: true });
  };

  me = (req: AuthedReq, res: Response) => {
    res.json({ user: req.user });
  };

  private setCookies(res: Response, session: Session) {
    res.cookie(ACCESS_COOKIE, session.accessToken, { ...cookieOptions, maxAge: ACCESS_TOKEN_TTL_MS });
    res.cookie(REFRESH_COOKIE, session.refreshToken, { ...cookieOptions, maxAge: REFRESH_TOKEN_TTL_MS });
  }
}
