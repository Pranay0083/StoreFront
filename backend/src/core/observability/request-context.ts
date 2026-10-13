import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

export interface RequestContext {
  requestId: string;
  jobId?: string;
}

export const REQUEST_ID_HEADER = 'x-request-id';
const VALID_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

const storage = new AsyncLocalStorage<RequestContext>();

/** Correlation context that follows a request (or a job) through every await, log line and enqueued job. */
export const requestContext = {
  run<T>(context: RequestContext, fn: () => T): T {
    return storage.run(context, fn);
  },
  current(): RequestContext | undefined {
    return storage.getStore();
  },
  requestId(): string | undefined {
    return storage.getStore()?.requestId;
  },
};

/** Accepts a well-formed caller-supplied id so traces can span services; anything else gets a fresh UUID. */
export function resolveRequestId(incoming?: string | null): string {
  return incoming && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
}

export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  const requestId = resolveRequestId(req.header(REQUEST_ID_HEADER));
  req.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  requestContext.run({ requestId }, next);
};
