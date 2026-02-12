import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { ZodSchema } from 'zod';
import { env } from './env';
import { User } from './models';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// AUTH PROVIDER BOUNDARY — to swap in Firebase Auth later, replace this token
// verification with firebase-admin verifyIdToken() and map decoded.uid to a User doc.
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

export const requireAuth = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    (req as any).user = await resolveUser(req);
    next();
  } catch (e) {
    next(e);
  }
};

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

export const validate = (schema: ZodSchema) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const msg = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      return next(new ApiError(400, msg));
    }
    req.body = result.data;
    next();
  };

export const errorHandler = (err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof ApiError ? err.status : 500;
  if (status === 500) console.error('[error]', err);
  res.status(status).json({ error: err.message || 'Internal server error' });
};
