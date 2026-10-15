import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { domainEvent } from '../src/core/events/domain-events';
import { EventBus } from '../src/core/events/event-bus';
import { OUTBOX_HANDLER_JOB, QueueOutboxRelay } from '../src/core/events/queue-outbox-relay';
import { OutboxStore } from '../src/core/events/outbox.store';
import { requestContext } from '../src/core/observability/request-context';
import { LocalPubSub, RedisPubSub, type PubSub } from '../src/core/pubsub';
import { BullMqJobQueue } from '../src/core/queue/bullmq-job-queue';
import { MongoDeadLetterStore } from '../src/core/queue/dead-letter.store';
import type { JobQueue } from '../src/core/queue/job-queue';
import { MemoryJobQueue } from '../src/core/queue/memory-job-queue';
import type { Redis } from '../src/core/redis';
import { useTestApp } from './helpers/app';
import { describeWithRedis, testRedis, uniquePrefix, waitFor } from './helpers/redis';

useTestApp();

const silent = pino({ level: 'silent' });
const stockLow = () => domainEvent('StockLow', 'product-1', { productId: 'product-1', size: 'M', stock: 1, threshold: 5 });

function wire(queue: JobQueue, pubsub: PubSub = new LocalPubSub()) {
  const store = new OutboxStore();
  const bus = new EventBus();
  const deadLetters = new MongoDeadLetterStore();
  const relay = new QueueOutboxRelay(store, bus, queue, pubsub, silent, { maxAttempts: 2, baseBackoffMs: 0, pollIntervalMs: 50 });
  return { store, bus, relay, deadLetters };
}

describe('QueueOutboxRelay (in-memory queue)', () => {
  function setup() {
    const deadLetters = new MongoDeadLetterStore();
    const queue = new MemoryJobQueue(deadLetters, silent);
    return { queue, ...wire(queue) };
  }

  it('fans an event out to one job per handler and completes it when all succeed', async () => {
    const { store, bus, relay, queue } = setup();
    const seen: string[] = [];
    bus.subscribe('StockLow', 'a', async () => void seen.push('a'));
    bus.subscribe('StockLow', 'b', async () => void seen.push('b'));
    const event = stockLow();
    await store.append([event]);

    expect(await relay.drain()).toBe(1);
    expect((await store.find(event.id))!.status).toBe('dispatched');
    expect(await queue.drain()).toBe(2);
    expect(seen.sort()).toEqual(['a', 'b']);
    expect(await store.find(event.id)).toMatchObject({ status: 'done', handlersDone: ['a', 'b'] });
  });

  it('isolates a failing handler: others complete, the failure is retried then dead-lettered', async () => {
    const { store, bus, relay, queue, deadLetters } = setup();
    let attempts = 0;
    bus.subscribe('StockLow', 'ok', async () => undefined);
    bus.subscribe('StockLow', 'broken', async () => {
      attempts++;
      throw new Error('mailer offline');
    });
    const event = stockLow();
    await store.append([event]);
    await relay.drain();
    await queue.drain();

    expect(attempts).toBe(2);
    expect(await store.find(event.id)).toMatchObject({ status: 'dispatched', handlersDone: ['ok'] });
    const [dead] = await deadLetters.list();
    expect(dead).toMatchObject({
      name: OUTBOX_HANDLER_JOB,
      queue: 'events',
      data: { eventId: event.id, handlerId: 'broken' },
      attempts: 2,
    });
  });

  it('never re-runs a handler that already succeeded when a job is redelivered', async () => {
    const { store, bus, relay, queue } = setup();
    let runs = 0;
    bus.subscribe('StockLow', 'once', async () => void runs++);
    const event = stockLow();
    await store.append([event]);
    await relay.drain();
    await queue.drain();
    await queue.enqueue(OUTBOX_HANDLER_JOB, { eventId: event.id, handlerId: 'once' });
    await queue.drain();
    expect(runs).toBe(1);
  });

  it('carries the request id of the request that committed the event into its handlers', async () => {
    const { store, bus, relay, queue } = setup();
    let seen: string | undefined;
    bus.subscribe('StockLow', 'trace', async () => void (seen = requestContext.requestId()));
    await requestContext.run({ requestId: 'req-outbox' }, () => store.append([stockLow()]));
    await relay.drain();
    await queue.drain();
    expect(seen).toBe('req-outbox');
  });
});

describeWithRedis('QueueOutboxRelay (BullMQ + Redis pub/sub)', () => {
  let redis: Redis;
  let queue: BullMqJobQueue;
  let pubsub: RedisPubSub;
  let relay: QueueOutboxRelay | undefined;

  afterEach(async () => {
    await relay?.stop();
    await queue.stop();
    await pubsub.close();
    await redis.quit();
  });

  it('delivers committed events through Redis workers, woken by a notify from another process', async () => {
    redis = testRedis();
    pubsub = new RedisPubSub(redis, silent);
    queue = new BullMqJobQueue(redis, new MongoDeadLetterStore(), silent, { prefix: uniquePrefix('relay') });
    const wired = wire(queue, pubsub);
    relay = wired.relay;
    const seen: string[] = [];
    wired.bus.subscribe('StockLow', 'remote', async e => void seen.push(e.payload.size));

    relay.start();
    await queue.start();
    const event = stockLow();
    await wired.store.append([event]);
    relay.notify();
    await waitFor(async () => (await wired.store.find(event.id))?.status === 'done');
    expect(seen).toEqual(['M']);
  });
});
