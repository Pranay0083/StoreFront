import { ORDER_TRANSITIONS, canTransition, type OrderStatus } from '@storefront/contracts';
import { ConflictError } from '../../core/errors';

/** Explicit order lifecycle: the single gate every status change goes through. */
export class OrderStateMachine {
  static readonly transitions = ORDER_TRANSITIONS;

  static assert(from: OrderStatus, to: OrderStatus): void {
    if (!canTransition(from, to)) throw new ConflictError(`Illegal transition: ${from} → ${to}`);
  }
}
