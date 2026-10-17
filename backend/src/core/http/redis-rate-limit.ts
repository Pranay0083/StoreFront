import { RedisStore, type RedisReply } from 'rate-limit-redis';
import type { Redis } from '../redis';
import type { RateLimitStoreFactory } from './rate-limit';

/** Shared counters so a client's budget holds across every API instance, not per process. */
export function redisRateLimitStores(redis: Redis, prefix: string): RateLimitStoreFactory {
  return policy =>
    new RedisStore({
      prefix: `${prefix}rl:${policy}:`,
      sendCommand: (command: string, ...args: string[]) => redis.call(command, ...args) as Promise<RedisReply>,
    });
}
