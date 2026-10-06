import cors from 'cors';
import type { RequestHandler } from 'express';
import helmet from 'helmet';
import type { Env } from '../config/env';
import { API_PREFIX } from './paths';

type SecurityEnv = Pick<Env, 'NODE_ENV' | 'FRONTEND_URL' | 'CORS_ORIGINS'>;

const DEV_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

export function allowedOrigins(env: SecurityEnv): string[] {
  if (env.CORS_ORIGINS?.length) return env.CORS_ORIGINS;
  return [env.FRONTEND_URL, ...(env.NODE_ENV === 'production' ? [] : DEV_ORIGINS)];
}

/** The API only ever returns JSON, so the document-level policy can deny everything. */
export function securityHeaders(env: Pick<Env, 'NODE_ENV'>): RequestHandler {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
    strictTransportSecurity: env.NODE_ENV === 'production' ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });
}

/**
 * Credentialed CORS for an explicit allow-list. Unknown origins get no CORS headers at all.
 * MCP is skipped here because it serves any origin through its own wildcard policy.
 */
export function corsPolicy(env: SecurityEnv): RequestHandler {
  const allowed = new Set(allowedOrigins(env));
  const middleware = cors({
    origin: (origin, done) => done(null, !origin || allowed.has(origin)),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['RateLimit', 'RateLimit-Policy', 'Retry-After', 'X-Request-Id'],
    maxAge: 600,
  });
  const mcpPrefix = `${API_PREFIX}/mcp`;
  return (req, res, next) => (req.path === mcpPrefix || req.path.startsWith(`${mcpPrefix}/`) ? next() : middleware(req, res, next));
}
