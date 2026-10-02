import { describe, expect, it } from 'vitest';
import { ORDER_STATUSES, ORDER_TRANSITIONS, canTransition } from './orders';

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
});
