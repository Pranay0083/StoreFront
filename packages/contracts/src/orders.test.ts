import { describe, expect, it } from 'vitest';
import { ADMIN_ORDER_ACTIONS, ORDER_STATUSES, ORDER_TRANSITIONS, canTransition, refundableAmount } from './orders';

describe('order transitions', () => {
  it('defines transitions for every status and only targets known statuses', () => {
    for (const status of ORDER_STATUSES) {
      expect(ORDER_TRANSITIONS[status]).toBeDefined();
      for (const next of ORDER_TRANSITIONS[status]) expect(ORDER_STATUSES).toContain(next);
    }
  });

  it('treats refunded as terminal and lets partially refunded orders return more items', () => {
    expect(ORDER_TRANSITIONS.refunded).toEqual([]);
    expect(canTransition('partially_refunded', 'refund_requested')).toBe(true);
    expect(canTransition('refund_requested', 'partially_refunded')).toBe(true);
    expect(canTransition('partially_refunded', 'shipped')).toBe(false);
    expect(canTransition('refunded', 'paid')).toBe(false);
    expect(canTransition('created', 'paid')).toBe(true);
  });

  it('routes every paid order through the refund saga instead of cancellation', () => {
    for (const status of ['paid', 'packed', 'delivered'] as const) {
      expect(canTransition(status, 'cancelled')).toBe(false);
      expect(canTransition(status, 'refund_requested')).toBe(true);
    }
    expect(canTransition('paid', 'refunded')).toBe(false);
  });

  it('only exposes admin actions that the lifecycle allows', () => {
    for (const status of ORDER_STATUSES) {
      for (const next of ADMIN_ORDER_ACTIONS[status]) expect(canTransition(status, next)).toBe(true);
      expect(ADMIN_ORDER_ACTIONS[status]).not.toContain('paid');
      expect(ADMIN_ORDER_ACTIONS[status]).not.toContain('refunded');
    }
  });
});

describe('refundableAmount', () => {
  it('returns exactly the line total however the units are refunded', () => {
    const line = { lineTotal: 100_001, qty: 3 };
    expect(refundableAmount(line, 0, 3)).toBe(100_001);
    const steps = [refundableAmount(line, 0, 1), refundableAmount(line, 1, 1), refundableAmount(line, 2, 1)];
    expect(steps).toEqual([33_334, 33_334, 33_333]);
    expect(refundableAmount(line, 0, 2) + refundableAmount(line, 2, 1)).toBe(100_001);
    expect(refundableAmount(line, 0, 1) + refundableAmount(line, 1, 2)).toBe(100_001);
  });

  it('handles lines that were discounted to zero', () => {
    expect(refundableAmount({ lineTotal: 0, qty: 2 }, 0, 2)).toBe(0);
  });
});
