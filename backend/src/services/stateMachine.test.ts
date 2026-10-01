import { ORDER_TRANSITIONS } from '@storefront/contracts';
import { describe, expect, it } from 'vitest';
import { assertTransition, TRANSITIONS } from './stateMachine';

describe('order state machine', () => {
  it('matches the shared transition table', () => {
    expect(TRANSITIONS).toEqual(ORDER_TRANSITIONS);
  });

  it.each([
    ['created', 'paid'],
    ['paid', 'packed'],
    ['packed', 'shipped'],
    ['shipped', 'delivered'],
    ['delivered', 'refunded'],
    ['created', 'cancelled'],
  ] as const)('allows %s → %s', (from, to) => {
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it.each([
    ['created', 'shipped'],
    ['shipped', 'cancelled'],
    ['refunded', 'paid'],
    ['delivered', 'created'],
  ] as const)('rejects %s → %s with 409', (from, to) => {
    expect(() => assertTransition(from, to)).toThrowError(expect.objectContaining({ status: 409 }));
  });
});
