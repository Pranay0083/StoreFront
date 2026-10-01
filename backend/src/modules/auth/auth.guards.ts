import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ForbiddenError } from '../../core/errors';
import type { AuthService } from './auth.service';

export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';

function extractToken(req: Request): string | undefined {
  const cookie = req.cookies?.[ACCESS_COOKIE] as string | undefined;
  if (cookie) return cookie;
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
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
