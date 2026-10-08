import { createHash } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError, BadRequestError, ConflictError } from '../../errors';
import { logger } from '../../logger';
import type { IdempotencyStore } from './idempotency.store';

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
const MAX_KEY_LENGTH = 255;

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(k => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
};

const sha256 = (data: string) => createHash('sha256').update(data).digest('hex');

export class IdempotencyKeyReusedError extends AppError {
  constructor() {
    super(422, 'This Idempotency-Key was already used with a different request', undefined, 'IDEMPOTENCY_KEY_REUSED');
  }
}

/**
 * Stripe-style idempotency for unsafe requests. The first request with a key runs and its response
 * (anything below 500) is stored; retries with the same key and body replay it, a different body
 * is rejected with 422 and a retry racing an in-flight original gets 409. Keys are scoped to the
 * user and route. Mount after auth and validation so only well-formed requests consume a key.
 */
export function idempotent(store: IdempotencyStore): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = req.header(IDEMPOTENCY_HEADER);
    if (key === undefined) return next();
    if (!key.trim() || key.length > MAX_KEY_LENGTH) {
      return next(new BadRequestError(`${IDEMPOTENCY_HEADER} must be 1-${MAX_KEY_LENGTH} characters`));
    }

    const id = sha256(`${req.user?.id ?? 'anonymous'}|${req.method}|${req.baseUrl}${req.path}|${key}`);
    const requestHash = sha256(JSON.stringify(canonical(req.body ?? null)));

    try {
      const claim = await store.begin(id, requestHash);
      if (!claim.acquired) {
        const { existing } = claim;
        if (existing.requestHash !== requestHash) return next(new IdempotencyKeyReusedError());
        if (existing.status === 'in_progress') {
          return next(new ConflictError('A request with this Idempotency-Key is still being processed'));
        }
        res.setHeader('Idempotent-Replayed', 'true');
        res.status(existing.responseStatus ?? 200).json(existing.responseBody);
        return;
      }
    } catch (err) {
      return next(err);
    }

    const send = res.json.bind(res);
    res.json = (body: unknown) => {
      const status = res.statusCode;
      // Store the serialized form so domain objects are replayed exactly as they were sent.
      const persisted = status >= 500 ? store.release(id) : store.complete(id, status, JSON.parse(JSON.stringify(body ?? null)));
      persisted.catch(err => logger.error({ err }, 'Failed to persist idempotent response')).finally(() => send(body));
      return res;
    };
    next();
  };
}
