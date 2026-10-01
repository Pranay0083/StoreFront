import pino from 'pino';

const pretty = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: pretty ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } } : undefined,
});

export type Logger = typeof logger;
