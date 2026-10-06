import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ForbiddenError } from '../../core/errors';
import { ACCESS_COOKIE } from '../../core/http/cookies';
import type { AuthService } from './auth.service';

export { ACCESS_COOKIE, REFRESH_COOKIE } from '../../core/http/cookies';

/** An explicit Bearer header wins over cookies so API clients are never mistaken for a browser session. */
function extractToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return req.cookies?.[ACCESS_COOKIE] as string | undefined;
}

export class AuthGuards {
  constructor(private readonly auth: AuthService) {}

  readonly requireAuth: RequestHandler = async (req: Request, _res: Response, next: NextFunction) => {
    req.user = await this.auth.authenticate(extractToken(req));
    next();
  };

  readonly optionalAuth: RequestHandler = async (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.user = await this.auth.authenticate(extractToken(req));
    } catch {
      req.user = undefined;
    }
    next();
  };

  readonly requireAdmin: RequestHandler = async (req: Request, _res: Response, next: NextFunction) => {
    const user = await this.auth.authenticate(extractToken(req));
    if (user.role !== 'admin') throw new ForbiddenError('Admin access required');
    req.user = user;
    next();
  };
}
