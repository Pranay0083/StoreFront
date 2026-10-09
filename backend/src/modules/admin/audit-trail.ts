import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { logger } from '../../core/logger';
import type { AuditService } from './audit.service';

/** Controllers can enrich their entry via `res.locals.audit`, e.g. with a before/after diff. */
export interface AuditAnnotation {
  targets?: string[];
  changes?: Record<string, unknown>;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SENSITIVE_KEY = /pass|secret|token|signature|otp|cvv|card/i;
const OBJECT_ID = /^[a-f\d]{24}$/i;
const MAX_STRING = 200;
const MAX_ITEMS = 20;
const MAX_DEPTH = 3;

/** Copies a request body for the audit log with secrets masked and large values truncated. */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'string' && value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (depth >= MAX_DEPTH) return '[…]';
  if (Array.isArray(value)) {
    const head = value.slice(0, MAX_ITEMS).map(v => redact(v, depth + 1));
    return value.length > MAX_ITEMS ? [...head, `…${value.length - MAX_ITEMS} more`] : head;
  }
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? '[redacted]' : redact(v, depth + 1)]));
}

export function targetsOf(path: string, body: unknown, responseBody: unknown): string[] {
  const ids = new Set(path.split('/').filter(seg => OBJECT_ID.test(seg)));
  const bulk = (body as { ids?: unknown })?.ids;
  if (Array.isArray(bulk)) for (const id of bulk.slice(0, 50)) if (typeof id === 'string') ids.add(id);
  if (!ids.size && responseBody && typeof responseBody === 'object') {
    const created = (responseBody as { _id?: unknown; id?: unknown })._id ?? (responseBody as { id?: unknown }).id;
    if (created) ids.add(String(created));
  }
  return [...ids];
}

/**
 * Records every state-changing request that passed a permission guard: who, which permission,
 * what route and targets, the (redacted) changes and the outcome. Written after the response
 * finishes so auditing never slows down or fails the request itself.
 */
export function auditTrail(audit: AuditService): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method)) return next();

    let responseBody: unknown;
    const json = res.json.bind(res);
    res.json = body => {
      responseBody = body;
      return json(body);
    };

    res.on('finish', () => {
      if (!req.user || !req.authz) return;
      const path = req.originalUrl.split('?')[0];
      const annotation = (res.locals.audit ?? {}) as AuditAnnotation;
      const changes = annotation.changes ?? (redact(req.body ?? {}) as Record<string, unknown>);
      const changedKeys = Object.keys(changes);
      audit
        .record({
          actorId: req.user.id,
          actorEmail: req.user.email,
          actorRole: req.user.role,
          permissions: req.authz.permissions,
          method: req.method,
          path,
          status: res.statusCode,
          targets: annotation.targets ?? targetsOf(path, req.body, responseBody),
          summary: `${req.method} ${path} → ${res.statusCode}${changedKeys.length ? ` (${changedKeys.join(', ')})` : ''}`,
          ...(changedKeys.length && { changes }),
          ip: req.ip,
          userAgent: req.get('user-agent')?.slice(0, 300),
        })
        .catch(err => logger.error({ err, path }, 'Failed to write audit log entry'));
    });
    next();
  };
}
