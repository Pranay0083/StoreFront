import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { describeWithRedis, testRedis, uniquePrefix } from '../../../test/helpers/redis';
import type { Redis } from '../redis';
import { CacheNamespace, MemoryLruCache, RedisCache, type CacheProvider } from './cache';

function contract(name: string, make: () => CacheProvider) {
  describe(`${name} cache contract`, () => {
    it('round-trips JSON values and returns copies, not shared references', async () => {
      const cache = make();
      const value = { items: [1, 2], nested: { a: 'b' }, empty: [] };
      await cache.set('k', value, 60);
      const read = await cache.get<typeof value>('k');
      expect(read).toEqual(value);
      read!.items.push(3);
      expect(await cache.get('k')).toEqual(value);
      expect(await cache.get('missing')).toBeUndefined();
    });

    it('deletes keys and counts atomically', async () => {
      const cache = make();
      await cache.set('a', 1, 60);
      await cache.set('b', 2, 60);
      await cache.del('a', 'b');
      expect(await cache.get('a')).toBeUndefined();
      expect(await cache.incr('counter')).toBe(1);
      expect(await cache.incr('counter')).toBe(2);
      expect(await cache.ping()).toBe(true);
    });
  });
}

contract('memory', () => new MemoryLruCache());

describe('MemoryLruCache', () => {
  it('expires entries after their TTL', async () => {
    let now = 0;
    const cache = new MemoryLruCache(10, () => now);
    await cache.set('k', 'v', 5);
    now = 4_999;
    expect(await cache.get('k')).toBe('v');
    now = 5_000;
    expect(await cache.get('k')).toBeUndefined();
  });

  it('evicts the least recently used entry but never a counter', async () => {
    const cache = new MemoryLruCache(2);
    await cache.incr('gen');
    await cache.set('a', 1, 60);
    await cache.set('b', 2, 60);
    await cache.get('a');
    await cache.set('c', 3, 60);
    expect(await cache.get('b')).toBeUndefined();
    expect(await cache.get('a')).toBe(1);
    expect(await cache.get('gen')).toBe(1);
  });
});

describe('CacheNamespace', () => {
  it('loads once, serves hits, and invalidates every key in O(1)', async () => {
    const observer = { hit: vi.fn(), miss: vi.fn() };
    const ns = new CacheNamespace(new MemoryLruCache(), 'catalog', 60, observer);
    const load = vi.fn().mockResolvedValueOnce({ v: 1 }).mockResolvedValueOnce({ v: 2 });
    expect(await ns.getOrLoad('page:1', load)).toEqual({ v: 1 });
    expect(await ns.getOrLoad('page:1', load)).toEqual({ v: 1 });
    expect(load).toHaveBeenCalledTimes(1);
    await ns.invalidate();
    expect(await ns.getOrLoad('page:1', load)).toEqual({ v: 2 });
    expect(observer.hit).toHaveBeenCalledTimes(1);
    expect(observer.miss).toHaveBeenCalledTimes(2);
  });

  it('collapses concurrent misses into one load', async () => {
    const ns = new CacheNamespace(new MemoryLruCache(), 'slow', 60);
    let release!: (v: string) => void;
    const load = vi.fn(() => new Promise<string>(r => (release = r)));
    const reads = Promise.all(Array.from({ length: 10 }, () => ns.getOrLoad('k', load)));
    await new Promise(r => setTimeout(r, 5));
    release('value');
    expect(await reads).toEqual(Array(10).fill('value'));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('degrades to the loader when the cache backend is down', async () => {
    const broken: CacheProvider = {
      kind: 'redis',
      get: () => Promise.reject(new Error('ECONNREFUSED')),
      set: () => Promise.reject(new Error('ECONNREFUSED')),
      del: () => Promise.reject(new Error('ECONNREFUSED')),
      incr: () => Promise.reject(new Error('ECONNREFUSED')),
      ping: async () => false,
    };
    const ns = new CacheNamespace(broken, 'catalog', 60);
    expect(await ns.getOrLoad('k', async () => 'fresh')).toBe('fresh');
  });
});

describeWithRedis('RedisCache', () => {
  let redis: Redis;
  beforeAll(() => {
    redis = testRedis();
  });
  afterAll(() => redis.quit());
  contract('redis', () => new RedisCache(redis, `${uniquePrefix('cache')}:`));

  it('shares generations across instances (as separate processes would)', async () => {
    const prefix = `${uniquePrefix('cache')}:`;
    const a = new CacheNamespace(new RedisCache(redis, prefix), 'catalog', 60);
    const b = new CacheNamespace(new RedisCache(redis, prefix), 'catalog', 60);
    expect(await a.getOrLoad('k', async () => 'v1')).toBe('v1');
    expect(await b.getOrLoad('k', async () => 'other')).toBe('v1');
    await b.invalidate();
    expect(await a.getOrLoad('k', async () => 'v2')).toBe('v2');
  });
});
