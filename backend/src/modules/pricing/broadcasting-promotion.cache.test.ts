import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { describeWithRedis, testRedis } from '../../../test/helpers/redis';
import { waitFor } from '../../../test/helpers/wait';
import { LocalPubSub, RedisPubSub, type PubSub } from '../../core/pubsub';
import type { Redis } from '../../core/redis';
import { BroadcastingPromotionCache } from './broadcasting-promotion.cache';

const silent = pino({ level: 'silent' });

function countingSource() {
  const source = { calls: 0, findActive: async () => (source.calls++, []) };
  return source;
}

async function scenario(pubsubA: PubSub, pubsubB: PubSub) {
  const sourceA = countingSource();
  const sourceB = countingSource();
  const a = new BroadcastingPromotionCache(sourceA, pubsubA, silent, 60_000);
  const b = new BroadcastingPromotionCache(sourceB, pubsubB, silent, 60_000);
  await Promise.all([a.ready, b.ready]);
  await Promise.all([a.index(), b.index()]);
  await Promise.all([a.index(), b.index()]);
  expect([sourceA.calls, sourceB.calls]).toEqual([1, 1]);

  a.invalidate();
  await waitFor(async () => {
    await b.index();
    return sourceB.calls === 2;
  }, 5_000);
  await a.index();
  expect(sourceA.calls).toBe(2);
}

describe('BroadcastingPromotionCache', () => {
  it('invalidates peer instances through pub/sub, without echoing its own message', async () => {
    const shared = new LocalPubSub();
    await scenario(shared, shared);
  });
});

describeWithRedis('BroadcastingPromotionCache over Redis', () => {
  let redis: Redis;
  let a: RedisPubSub;
  let b: RedisPubSub;
  beforeAll(() => {
    redis = testRedis();
    a = new RedisPubSub(redis, silent);
    b = new RedisPubSub(redis, silent);
  });
  afterAll(async () => {
    await a.close();
    await b.close();
    await redis.quit();
  });

  it('reaches instances in other processes', async () => {
    await scenario(a, b);
  });
});
