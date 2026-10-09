import express from 'express';
import type { Store } from 'express-rate-limit';
import supertest from 'supertest';
import { describe, expect, it } from 'vitest';
import { createRateLimiters, RATE_LIMIT_POLICIES } from '../src/core/http/rate-limit';
import { errorHandler } from '../src/core/http/error-handler';
import { API, useTestApp } from './helpers/app';

process.env.RATE_LIMIT_ENABLED = 'true';
const t = useTestApp();

const req = (method: string, path: string) => ({ method, path });

describe('rate limit policy table', () => {
  it('routes requests to the policies that cover them', () => {
    const { auth, checkout, agentChat, catalogRead, mcp, session } = RATE_LIMIT_POLICIES;
    expect(auth.matches(req('POST', '/auth/login'))).toBe(true);
    expect(auth.matches(req('GET', '/auth/me'))).toBe(false);
    expect(session.matches(req('POST', '/auth/refresh'))).toBe(true);
    expect(checkout.matches(req('POST', '/orders'))).toBe(true);
    expect(checkout.matches(req('POST', '/orders/abc/cancel'))).toBe(true);
    expect(checkout.matches(req('POST', '/payments/verify'))).toBe(true);
    expect(checkout.matches(req('POST', '/payments/webhook'))).toBe(false);
    expect(agentChat.matches(req('POST', '/agent/chat'))).toBe(true);
    expect(catalogRead.matches(req('GET', '/products/oxford-shirt'))).toBe(true);
    expect(catalogRead.matches(req('POST', '/products'))).toBe(false);
    expect(mcp.matches(req('POST', '/mcp'))).toBe(true);
  });
});

describe('rate limiting', () => {
  it('caps sign-in attempts per IP without starving other routes', async () => {
    const { limit } = RATE_LIMIT_POLICIES.auth;
    for (let i = 0; i < limit; i++) {
      await t
        .http()
        .post(`${API}/auth/login`)
        .send({ email: `nobody${i}@test.dev`, password: 'x' })
        .expect(401);
    }
    const blocked = await t.http().post(`${API}/auth/login`).send({ email: 'late@test.dev', password: 'x' }).expect(429);
    expect(blocked.body).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    expect(blocked.headers['ratelimit-policy']).toMatch(/^20;w=900/);

    await t.http().get(`${API}/products`).expect(200);
  });

  it('caps assistant chat messages', async () => {
    const body = { sessionId: 'session-12345', message: 'hi' };
    for (let i = 0; i < RATE_LIMIT_POLICIES.agentChat.limit; i++) {
      expect((await t.http().post(`${API}/agent/chat`).send(body)).status).not.toBe(429);
    }
    await t.http().post(`${API}/agent/chat`).send(body).expect(429);
  });

  it('keeps counters in the injected store', async () => {
    const hits = new Map<string, number>();
    const requested: string[] = [];
    const store = (policy: string): Store => ({
      async increment(key) {
        const n = (hits.get(`${policy}:${key}`) ?? 0) + 1;
        hits.set(`${policy}:${key}`, n);
        return { totalHits: n, resetTime: new Date(Date.now() + 60_000) };
      },
      async decrement() {},
      async resetKey() {},
    });
    const limiters = createRateLimiters({ RATE_LIMIT_ENABLED: true }, name => (requested.push(name), store(name)), {
      tiny: { windowMs: 60_000, limit: 1, message: 'slow down' },
    });
    const app = express()
      .use(limiters.middleware)
      .get('/', (_q, r) => r.json({ ok: true }))
      .use(errorHandler);

    await supertest(app).get('/').expect(200);
    await supertest(app).get('/').expect(429);
    expect(requested).toEqual(['tiny']);
    expect([...hits.values()]).toEqual([2]);
  });
});
