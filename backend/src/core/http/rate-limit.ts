import rateLimit from 'express-rate-limit';
import type { Env } from '../config/env';

export function createRateLimiters(env: Env) {
  const skip = () => env.NODE_ENV === 'test';
  return {
    global: rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
      skip,
      message: { error: 'Too many requests from this IP, please try again after 15 minutes' },
    }),
    auth: rateLimit({
      windowMs: 60 * 60 * 1000,
      max: 10,
      standardHeaders: true,
      legacyHeaders: false,
      skip,
      message: { error: 'Too many authentication attempts from this IP, please try again after an hour' },
    }),
  };
}

export type RateLimiters = ReturnType<typeof createRateLimiters>;
