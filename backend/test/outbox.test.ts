import { describe, expect, it } from 'vitest';
import { domainEvent } from '../src/core/events/domain-events';
import { EventBus } from '../src/core/events/event-bus';
import { PollingOutboxRelay } from '../src/core/events/outbox-relay';
import { OutboxStore } from '../src/core/events/outbox.store';
import { logger } from '../src/core/logger';
import { TransactionRunner } from '../src/core/persistence/transaction';
import { useTestApp } from './helpers/app';

useTestApp();

const stockLow = (id?: string) => domainEvent('StockLow', 'product-1', { productId: 'product-1', size: 'M', stock: 1, threshold: 5 }, id);

function setup(options: { maxAttempts?: number } = {}) {
  const store = new OutboxStore();
  const bus = new EventBus();
  const relay = new PollingOutboxRelay(store, bus, logger, { baseBackoffMs: 1_000, maxAttempts: options.maxAttempts ?? 3 });
  return { store, bus, relay };
}

describe('transactional outbox', () => {
  it('only persists events whose transaction commits', async () => {
    const { store } = setup();
    const tx = new TransactionRunner();
    const committed = stockLow();
    await tx.run(session => store.append([committed], session));
    await expect(
      tx.run(async session => {
        await store.append([stockLow()], session);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    const records = await store.list();
    expect(records.map(r => r._id)).toEqual([committed.id]);
    expect(records[0]).toMatchObject({ status: 'pending', attempts: 0, name: 'StockLow' });
  });

  it('ignores re-publishing an event with the same deterministic id', async () => {
    const { store } = setup();
    await store.append([stockLow('stocklow:1')]);
    await store.append([stockLow('stocklow:1')]);
    expect(await store.list()).toHaveLength(1);
  });

  it('delivers to every subscriber and marks the event done', async () => {
    const { store, bus, relay } = setup();
    const seen: string[] = [];
    bus.subscribe('StockLow', 'a', async e => void seen.push(`a:${e.payload.size}`));
    bus.subscribe('StockLow', 'b', async e => void seen.push(`b:${e.payload.stock}`));
    const event = stockLow();
    await store.append([event]);

    expect(await relay.drain()).toBe(1);
    expect(seen).toEqual(['a:M', 'b:1']);
    expect(await store.find(event.id)).toMatchObject({ status: 'done', handlersDone: ['a', 'b'], attempts: 1 });
  });

  it('retries only the failed handler with exponential backoff, then dead-letters it', async () => {
    const { store, bus, relay } = setup({ maxAttempts: 3 });
    let okCalls = 0;
    let flakyCalls = 0;
    bus.subscribe('StockLow', 'ok', async () => void okCalls++);
    bus.subscribe('StockLow', 'flaky', async () => {
      flakyCalls++;
      throw new Error('downstream unavailable');
    });
    const event = stockLow();
    await store.append([event]);
    const t0 = new Date();

    await relay.drain(t0);
    let record = (await store.find(event.id))!;
    expect(record).toMatchObject({ status: 'pending', attempts: 1, handlersDone: ['ok'] });
    expect(record.lastError).toMatch(/flaky: downstream unavailable/);
    expect(record.nextAttemptAt.getTime()).toBe(t0.getTime() + 1_000);

    expect(await relay.drain(t0)).toBe(0);

    await relay.drain(new Date(t0.getTime() + 1_000));
    record = (await store.find(event.id))!;
    expect(record).toMatchObject({ status: 'pending', attempts: 2 });
    expect(record.nextAttemptAt.getTime()).toBe(t0.getTime() + 1_000 + 2_000);

    await relay.drain(new Date(t0.getTime() + 10_000));
    record = (await store.find(event.id))!;
    expect(record.status).toBe('dead');
    expect(okCalls).toBe(1);
    expect(flakyCalls).toBe(3);
  });

  it('reclaims events whose lease expired after a worker crash', async () => {
    const { store, bus, relay } = setup();
    let calls = 0;
    bus.subscribe('StockLow', 'h', async () => void calls++);
    const event = stockLow();
    await store.append([event]);
    const t0 = new Date();
    await store.claimNext(t0, 30_000);

    expect(await relay.drain(new Date(t0.getTime() + 1_000))).toBe(0);
    expect(await relay.drain(new Date(t0.getTime() + 31_000))).toBe(1);
    expect(calls).toBe(1);
    expect((await store.find(event.id))!.status).toBe('done');
  });

  it('rejects duplicate handler ids on the same event', () => {
    const bus = new EventBus();
    bus.subscribe('StockLow', 'x', async () => undefined);
    expect(() => bus.subscribe('StockLow', 'x', async () => undefined)).toThrow(/already subscribed/);
  });
});
