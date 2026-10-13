import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { requestContext } from '../observability/request-context';
import type { DeadLetterInput, DeadLetterRecord, DeadLetterStore } from './dead-letter.store';
import { UnknownJobError, type JobContext } from './job-queue';
import { MemoryJobQueue } from './memory-job-queue';

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

function setup() {
  let now = 1_000_000;
  const deadLetters = new FakeDeadLetters();
  const queue = new MemoryJobQueue(deadLetters, pino({ level: 'silent' }), { clock: () => now });
  return { queue, deadLetters, advance: (ms: number) => (now += ms) };
}

describe('MemoryJobQueue', () => {
  it('runs registered jobs with their data and attempt context', async () => {
    const { queue } = setup();
    const seen: Array<[unknown, JobContext]> = [];
    queue.register({ name: 'greet', queue: 'notifications', handler: async (data, ctx) => void seen.push([data, ctx]) });
    await queue.enqueue('greet', { to: 'a@b.c' });
    expect(await queue.drain()).toBe(1);
    expect(seen).toHaveLength(1);
    expect(seen[0][0]).toEqual({ to: 'a@b.c' });
    expect(seen[0][1]).toMatchObject({ name: 'greet', attempt: 1, maxAttempts: 5 });
  });

  it('rejects jobs nobody registered', async () => {
    const { queue } = setup();
    await expect(queue.enqueue('nope', {})).rejects.toBeInstanceOf(UnknownJobError);
  });

  it('retries with exponential backoff, then dead-letters after the last attempt', async () => {
    const { queue, deadLetters, advance } = setup();
    const handler = vi.fn().mockRejectedValue(new Error('smtp down'));
    queue.register({ name: 'mail', queue: 'notifications', attempts: 3, backoffMs: 100, handler });
    await queue.enqueue('mail', { id: 1 }, { jobId: 'mail:1' });

    await queue.drain();
    expect(handler).toHaveBeenCalledTimes(1);
    advance(99);
    expect(await queue.drain()).toBe(0);
    advance(1);
    await queue.drain();
    expect(handler).toHaveBeenCalledTimes(2);
    advance(200);
    await queue.drain();
    expect(handler).toHaveBeenCalledTimes(3);
    expect(handler.mock.calls.map(c => c[1].attempt)).toEqual([1, 2, 3]);

    expect(deadLetters.entries).toEqual([
      expect.objectContaining({ queue: 'notifications', name: 'mail', jobId: 'mail_1', data: { id: 1 }, error: 'smtp down', attempts: 3 }),
    ]);
    expect((await queue.counts()).find(c => c.queue === 'notifications')).toMatchObject({ failed: 1, waiting: 0, delayed: 0 });
  });

  it('holds delayed jobs until they are due and deduplicates by job id', async () => {
    const { queue, advance } = setup();
    const handler = vi.fn().mockResolvedValue(undefined);
    queue.register({ name: 'expire', queue: 'maintenance', handler });
    await queue.enqueue('expire', { orderId: 'o1' }, { delayMs: 60_000, jobId: 'expire:o1' });
    await queue.enqueue('expire', { orderId: 'o1' }, { delayMs: 60_000, jobId: 'expire:o1' });
    expect((await queue.counts()).find(c => c.queue === 'maintenance')).toMatchObject({ delayed: 1, waiting: 0 });
    expect(await queue.drain()).toBe(0);
    advance(60_000);
    expect(await queue.drain()).toBe(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('carries the enqueuing request id into the job and its logs', async () => {
    const { queue } = setup();
    let inside: unknown;
    queue.register({
      name: 'trace',
      queue: 'events',
      handler: async (_data, ctx) => {
        inside = { ctx: ctx.requestId, als: requestContext.current() };
      },
    });
    await requestContext.run({ requestId: 'req-42' }, () => queue.enqueue('trace', {}));
    await queue.drain();
    expect(inside).toEqual({ ctx: 'req-42', als: { requestId: 'req-42', jobId: expect.any(String) } });
  });

  it('processes automatically once started and stops cleanly', async () => {
    const { queue } = setup();
    const done = new Promise<void>(resolve => {
      queue.register({ name: 'auto', queue: 'events', handler: async () => resolve() });
    });
    await queue.start();
    await queue.enqueue('auto', {});
    await done;
    await queue.stop();
    expect(queue.size).toBe(0);
  });
});
