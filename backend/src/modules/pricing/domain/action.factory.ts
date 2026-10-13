import type { ActionSpec } from '@storefront/contracts';
import {
  BuyXGetYAction,
  ClearanceAction,
  FixedBundlePriceAction,
  FlashMarkdownAction,
  FlatOffAction,
  FreeShippingAction,
  MixAndMatchAction,
  PercentOffAction,
  type PromotionAction,
  TieredAction,
} from './actions';

/** Factory: maps a stored action spec onto its pricing strategy. */
export function buildAction(spec: ActionSpec): PromotionAction {
  switch (spec.type) {
    case 'fixedBundle':
      return new FixedBundlePriceAction(spec.components, spec.price);
    case 'mixAndMatch':
      return new MixAndMatchAction(spec.selector, spec.quantity, spec.price);
    case 'buyXGetY':
      return new BuyXGetYAction(spec.selector, spec.buyQty, spec.getQty, spec.percentOff);
    case 'tiered':
      return new TieredAction(spec.selector, spec.tiers);
    case 'percentOff':
      return new PercentOffAction(spec.selector, spec.percent, spec.maxDiscount);
    case 'flatOff':
      return new FlatOffAction(spec.selector, spec.amount);
    case 'freeShipping':
      return new FreeShippingAction();
    case 'markdown':
      return new FlashMarkdownAction(spec.selector, spec.percentOff);
    case 'clearance':
      return new ClearanceAction(spec.selector, spec.percentOff, spec.minStock, spec.minAgeDays);
  }
}
