import type { Redis } from '../redis';

/**
 * Values are stored serialized in both implementations, so callers always get a fresh copy and
 * the in-memory cache behaves exactly like Redis (no shared mutable objects, JSON round-trip).
 */
export interface CacheProvider {
  readonly kind: 'memory' | 'redis';
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  del(...keys: string[]): Promise<void>;
  /** Atomic counter, used for generation-based namespace invalidation. */
  incr(key: string): Promise<number>;
  ping(): Promise<boolean>;
}

export interface CacheObserver {
  hit(cache: string): void;
  miss(cache: string): void;
}

interface Entry {
  json: string;
  expiresAt: number;
}

/** Bounded LRU with per-entry TTL for single-process deployments. */
export class MemoryLruCache implements CacheProvider {
  readonly kind = 'memory' as const;
  private readonly entries = new Map<string, Entry>();
  private readonly counters = new Map<string, number>();

  constructor(
    private readonly maxEntries = 5_000,
    private readonly clock: () => number = Date.now,
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    const counter = this.counters.get(key);
    if (counter !== undefined) return counter as T;
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.clock()) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return JSON.parse(entry.json) as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.entries.delete(key);
    this.entries.set(key, { json: JSON.stringify(value), expiresAt: this.clock() + ttlSeconds * 1000 });
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
  }

  async del(...keys: string[]): Promise<void> {
    for (const key of keys) this.entries.delete(key);
  }

  /** Counters live outside the LRU: evicting a namespace generation would resurrect stale keys. */
  async incr(key: string): Promise<number> {
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    return next;
  }

  async ping(): Promise<boolean> {
    return true;
  }

  get size(): number {
    return this.entries.size;
  }
}

export class RedisCache implements CacheProvider {
  readonly kind = 'redis' as const;

  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'cache:',
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    const raw = await this.redis.get(this.prefix + key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.redis.set(this.prefix + key, JSON.stringify(value), 'EX', Math.max(1, Math.round(ttlSeconds)));
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length) await this.redis.del(...keys.map(k => this.prefix + k));
  }

  incr(key: string): Promise<number> {
    return this.redis.incr(this.prefix + key);
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === 'PONG';
    } catch {
      return false;
    }
  }
}

/**
 * A group of keys that can be invalidated in O(1): every key embeds the namespace's current
 * generation, and bumping the generation orphans all of them (they expire on their own TTL).
 * Concurrent misses for the same key share one loader call (single-flight) to avoid stampedes.
 */
export class CacheNamespace {
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly cache: CacheProvider,
    readonly name: string,
    private readonly ttlSeconds: number,
    private readonly observer?: CacheObserver,
  ) {}

  async getOrLoad<T>(key: string, load: () => Promise<T>): Promise<T> {
    const fullKey = `${this.name}:${await this.generation()}:${key}`;
    const cached = await this.safeGet<T>(fullKey);
    if (cached !== undefined) {
      this.observer?.hit(this.name);
      return cached;
    }
    this.observer?.miss(this.name);
    const pending = this.inflight.get(fullKey) as Promise<T> | undefined;
    if (pending) return pending;
    const loading = load()
      .then(async value => {
        if (value !== undefined && value !== null) await this.cache.set(fullKey, value, this.ttlSeconds).catch(() => undefined);
        return value;
      })
      .finally(() => this.inflight.delete(fullKey));
    this.inflight.set(fullKey, loading);
    return loading;
  }

  async invalidate(): Promise<void> {
    await this.cache.incr(`${this.name}:gen`);
  }

  private async generation(): Promise<number> {
    try {
      return (await this.cache.get<number>(`${this.name}:gen`)) ?? 0;
    } catch {
      return 0;
    }
  }

  /** A cache outage degrades to cache misses rather than failing the request. */
  private async safeGet<T>(key: string): Promise<T | undefined> {
    try {
      return await this.cache.get<T>(key);
    } catch {
      return undefined;
    }
  }
}
