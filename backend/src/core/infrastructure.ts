import type { Env } from './config/env';
import { memoryStores, type RateLimitStoreFactory } from './http/rate-limit';
import { logger } from './logger';
import { LocalPubSub, RedisPubSub, type PubSub } from './pubsub';
import { BullMqJobQueue } from './queue/bullmq-job-queue';
import { MongoDeadLetterStore, type DeadLetterStore } from './queue/dead-letter.store';
import type { JobQueue } from './queue/job-queue';
import { MemoryJobQueue } from './queue/memory-job-queue';
import { createRedis, pingRedis, type Redis } from './redis';

/**
 * Abstract factory for every stateful infrastructure dependency. Redis-backed implementations are
 * chosen when REDIS_URL is set; otherwise single-process in-memory ones, so tests and a Redis-less
 * demo deploy run the same application code.
 */
export interface Infrastructure {
  kind: 'memory' | 'redis';
  redis?: Redis;
  queue: JobQueue;
  deadLetters: DeadLetterStore;
  pubsub: PubSub;
  rateLimitStores: RateLimitStoreFactory;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export function memoryInfrastructure(): Infrastructure {
  const deadLetters = new MongoDeadLetterStore();
  const pubsub = new LocalPubSub();
  const queue = new MemoryJobQueue(deadLetters, logger);
  return {
    kind: 'memory',
    queue,
    deadLetters,
    pubsub,
    rateLimitStores: memoryStores,
    ping: async () => true,
    close: async () => {
      await queue.stop();
      await pubsub.close();
    },
  };
}

export function redisInfrastructure(env: Pick<Env, 'REDIS_URL' | 'QUEUE_PREFIX'>): Infrastructure {
  const redis = createRedis(env.REDIS_URL!);
  redis.on('error', err => logger.error({ err }, 'Redis connection error'));
  const deadLetters = new MongoDeadLetterStore();
  const pubsub = new RedisPubSub(redis, logger);
  const queue = new BullMqJobQueue(redis, deadLetters, logger, { prefix: env.QUEUE_PREFIX });
  return {
    kind: 'redis',
    redis,
    queue,
    deadLetters,
    pubsub,
    rateLimitStores: memoryStores,
    ping: () => pingRedis(redis),
    close: async () => {
      await queue.stop();
      await pubsub.close();
      await redis.quit().catch(() => redis.disconnect());
    },
  };
}

export function buildInfrastructure(env: Env): Infrastructure {
  return env.REDIS_URL ? redisInfrastructure(env) : memoryInfrastructure();
}

/** `auto`: process jobs in the API only when there is no shared queue for a separate worker to drain. */
export function runsJobsInProcess(env: Pick<Env, 'JOBS_IN_PROCESS'>, infra: Pick<Infrastructure, 'kind'>): boolean {
  if (env.JOBS_IN_PROCESS === 'auto') return infra.kind === 'memory';
  return env.JOBS_IN_PROCESS === 'true';
}
