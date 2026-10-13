import pino from 'pino';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { requestContext } from '../../src/core/observability/request-context';
import { BullMqJobQueue } from '../../src/core/queue/bullmq-job-queue';
import type { DeadLetterInput, DeadLetterRecord, DeadLetterStore } from '../../src/core/queue/dead-letter.store';
import type { Redis } from '../../src/core/redis';
import { describeWithRedis, testRedis, uniquePrefix, waitFor } from '../helpers/redis';

class FakeDeadLetters implements DeadLetterStore {
  entries: DeadLetterInput[] = [];
  async record(entry: DeadLetterInput) {
    this.entries.push(entry);
  }
  async list() {
    return this.entries as unknown as DeadLetterRecord[];
  }
  async find() {
    return null;
  }
  async remove() {
    return false;
  }
  async count() {
    return this.entries.length;
  }
}

describeWithRedis('BullMqJobQueue (real Redis)', () => {
  let redis: Redis;
  let queue: BullMqJobQueue;
  let deadLetters: FakeDeadLetters;

  beforeEach(() => {
    redis = testRedis();
    deadLetters = new FakeDeadLetters();
    queue = new BullMqJobQueue(redis, deadLetters, pino({ level: 'silent' }), { prefix: uniquePrefix('bullmq') });
  });

  afterEach(async () => {
    await queue.stop();
    await redis.quit();
  });

  it('delivers jobs to a worker with the request id of the producer', async () => {
    const seen: unknown[] = [];
    queue.register({
      name: 'greet',
      queue: 'notifications',
      handler: async (data, ctx) => void seen.push({ data, requestId: ctx.requestId, als: requestContext.requestId() }),
    });
    await requestContext.run({ requestId: 'req-bull' }, () => queue.enqueue('greet', { to: 'x' }));
    await queue.start();
    await waitFor(() => seen.length === 1);
    expect(seen[0]).toEqual({ data: { to: 'x' }, requestId: 'req-bull', als: 'req-bull' });
    expect(await queue.ping()).toBe(true);
  });

  it('retries with backoff and dead-letters after the final attempt', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('provider down'));
    queue.register({ name: 'flaky', queue: 'events', attempts: 3, backoffMs: 10, handler });
    await queue.start();
    await queue.enqueue('flaky', { n: 1 }, { jobId: 'flaky:1' });
    await waitFor(() => deadLetters.entries.length === 1);
    expect(handler).toHaveBeenCalledTimes(3);
    expect(deadLetters.entries[0]).toMatchObject({
      queue: 'events',
      name: 'flaky',
      jobId: 'flaky_1',
      attempts: 3,
      error: 'provider down',
      data: { n: 1 },
    });
  });

  it('deduplicates by job id and honours delays', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    queue.register({ name: 'expire', queue: 'maintenance', handler });
    await queue.enqueue('expire', { id: 'o1' }, { jobId: 'expire:o1', delayMs: 300 });
    await queue.enqueue('expire', { id: 'o1' }, { jobId: 'expire:o1', delayMs: 300 });
    expect((await queue.counts()).find(c => c.queue === 'maintenance')).toMatchObject({ delayed: 1 });
    await queue.start();
    await new Promise(r => setTimeout(r, 100));
    expect(handler).not.toHaveBeenCalled();
    await waitFor(() => handler.mock.calls.length === 1);
    await new Promise(r => setTimeout(r, 300));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('runs repeatable schedules', async () => {
    let runs = 0;
    queue.register({ name: 'tick', queue: 'maintenance', handler: async () => void runs++ });
    await queue.schedule('tick', {}, { everyMs: 100 });
    await queue.schedule('tick', {}, { everyMs: 100 });
    await queue.start();
    await waitFor(() => runs >= 2, 5_000);
  });
});
