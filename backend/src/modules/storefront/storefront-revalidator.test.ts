import { describe, expect, it, vi } from 'vitest';
import { domainEvent } from '../../core/events/domain-events';
import { EventBus } from '../../core/events/event-bus';
import { type EnqueueOptions, type JobDefinition, type JobQueue, UnrecoverableJobError } from '../../core/queue/job-queue';
import type { ProductRecord } from '../catalog/product.model';
import { OFFER_BOUNDARY_JOB, REVALIDATE_STOREFRONT_JOB, StorefrontRevalidator, type PromotionSchedule } from './storefront-revalidator';

const logger = { debug: vi.fn(), warn: vi.fn() };
const products = {
  findById: vi.fn(async (id: string) => (id === 'p1' ? ({ slug: 'oxford-shirt' } as ProductRecord) : null)),
};
const NOW = new Date('2026-10-30T04:30:00Z');
const HOUR = 3_600_000;
const clock = { now: NOW };

function revalidator(status = 200) {
  clock.now = NOW;
  const http = vi.fn(async () => new Response('{}', { status }));
  const r = new StorefrontRevalidator(
    { url: 'http://web/api/revalidate', secret: 'x'.repeat(16) },
    products,
    logger,
    http,
    () => clock.now,
  );
  return { r, http };
}

/** Records what would be queued and lets a test run a job's handler by hand. */
function fakeQueue() {
  const definitions = new Map<string, JobDefinition>();
  const enqueued: Array<{ name: string; data: unknown; options?: EnqueueOptions }> = [];
  const queue = {
    register: (d: JobDefinition) => void definitions.set(d.name, d),
    enqueue: async (name: string, data: unknown, options?: EnqueueOptions) => void enqueued.push({ name, data, options }),
  } as unknown as JobQueue;
  const run = (name: string, data: unknown) => definitions.get(name)!.handler(data, { jobId: 'j', name, attempt: 1, maxAttempts: 3 });
  return { queue, enqueued, run };
}

function wired(promotion: { _id: string; version: number; status: string; startsAt?: Date; endsAt?: Date }) {
  const { r, http } = revalidator();
  const bus = new EventBus();
  const jobs = fakeQueue();
  const promotions: PromotionSchedule = { findById: async () => promotion, findActive: async () => [promotion] };
  r.register(bus, jobs.queue, { findById: async () => null }, promotions);
  const deliver = async () => {
    const event = domainEvent('PromotionChanged', promotion._id, {
      promotionId: promotion._id,
      version: promotion.version,
      change: 'created',
      status: 'active',
    });
    for (const s of bus.handlersFor('PromotionChanged')) await s.run(event, { attempt: 1, maxAttempts: 8 });
  };
  return { r, http, jobs, deliver };
}

describe('StorefrontRevalidator', () => {
  it('maps product ids to listing, id, slug and offers tags', async () => {
    const { r } = revalidator();
    expect(await r.tagsFor(['p1', 'gone', 'p1'])).toEqual([
      'offers',
      'product-id:gone',
      'product-id:p1',
      'product:oxford-shirt',
      'products',
    ]);
    expect(await r.tagsFor([], ['offers'])).toEqual(['offers']);
  });

  it('posts the tags with the shared secret', async () => {
    const { r, http } = revalidator();
    await r.revalidate(['products']);
    const [url, init] = http.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://web/api/revalidate');
    expect((init.headers as Record<string, string>)['x-revalidate-secret']).toBe('x'.repeat(16));
    expect(JSON.parse(init.body as string)).toEqual({ tags: ['products'] });
  });

  it('does not retry when the storefront rejects the secret', async () => {
    await expect(revalidator(401).r.revalidate(['products'])).rejects.toBeInstanceOf(UnrecoverableJobError);
    await expect(revalidator(503).r.revalidate(['products'])).rejects.not.toBeInstanceOf(UnrecoverableJobError);
  });

  it('revalidates the offers tag when a promotion changes, coalesced', async () => {
    const { jobs, deliver, http } = wired({ _id: 'promo1', version: 1, status: 'active' });
    await deliver();
    expect(jobs.enqueued).toEqual([
      {
        name: REVALIDATE_STOREFRONT_JOB,
        data: { productIds: [], tags: ['offers'] },
        options: { delayMs: 5_000, jobId: 'revalidate:|offers' },
      },
    ]);
    await jobs.run(REVALIDATE_STOREFRONT_JOB, jobs.enqueued[0].data);
    expect(JSON.parse((http.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ tags: ['offers'] });
  });

  it('schedules a revalidation at the start and, once started, at the end', async () => {
    const startsAt = new Date(NOW.getTime() + 2 * HOUR);
    const endsAt = new Date(NOW.getTime() + 50 * HOUR);
    const promotion = { _id: 'promo1', version: 3, status: 'active', startsAt, endsAt };
    const { jobs, deliver, http } = wired(promotion);
    await deliver();

    const boundary = jobs.enqueued.find(j => j.name === OFFER_BOUNDARY_JOB)!;
    expect(boundary.data).toEqual({ promotionId: 'promo1', version: 3, revalidate: true });
    expect(boundary.options).toEqual({ delayMs: 2 * HOUR + 1_000, jobId: `offer-boundary:promo1:3:${startsAt.getTime()}` });

    // When the start passes, the job revalidates and arms the end.
    clock.now = new Date(startsAt.getTime() + 1_000);
    await jobs.run(OFFER_BOUNDARY_JOB, boundary.data);
    expect(JSON.parse((http.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ tags: ['offers'] });
    const next = jobs.enqueued.filter(j => j.name === OFFER_BOUNDARY_JOB)[1];
    expect(next.options).toEqual({
      delayMs: endsAt.getTime() - clock.now.getTime() + 1_000,
      jobId: `offer-boundary:promo1:3:${endsAt.getTime()}`,
    });

    // A boundary armed for an older version does nothing: the newer version armed its own.
    http.mockClear();
    await jobs.run(OFFER_BOUNDARY_JOB, { promotionId: 'promo1', version: 2, revalidate: true });
    expect(http).not.toHaveBeenCalled();
  });

  it('keeps delays short with a checkpoint when the end is beyond the horizon', async () => {
    const promotion = { _id: 'promo1', version: 1, status: 'active', endsAt: new Date(NOW.getTime() + 40 * 24 * HOUR) };
    const { r, jobs } = wired(promotion);
    await r.start();
    const [checkpoint] = jobs.enqueued;
    expect(checkpoint.data).toEqual({ promotionId: 'promo1', version: 1, revalidate: false });
    expect(checkpoint.options!.delayMs).toBe(8 * 24 * HOUR + 1_000);
  });
});
