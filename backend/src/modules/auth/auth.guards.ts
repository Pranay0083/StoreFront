import { isStaff, type Permission, type Role } from '@storefront/contracts';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ForbiddenError } from '../../core/errors';
import { ACCESS_COOKIE } from '../../core/http/cookies';
import type { AuthUser } from '../../core/http/types';
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

  /** Authenticates once per request; stacked guards reuse the resolved user. */
  private async resolve(req: Request): Promise<AuthUser> {
    req.user ??= await this.auth.authenticate(extractToken(req));
    return req.user;
  }

  readonly requireAuth: RequestHandler = async (req: Request, _res: Response, next: NextFunction) => {
    await this.resolve(req);
    next();
  };

  readonly optionalAuth: RequestHandler = async (req: Request, _res: Response, next: NextFunction) => {
    try {
      await this.resolve(req);
    } catch {
      req.user = undefined;
    }
    next();
  };

  /** Any back-office role; pair with `requirePermission` for the specific capability. */
  readonly requireStaff: RequestHandler = async (req: Request, _res: Response, next: NextFunction) => {
    const user = await this.resolve(req);
    if (!isStaff(user.role)) throw new ForbiddenError('Staff access required');
    next();
  };

  /** Requires every listed permission and records the grant for the audit trail. */
  requirePermission(...required: [Permission, ...Permission[]]): RequestHandler & { permissions: Permission[] } {
    const guard = async (req: Request, _res: Response, next: NextFunction) => {
      const user = await this.resolve(req);
      const missing = required.find(p => !user.permissions.includes(p));
      if (missing) throw new ForbiddenError(`Missing permission: ${missing}`);
      req.authz = { permissions: [...new Set([...(req.authz?.permissions ?? []), ...required])] };
      next();
    };
    return Object.assign(guard, { permissions: required });
  }

  requireRole(role: Role): RequestHandler & { role: Role } {
    const guard = async (req: Request, _res: Response, next: NextFunction) => {
      const user = await this.resolve(req);
      if (user.role !== role) throw new ForbiddenError(`${role} access required`);
      req.authz = { permissions: [`role:${role}`] };
      next();
    };
    return Object.assign(guard, { role });
  }

  /** @deprecated Prefer `requirePermission(...)`; kept so admin-only routes keep working. */
  readonly requireAdmin: RequestHandler = this.requireRole('admin');
}
