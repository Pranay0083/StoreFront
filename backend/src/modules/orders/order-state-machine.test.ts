import { ORDER_TRANSITIONS } from '@storefront/contracts';
import { describe, expect, it } from 'vitest';
import { ConflictError } from '../../core/errors';
import { OrderModel } from './order.model';
import { OrderStateMachine } from './order-state-machine';

const draft = () =>
  new OrderModel({ orderNumber: 'SF-1', userId: '64b7f0c2a1b2c3d4e5f60718', subtotal: 0, shipping: 0, total: 0, status: 'created' });

describe('OrderStateMachine', () => {
  it('exposes the shared transition table', () => {
    expect(OrderStateMachine.transitions).toBe(ORDER_TRANSITIONS);
  });

  it.each([
    ['created', 'paid'],
    ['paid', 'packed'],
    ['packed', 'shipped'],
    ['shipped', 'delivered'],
    ['delivered', 'refunded'],
    ['created', 'cancelled'],
  ] as const)('allows %s → %s', (from, to) => {
    expect(() => OrderStateMachine.assert(from, to)).not.toThrow();
  });

  it.each([
    ['created', 'shipped'],
    ['shipped', 'cancelled'],
    ['refunded', 'paid'],
    ['delivered', 'created'],
  ] as const)('rejects %s → %s with a 409 conflict', (from, to) => {
    expect(() => OrderStateMachine.assert(from, to)).toThrowError(ConflictError);
  });

  it('records the transition in the audit trail and stamps paidAt', () => {
    const order = draft();
    OrderStateMachine.apply(order, 'paid', 'system:test', 'Payment captured');
    expect(order.status).toBe('paid');
    expect(order.paidAt).toBeInstanceOf(Date);
    expect(order.statusHistory.at(-1)).toMatchObject({ from: 'created', to: 'paid', by: 'system:test', note: 'Payment captured' });
  });

  it('leaves the order untouched on an illegal transition', () => {
    const order = draft();
    expect(() => OrderStateMachine.apply(order, 'delivered', 'system:test')).toThrow(/Illegal transition: created → delivered/);
    expect(order.status).toBe('created');
    expect(order.statusHistory).toHaveLength(0);
  });
});
