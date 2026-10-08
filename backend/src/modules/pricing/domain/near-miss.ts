import { FREE_SHIPPING_THRESHOLD, formatINR, type Paise, type PricingSuggestion } from '@storefront/contracts';
import { TieredAction } from './actions';
import { type BundleApplication, type BundleCandidate, optimizeBundles, type OptimizerOptions } from './bundle-optimizer';
import { subtotalThresholds } from './condition.factory';
import type { EffectiveLine, PricingContext } from './pricing-line';
import type { PricingState } from './pricing-state';
import type { CompiledPromotion } from './promotion';

export interface NearMissInput {
  lines: readonly EffectiveLine[];
  ctx: PricingContext;
  state: PricingState;
  bundleOffers: readonly BundleCandidate<CompiledPromotion>[];
  currentPlan: readonly BundleApplication<CompiledPromotion>[];
  cartPromotions: readonly CompiledPromotion[];
  ineligibleCartPromotions: readonly CompiledPromotion[];
  pool: readonly EffectiveLine[];
}

const MAX_SUGGESTIONS = 4;
const SPEND_MORE_RATIO = 0.3;
const WHAT_IF_OPTIONS: OptimizerOptions = { nodeBudget: 5_000, timeBudgetMs: 50 };
const MAX_UNITS_FOR_WHAT_IF = 30;

const sameVariant = (a: EffectiveLine, b: EffectiveLine) => a.productId === b.productId && a.size === b.size;

function addUnits(lines: readonly EffectiveLine[], candidate: EffectiveLine, units: number): EffectiveLine[] {
  const idx = lines.findIndex(l => sameVariant(l, candidate));
  if (idx < 0) return [...lines, { ...candidate, qty: units }];
  return lines.map((l, i) => (i === idx ? { ...l, qty: l.qty + units } : l));
}

/**
 * "Add one more item" nudges, shown only when the extra bundle savings are at least the added cost
 * (the customer pays the same or less overall), plus "spend a little more" nudges for thresholds.
 */
export function suggestNearMisses(input: NearMissInput): PricingSuggestion[] {
  return [...addItemSuggestions(input), ...spendMoreSuggestions(input)].slice(0, MAX_SUGGESTIONS);
}

function addItemSuggestions({ lines, bundleOffers, currentPlan, pool }: NearMissInput): PricingSuggestion[] {
  if (!bundleOffers.length || lines.reduce((s, l) => s + l.qty, 0) > MAX_UNITS_FOR_WHAT_IF) return [];
  const baseline = currentPlan.reduce((s, a) => s + a.savings, 0);
  const timesUsed = (plan: readonly BundleApplication<CompiledPromotion>[], promo: CompiledPromotion) =>
    plan.filter(a => a.promotion === promo).length;

  const candidatesPool = [...lines, ...pool.filter(p => !lines.some(l => sameVariant(l, p)))];
  const out: Array<PricingSuggestion & { net: number }> = [];
  for (const offer of bundleOffers) {
    const candidates = candidatesPool
      .filter(c => offer.action.touches(c))
      .sort((a, b) => a.effectiveUnitPrice - b.effectiveUnitPrice)
      .slice(0, 3);
    let best: (PricingSuggestion & { net: number }) | undefined;
    for (const candidate of candidates) {
      for (let units = 1; units <= 2; units++) {
        const result = optimizeBundles(addUnits(lines, candidate, units), bundleOffers, WHAT_IF_OPTIONS);
        const extra = result.savings - baseline;
        const added = units * candidate.effectiveUnitPrice;
        if (timesUsed(result.applications, offer.promotion) <= timesUsed(currentPlan, offer.promotion) || extra <= 0 || extra < added)
          continue;
        const net = extra - added;
        if (!best || net > best.net || (net === best.net && added < best.addedCost)) {
          const pitch = net === 0 ? "it's effectively free" : `your total drops by ${formatINR(net)}`;
          best = {
            kind: 'add-item',
            promotionId: offer.promotion.id,
            message: `Add ${units} × ${candidate.title} (${formatINR(candidate.effectiveUnitPrice)}) to unlock "${offer.promotion.name}" — ${pitch}.`,
            productId: candidate.productId,
            slug: candidate.slug,
            size: candidate.size,
            qty: units,
            addedCost: added,
            extraSavings: extra,
            net,
          };
        }
        break;
      }
    }
    if (best) out.push(best);
  }
  return out.sort((a, b) => b.net - a.net || a.addedCost - b.addedCost).map(({ net: _net, ...s }) => s);
}

function spendMoreSuggestions({ ctx, state, cartPromotions, ineligibleCartPromotions }: NearMissInput): PricingSuggestion[] {
  const subtotal = state.merchandiseSubtotal;
  const reachable = (gap: Paise) => gap > 0 && gap <= subtotal * SPEND_MORE_RATIO;
  const out: PricingSuggestion[] = [];

  for (const promo of cartPromotions) {
    const action = promo.cartAction();
    if (!(action instanceof TieredAction)) continue;
    const scope = state.scope(action.selector);
    const next = action.nextTier(scope.subtotal);
    if (!next) continue;
    const gap = next.minSubtotal - scope.subtotal;
    if (!reachable(gap)) continue;
    const current = state.applied.get(promo.id)?.amount ?? 0;
    out.push({
      kind: 'spend-more',
      promotionId: promo.id,
      message: `Spend ${formatINR(gap)} more to get ${TieredAction.describeReward(next)} with "${promo.name}".`,
      addedCost: gap,
      extraSavings: Math.max(0, action.discountAtTier(next, next.minSubtotal) - current),
    });
  }

  for (const promo of ineligibleCartPromotions) {
    const action = promo.cartAction();
    if (!action) continue;
    const threshold = subtotalThresholds(promo.def.conditions)
      .filter(t => t > ctx.merchandiseSubtotal)
      .sort((a, b) => a - b)[0];
    if (threshold === undefined || !reachable(threshold - ctx.merchandiseSubtotal)) continue;
    if (!promo.condition.isSatisfiedBy({ ...ctx, merchandiseSubtotal: threshold })) continue;
    const gap = threshold - ctx.merchandiseSubtotal;
    out.push({
      kind: 'spend-more',
      promotionId: promo.id,
      message: `Spend ${formatINR(gap)} more to unlock "${promo.name}" (${action.summary()}).`,
      addedCost: gap,
      extraSavings: action.discount(threshold, threshold),
    });
  }

  if (state.shipping > 0 && state.shippingDiscount === 0) {
    const gap = FREE_SHIPPING_THRESHOLD - state.listSubtotal;
    if (reachable(gap)) {
      out.push({
        kind: 'spend-more',
        message: `Add ${formatINR(gap)} more to get free shipping.`,
        addedCost: gap,
        extraSavings: state.shipping,
      });
    }
  }
  return out.sort((a, b) => a.addedCost - b.addedCost);
}
