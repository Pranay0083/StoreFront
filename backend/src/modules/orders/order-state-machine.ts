import { ORDER_TRANSITIONS, canTransition, type OrderStatus } from '@storefront/contracts';
import { ConflictError } from '../../core/errors';
import type { OrderDocument } from './order.model';

/** Explicit order lifecycle: the single gate every status change goes through. */
export class OrderStateMachine {
  static readonly transitions = ORDER_TRANSITIONS;

  static assert(from: OrderStatus, to: OrderStatus): void {
    if (!canTransition(from, to)) throw new ConflictError(`Illegal transition: ${from} → ${to}`);
  }

  /** Applies a transition in memory and appends to the audit trail; the caller persists it. */
  static apply(order: OrderDocument, to: OrderStatus, by: string, note = ''): void {
    const from = order.status as OrderStatus;
    OrderStateMachine.assert(from, to);
    order.status = to;
    order.statusHistory.push({ from, to, by, note, at: new Date() });
    if (to === 'paid') order.paidAt = new Date();
  }
}
