import type { ConditionSpec } from '@storefront/contracts';
import {
  AllOf,
  AlwaysTrue,
  AnyOf,
  CartContains,
  type Condition,
  CustomerSegmentCondition,
  DateWindow,
  MinSubtotal,
  Not,
  PaymentMethodCondition,
} from './conditions';

/** Interpreter: turns a stored JSON rule tree into executable condition objects. */
export function buildCondition(spec: ConditionSpec | undefined | null): Condition {
  if (!spec) return new AlwaysTrue();
  switch (spec.type) {
    case 'all':
      return new AllOf(spec.conditions.map(buildCondition));
    case 'any':
      return new AnyOf(spec.conditions.map(buildCondition));
    case 'not':
      return new Not(buildCondition(spec.condition));
    case 'cartContains':
      return new CartContains(spec.selector, spec.minQty);
    case 'minSubtotal':
      return new MinSubtotal(spec.amount);
    case 'customerSegment':
      return new CustomerSegmentCondition(spec.segment);
    case 'dateWindow':
      return new DateWindow(
        spec.from ? new Date(spec.from) : undefined,
        spec.to ? new Date(spec.to) : undefined,
        spec.daysOfWeek,
        spec.hours,
      );
    case 'paymentMethod':
      return new PaymentMethodCondition(spec.methods);
  }
}

/** Every minimum-subtotal threshold mentioned anywhere in a rule tree (used for "spend more" nudges). */
export function subtotalThresholds(spec: ConditionSpec | undefined | null): number[] {
  if (!spec) return [];
  switch (spec.type) {
    case 'all':
    case 'any':
      return spec.conditions.flatMap(subtotalThresholds);
    case 'minSubtotal':
      return [spec.amount];
    default:
      return [];
  }
}
