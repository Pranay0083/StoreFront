import express from 'express';
import supertest from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { errorHandler } from '../../src/core/http/error-handler';
import { idempotent } from '../../src/core/http/idempotency/idempotency.middleware';
import { RedisIdempotencyStore } from '../../src/core/http/idempotency/redis-idempotency.store';
import { createRateLimiters } from '../../src/core/http/rate-limit';
import { redisRateLimitStores } from '../../src/core/http/redis-rate-limit';
import type { Redis } from '../../src/core/redis';
import { describeWithRedis, testRedis, uniquePrefix } from '../helpers/redis';

describeWithRedis('Redis-backed HTTP stores', () => {
  let redis: Redis;
  beforeAll(() => {
    redis = testRedis();
  });
  afterAll(() => redis.quit());

  it('claims idempotency keys atomically and replays stored responses verbatim', async () => {
    const store = new RedisIdempotencyStore(redis, `${uniquePrefix('idem')}:`);
    expect(await store.begin('k', 'hash-a')).toEqual({ acquired: true });
    const busy = await store.begin('k', 'hash-a');
    expect(busy).toMatchObject({ acquired: false, existing: { status: 'in_progress', requestHash: 'hash-a' } });
    expect(await store.begin('k', 'hash-b')).toMatchObject({ acquired: false, existing: { requestHash: 'hash-a' } });

    await store.complete('k', 201, { items: [], nested: { list: [1] } });
    const done = await store.begin('k', 'hash-a');
    expect(done).toMatchObject({
      acquired: false,
      existing: { status: 'completed', responseStatus: 201, responseBody: { items: [], nested: { list: [1] } } },
    });

    await store.release('k');
    expect((await store.begin('k', 'hash-a')).acquired).toBe(false);
  });

  it('lets a stale in-flight claim be taken over and releases failed attempts', async () => {
    const store = new RedisIdempotencyStore(redis, `${uniquePrefix('idem')}:`, 0);
    const t0 = new Date(Date.now() - 5_000);
    expect((await store.begin('s', 'h', t0)).acquired).toBe(true);
    expect((await store.begin('s', 'other')).acquired).toBe(false);
    expect((await store.begin('s', 'h')).acquired).toBe(true);
    await store.release('s');
    expect((await store.begin('s', 'other')).acquired).toBe(true);
  });

  it('drives the idempotency middleware end to end', async () => {
    let calls = 0;
    const app = express();
    app.use(express.json());
    app.post('/orders', idempotent(new RedisIdempotencyStore(redis, `${uniquePrefix('idem')}:`)), (_req, res) => {
      calls++;
      res.status(201).json({ order: calls });
    });
    app.use(errorHandler);
    const http = supertest(app);
    await http.post('/orders').set('Idempotency-Key', 'abc').send({ q: 1 }).expect(201, { order: 1 });
    const replay = await http.post('/orders').set('Idempotency-Key', 'abc').send({ q: 1 }).expect(201, { order: 1 });
    expect(replay.headers['idempotent-replayed']).toBe('true');
    await http.post('/orders').set('Idempotency-Key', 'abc').send({ q: 2 }).expect(422);
    expect(calls).toBe(1);
  });

  it('shares a rate-limit budget across API instances', async () => {
    const stores = redisRateLimitStores(redis, `${uniquePrefix('rl')}:`);
    const policies = { burst: { windowMs: 60_000, limit: 2, message: 'slow down' } };
    const instance = () => {
      const app = express();
      app.use(createRateLimiters({ RATE_LIMIT_ENABLED: true }, stores, policies).middleware);
      app.get('/', (_req, res) => void res.json({ ok: true }));
      app.use(errorHandler);
      return supertest(app);
    };
    const [a, b] = [instance(), instance()];
    await a.get('/').expect(200);
    await b.get('/').expect(200);
    const limited = await a.get('/').expect(429);
    expect(limited.body.error).toBe('slow down');
  });
});
