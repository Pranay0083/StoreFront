import type { ConditionSpec } from '@storefront/contracts';
import { describe, expect, it } from 'vitest';
import { liveByTime, nextBoundary, scheduleAllows } from './offer-schedule';

// Friday 30 Oct 2026, 10:00 IST.
const FRI_10_IST = new Date('2026-10-30T04:30:00Z');
const HOUR = 3_600_000;

describe('offer schedule', () => {
  it('reads only the clock from a condition tree', () => {
    const friday: ConditionSpec = { type: 'dateWindow', daysOfWeek: [5] };
    expect(scheduleAllows(friday, FRI_10_IST)).toBe(true);
    expect(scheduleAllows({ type: 'dateWindow', daysOfWeek: [6] }, FRI_10_IST)).toBe(false);
    expect(scheduleAllows({ type: 'all', conditions: [{ type: 'minSubtotal', amount: 1 }, friday] }, FRI_10_IST)).toBe(true);
    expect(scheduleAllows({ type: 'not', condition: friday }, FRI_10_IST)).toBe(false);
    // A spend or segment rule is the shopper's to meet, not a reason to hide the offer.
    expect(scheduleAllows({ type: 'not', condition: { type: 'customerSegment', segment: 'guest' } }, FRI_10_IST)).toBe(true);
    expect(scheduleAllows({ type: 'dateWindow', hours: { start: 18, end: 21 } }, FRI_10_IST)).toBe(false);
  });

  it('finds the next start or end inside the horizon', () => {
    const startsAt = new Date(FRI_10_IST.getTime() + 2 * HOUR);
    const endsAt = new Date(FRI_10_IST.getTime() + 26 * HOUR);
    expect(nextBoundary({ status: 'active', startsAt, endsAt }, FRI_10_IST)).toEqual(startsAt);
    expect(nextBoundary({ status: 'active', startsAt, endsAt }, startsAt)).toEqual(endsAt);
    expect(nextBoundary({ status: 'active', endsAt: new Date(FRI_10_IST.getTime() + 30 * 24 * HOUR) }, FRI_10_IST)).toBeUndefined();
    expect(nextBoundary({ status: 'paused', startsAt }, FRI_10_IST)).toBeUndefined();
    expect(liveByTime({ startsAt, endsAt }, FRI_10_IST)).toBe(false);
  });

  it('steps store hours for recurring windows', () => {
    // Footwear Friday ends at midnight IST.
    expect(nextBoundary({ status: 'active', conditions: { type: 'dateWindow', daysOfWeek: [5] } }, FRI_10_IST)).toEqual(
      new Date('2026-10-30T18:30:00Z'),
    );
    // An evening flash sale opens at 18:00 IST.
    expect(nextBoundary({ status: 'active', conditions: { type: 'dateWindow', hours: { start: 18, end: 21 } } }, FRI_10_IST)).toEqual(
      new Date('2026-10-30T12:30:00Z'),
    );
    expect(nextBoundary({ status: 'active', conditions: { type: 'minSubtotal', amount: 1 } }, FRI_10_IST)).toBeUndefined();
  });
});
