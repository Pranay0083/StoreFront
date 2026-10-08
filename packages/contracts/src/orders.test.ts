import { describe, expect, it } from 'vitest';
import { ADMIN_ORDER_ACTIONS, ORDER_STATUSES, ORDER_TRANSITIONS, canTransition } from './orders';

describe('order transitions', () => {
  it('defines transitions for every status and only targets known statuses', () => {
    for (const status of ORDER_STATUSES) {
      expect(ORDER_TRANSITIONS[status]).toBeDefined();
      for (const next of ORDER_TRANSITIONS[status]) expect(ORDER_STATUSES).toContain(next);
    }
  });

  it('treats refunded as terminal', () => {
    expect(ORDER_TRANSITIONS.refunded).toEqual([]);
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
