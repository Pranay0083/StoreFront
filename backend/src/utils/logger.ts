import pino from 'pino';

/**
 * Centralized Pino logger instance used across the backend.
 * Provides structured JSON logging in production and pretty-printing in development.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
    },
  } : undefined,
});
