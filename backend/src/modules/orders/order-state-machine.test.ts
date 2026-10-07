import { ORDER_TRANSITIONS } from '@storefront/contracts';
import { describe, expect, it } from 'vitest';
import { ConflictError } from '../../core/errors';
import { OrderStateMachine } from './order-state-machine';

describe('OrderStateMachine', () => {
  it('exposes the shared transition table', () => {
    expect(OrderStateMachine.transitions).toBe(ORDER_TRANSITIONS);
  });

  it.each([
    ['created', 'paid'],
    ['paid', 'packed'],
    ['packed', 'shipped'],
    ['shipped', 'delivered'],
    ['delivered', 'refund_requested'],
    ['refund_requested', 'refunded'],
    ['created', 'cancelled'],
  ] as const)('allows %s → %s', (from, to) => {
    expect(() => OrderStateMachine.assert(from, to)).not.toThrow();
  });

  it.each([
    ['created', 'shipped'],
    ['shipped', 'cancelled'],
    ['refunded', 'paid'],
    ['paid', 'cancelled'],
    ['paid', 'refunded'],
    ['delivered', 'created'],
  ] as const)('rejects %s → %s with a 409 conflict', (from, to) => {
    expect(() => OrderStateMachine.assert(from, to)).toThrowError(ConflictError);
  });
});
