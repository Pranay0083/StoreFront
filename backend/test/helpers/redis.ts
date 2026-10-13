import { randomUUID } from 'node:crypto';
import { describe } from 'vitest';
import { createRedis, type Redis } from '../../src/core/redis';

/** Redis-backed tests run only when TEST_REDIS_URL points at a disposable Redis (CI provides one). */
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL;
export const describeWithRedis = describe.skipIf(!TEST_REDIS_URL);

export function testRedis(): Redis {
  return createRedis(TEST_REDIS_URL!);
}

export const uniquePrefix = (label: string) => `test-${label}-${randomUUID().slice(0, 8)}`;

export async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 10_000, intervalMs = 25): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await new Promise(r => setTimeout(r, intervalMs));
  }
}
