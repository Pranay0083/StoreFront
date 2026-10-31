import type { PriceBreakdown } from '@storefront/contracts';
import { Types } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import { MemoryLruCache } from '../../core/cache/cache';
import type { PromotionRecord } from '../pricing/promotion.model';
import { OffersService } from './offers.service';

const HOUR = 3_600_000;
const T0 = new Date('2026-10-30T04:30:00Z');

const record = (overrides: Partial<PromotionRecord>): PromotionRecord =>
  ({
    _id: new Types.ObjectId(),
    name: 'Offer',
    description: '',
    status: 'active',
    activation: 'auto',
    priority: 100,
    exclusive: false,
    action: { type: 'freeShipping' },
    usedCount: 0,
    version: 1,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  }) as PromotionRecord;

function service(records: PromotionRecord[]) {
  const clock = { now: T0 };
  const findActive = vi.fn(async () => records);
  const pricing = { price: vi.fn(async () => ({}) as PriceBreakdown) };
  const offers = new OffersService(
    { findActive },
    { matching: async () => [] },
    pricing,
    new MemoryLruCache(100, () => clock.now.getTime()),
    { warn: vi.fn() },
    300,
    undefined,
    () => clock.now,
  );
  return { offers, clock, findActive };
}

describe('OffersService', () => {
  it('serves the cached read model until something changes', async () => {
    const { offers, findActive } = service([record({ name: 'Ships free' })]);
    expect((await offers.live()).offers.map(o => o.name)).toEqual(['Ships free']);
    await offers.live();
    expect(findActive).toHaveBeenCalledTimes(1);
    await offers.invalidate();
    await offers.live();
    expect(findActive).toHaveBeenCalledTimes(2);
  });

  it('drops an offer at its end and adds one at its start without any event', async () => {
    const { offers, clock } = service([
      record({ name: 'Ends soon', endsAt: new Date(T0.getTime() + HOUR) }),
      record({ name: 'Starts later', startsAt: new Date(T0.getTime() + 2 * HOUR) }),
    ]);
    const first = await offers.live();
    expect(first.offers.map(o => o.name)).toEqual(['Ends soon']);
    expect(first.nextChangeAt).toBe(new Date(T0.getTime() + HOUR).toISOString());

    clock.now = new Date(T0.getTime() + HOUR);
    expect((await offers.live()).offers).toEqual([]);
    clock.now = new Date(T0.getTime() + 2 * HOUR + 1);
    expect((await offers.live()).offers.map(o => o.name)).toEqual(['Starts later']);
  });

  it('hides offers the admin chose not to show, and codes by default', async () => {
    const { offers } = service([
      record({ name: 'Hidden', showOnStorefront: false }),
      record({ name: 'Private code', activation: 'code', code: 'SECRET' }),
      record({ name: 'Shown code', activation: 'code', code: 'SHOWN', showOnStorefront: true }),
    ]);
    const live = (await offers.live()).offers;
    expect(live.map(o => [o.name, o.code])).toEqual([['Shown code', 'SHOWN']]);
  });
});
