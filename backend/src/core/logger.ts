import pino from 'pino';
import { requestContext } from './observability/request-context';

const pretty = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  mixin() {
    const ctx = requestContext.current();
    if (!ctx) return {};
    return ctx.jobId ? { requestId: ctx.requestId, jobId: ctx.jobId } : { requestId: ctx.requestId };
  },
  transport: pretty ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } } : undefined,
});

export type Logger = typeof logger;
