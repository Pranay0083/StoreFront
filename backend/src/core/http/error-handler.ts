import type { ApiErrorBody } from '@storefront/contracts';
import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { AppError, NotFoundError, TooManyRequestsError } from '../errors';
import { logger } from '../logger';

function normalize(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof mongoose.Error.CastError) return new AppError(400, `Invalid ${err.path}`, undefined, 'BAD_REQUEST');
  if (err instanceof SyntaxError && 'body' in err) return new AppError(400, 'Malformed JSON body', undefined, 'BAD_REQUEST');
  const status = (err as { status?: number; statusCode?: number })?.status ?? (err as { statusCode?: number })?.statusCode;
  if (status && status >= 400 && status < 500) return new AppError(status, (err as Error).message);
  return new AppError(500, 'Internal server error', undefined, 'INTERNAL');
}

export const notFoundHandler = (req: Request, _res: Response, next: NextFunction) =>
  next(new NotFoundError(`Route not found: ${req.method} ${req.path}`));

export const errorHandler = (err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const appErr = normalize(err);
  if (appErr.status >= 500) logger.error({ err, path: req.path }, 'Unhandled error');
  const body: ApiErrorBody = {
    error: appErr.message,
    ...(appErr.code && { code: appErr.code }),
    ...(appErr.details && { details: appErr.details }),
  };
  if (appErr instanceof TooManyRequestsError && appErr.retryAfterSeconds) res.set('Retry-After', String(appErr.retryAfterSeconds));
  res.status(appErr.status).json(body);
};
