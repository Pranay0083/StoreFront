import { Redis, type RedisOptions } from 'ioredis';

/**
 * `maxRetriesPerRequest: null` is required by BullMQ's blocking commands; commands queue while
 * Redis reconnects instead of failing the request outright.
 */
export function createRedis(url: string, options: RedisOptions = {}): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true, connectionName: 'storefront', ...options });
}

export async function pingRedis(redis: Redis): Promise<boolean> {
  try {
    return (await redis.ping()) === 'PONG';
  } catch {
    return false;
  }
}

export type { Redis };
