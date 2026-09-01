import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { ZodSchema } from 'zod';
import { env } from '../config/env';
import { User } from '../models';

import { logger } from '../utils/logger';

/**
 * Custom error class to format API responses with status codes and optional detailed validation errors.
 */
export class ApiError extends Error {
  status: number;
  details?: any;
  constructor(status: number, message: string, details?: any) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// AUTH PROVIDER BOUNDARY — to swap in Firebase Auth later, replace this token
// verification with firebase-admin verifyIdToken() and map decoded.uid to a User doc.
/**
 * Resolves the authenticated user from the request's cookies or Authorization header.
 * Verifies the JWT and retrieves the user document from the database.
 * Throws an ApiError if the token is missing, invalid, or the user is not found.
 */
async function resolveUser(req: Request) {
  let token = req.cookies?.access_token as string | undefined;
  const header = req.headers.authorization;
  if (!token && header?.startsWith('Bearer ')) token = header.slice(7);
  if (!token) throw new ApiError(401, 'Not authenticated');
  let payload: any;
  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch (e: any) {
    throw new ApiError(401, e.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token');
  }
  if (payload.type !== 'access') throw new ApiError(401, 'Invalid token type');
  const user = await User.findById(payload.sub).lean();
  if (!user) throw new ApiError(401, 'User not found');
  return { id: String(user._id), email: user.email, name: user.name, role: user.role };
}

/**
 * Middleware that requires a valid authenticated user.
 * If authentication fails, it passes an error to the error handler.
 */
export const requireAuth = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    (req as any).user = await resolveUser(req);
    next();
  } catch (e) {
    next(e);
  }
};

/**
 * Middleware that optionally resolves a user if a token is present, 
 * but does not enforce authentication (allows guest access).
 */
export const optionalAuth = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    (req as any).user = await resolveUser(req);
  } catch {}
  next();
};

/**
 * Middleware that requires the authenticated user to have an 'admin' role.
 * Throws a 403 Forbidden error if the user is not an admin.
 */
export const requireAdmin = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const user = await resolveUser(req);
    if (user.role !== 'admin') throw new ApiError(403, 'Admin access required');
    (req as any).user = user;
    next();
  } catch (e) {
    next(e);
  }
};

/**
 * Factory middleware that validates the incoming request body against a Zod schema.
 * Replaces req.body with the parsed and validated data if successful, otherwise throws a 400 ApiError with details.
 */
export const validate = (schema: ZodSchema) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const msg = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      const details = result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }));
      return next(new ApiError(400, 'Validation failed', details));
    }
    req.body = result.data;
    next();
  };

/**
 * Global Express error handling middleware.
 * Formats caught exceptions into standardized JSON responses. Logs unexpected 500 errors.
 */
export const errorHandler = (err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof ApiError ? err.status : 500;
  const details = err instanceof ApiError ? err.details : undefined;
  if (status === 500) {
    logger.error({ err }, 'Internal server error');
  }
  res.status(status).json({ 
    error: err.message || 'Internal server error',
    ...(details && { details })
  });
};
