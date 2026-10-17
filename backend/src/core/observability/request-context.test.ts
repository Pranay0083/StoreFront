import express from 'express';
import supertest from 'supertest';
import { describe, expect, it } from 'vitest';
import { REQUEST_ID_HEADER, requestContext, requestIdMiddleware, resolveRequestId } from './request-context';

function app() {
  const a = express();
  a.use(requestIdMiddleware);
  a.get('/', async (_req, res) => {
    await new Promise(r => setTimeout(r, 5));
    res.json({ seen: requestContext.requestId() });
  });
  return a;
}

describe('request context', () => {
  it('propagates a caller-supplied request id across awaits and echoes it back', async () => {
    const res = await supertest(app()).get('/').set(REQUEST_ID_HEADER, 'abc-123').expect(200);
    expect(res.body.seen).toBe('abc-123');
    expect(res.headers[REQUEST_ID_HEADER]).toBe('abc-123');
  });

  it('generates a fresh id when none or a malformed one is supplied', async () => {
    const res = await supertest(app()).get('/').set(REQUEST_ID_HEADER, 'bad id <script>').expect(200);
    expect(res.body.seen).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers[REQUEST_ID_HEADER]).toBe(res.body.seen);
    expect(resolveRequestId(undefined)).not.toBe(resolveRequestId(undefined));
    expect(resolveRequestId('x'.repeat(129))).toHaveLength(36);
  });

  it('is empty outside a request', () => {
    expect(requestContext.requestId()).toBeUndefined();
    expect(requestContext.run({ requestId: 'job-ctx', jobId: 'j1' }, () => requestContext.current())).toEqual({
      requestId: 'job-ctx',
      jobId: 'j1',
    });
  });
});
