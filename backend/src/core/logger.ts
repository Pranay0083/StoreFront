import { trace } from '@opentelemetry/api';
import pino from 'pino';
import { requestContext } from './observability/request-context';

const pretty = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  mixin() {
    const ctx = requestContext.current();
    const span = trace.getActiveSpan()?.spanContext();
    return {
      ...(ctx && { requestId: ctx.requestId }),
      ...(ctx?.jobId && { jobId: ctx.jobId }),
      ...(span && { traceId: span.traceId, spanId: span.spanId }),
    };
  },
  transport: pretty ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } } : undefined,
});

export type Logger = typeof logger;
