import type { Request } from 'express';
import type { Permission, Role } from '@storefront/contracts';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  permissions: Permission[];
}

/** What the permission guard authorised, recorded by the audit trail. */
export interface AuthzGrant {
  permissions: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      authz?: AuthzGrant;
      rawBody?: Buffer;
      requestId?: string;
    }
  }
}

export type IdParams = { id: string };

/** Request whose body/query/params have already been parsed by `validate()`. */
export type Req<Body = unknown, Query = unknown, Params = Record<string, string>> = Request<Params, unknown, Body, Query>;

/** Request guaranteed to carry an authenticated user (behind `requireAuth`). */
export type AuthedReq<Body = unknown, Query = unknown, Params = Record<string, string>> = Req<Body, Query, Params> & {
  user: AuthUser;
};
