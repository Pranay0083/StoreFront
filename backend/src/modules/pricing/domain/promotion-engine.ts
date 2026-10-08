import { formatINR, type Paise, type PaymentMethod, type PriceBreakdown, type RejectedCode } from '@storefront/contracts';
import {
  type BundleApplication,
  type BundleCandidate,
  optimizeBundles,
  type OptimizerOptions,
  type OptimizerResult,
} from './bundle-optimizer';
import { computeMarkdowns, type MarkdownResult } from './markdown';
import { suggestNearMisses } from './near-miss';
import { type CustomerProfile, effectiveSubtotal, listSubtotal, type PricingContext, type PricingLine } from './pricing-line';
import { PricingState } from './pricing-state';
import { CompiledPromotion } from './promotion';
import { BundleStage, CartDiscountStage, MarkdownStage, PricingStage, ShippingStage } from './stages';

export interface PriceRequest {
  lines: readonly PricingLine[];
  customer: CustomerProfile;
  paymentMethod?: PaymentMethod;
  codes?: readonly string[];
  now: Date;
  /** Catalog products outside the cart that "add one more" suggestions may recommend. */
  suggestionPool?: readonly PricingLine[];
}

export interface EngineOptions {
  optimizer?: OptimizerOptions;
  /** Upper bound on stack-group combinations evaluated exhaustively. */
  maxSelections?: number;
  suggestions?: boolean;
}

type Plan = BundleApplication<CompiledPromotion>[];

interface Selection {
  chosen: CompiledPromotion[];
  groupChoice: Map<string, CompiledPromotion>;
}

interface Scenario extends Selection {
  label: 'optimal' | 'greedy' | 'none' | 'exclusive';
  plan: Plan;
  exclusive?: CompiledPromotion;
  optimizer: OptimizerResult<CompiledPromotion>;
  state: PricingState;
}

const isOrderLevel = (p: CompiledPromotion) => p.stage === 'cart' || p.stage === 'code' || p.stage === 'shipping';
const bundleOffersOf = (promos: readonly CompiledPromotion[]): BundleCandidate<CompiledPromotion>[] =>
  promos.flatMap(p => {
    const action = p.consumingAction();
    return action ? [{ promotion: p, action }] : [];
  });
const cheapest = <T extends { state: PricingState }>(xs: readonly T[]): T | undefined =>
  xs.reduce<T | undefined>((best, x) => (!best || x.state.total < best.state.total ? x : best), undefined);

/**
 * Finds the lowest total for a cart across all eligible promotions:
 * markdowns → optimal bundle packing → order-level discounts (one per stack group) → codes → shipping,
 * comparing every stack-group choice and every exclusive offer on its own, then explains the outcome.
 */
export class PromotionEngine {
  constructor(private readonly options: EngineOptions = {}) {}

  price(request: PriceRequest, promotions: readonly CompiledPromotion[]): PriceBreakdown {
    const { now, customer, paymentMethod } = request;
    const sorted = [...promotions].sort(CompiledPromotion.compare);
    const rejected: RejectedCode[] = [];

    const redeemed = new Set<CompiledPromotion>();
    for (const code of new Set((request.codes ?? []).map(c => c.trim().toUpperCase()).filter(Boolean))) {
      const match = sorted.find(p => p.requiresCode && p.def.code === code);
      const live = match?.liveness(now);
      if (!match) rejected.push({ code, reason: 'This code is not valid' });
      else if (!live?.ok) rejected.push({ code, reason: live?.reason ?? 'This code is not valid' });
      else redeemed.add(match);
    }
    const live = sorted.filter(p => p.isLive(now) && (!p.requiresCode || redeemed.has(p)));

    const ineligible: CompiledPromotion[] = [];
    const passes = (p: CompiledPromotion, ctx: PricingContext) => {
      const result = p.condition.evaluate(ctx);
      if (!result.ok) {
        ineligible.push(p);
        if (p.requiresCode) rejected.push({ code: p.def.code!, reason: result.reason ?? 'Not eligible' });
      }
      return result.ok;
    };

    const baseCtx: PricingContext = {
      now,
      lines: request.lines,
      merchandiseSubtotal: listSubtotal(request.lines),
      customer,
      paymentMethod,
    };
    const markdownPromos = live.filter(p => p.stage === 'markdown' && passes(p, baseCtx));
    const markdowns = computeMarkdowns(request.lines, markdownPromos, now);
    const ctx: PricingContext = { ...baseCtx, merchandiseSubtotal: effectiveSubtotal(markdowns.lines) };
    const eligible = live.filter(p => p.stage !== 'markdown' && passes(p, ctx));

    const shared = eligible.filter(p => !p.exclusive);
    const bundleOffers = bundleOffersOf(shared);
    const orderLevel = shared.filter(isOrderLevel);
    const evaluate = (plan: Plan, chosen: readonly CompiledPromotion[]) => this.run(markdowns, plan, chosen);

    const optimizer = optimizeBundles(markdowns.lines, bundleOffers, this.options.optimizer);
    const plans: Array<{ label: Scenario['label']; plan: Plan }> = [{ label: 'optimal', plan: optimizer.applications }];
    if (optimizer.greedySavings < optimizer.savings) plans.push({ label: 'greedy', plan: optimizer.greedyApplications });
    if (optimizer.applications.length) plans.push({ label: 'none', plan: [] });

    const selections = this.selections(orderLevel, chosen => evaluate(optimizer.applications, chosen).total);
    const scenarios: Scenario[] = plans.flatMap(({ label, plan }) =>
      selections.map(sel => ({ label, plan, ...sel, optimizer, state: evaluate(plan, sel.chosen) })),
    );
    for (const exclusive of eligible.filter(p => p.exclusive)) {
      const solo = optimizeBundles(markdowns.lines, bundleOffersOf([exclusive]), this.options.optimizer);
      const chosen = isOrderLevel(exclusive) ? [exclusive] : [];
      scenarios.push({
        label: 'exclusive',
        plan: solo.applications,
        chosen,
        groupChoice: new Map(),
        exclusive,
        optimizer: solo,
        state: evaluate(solo.applications, chosen),
      });
    }
    const best = cheapest(scenarios)!;

    for (const promo of redeemed) {
      if (!eligible.includes(promo) || best.state.applied.has(promo.id)) continue;
      const helpsSomewhere = scenarios.some(s => s.state.applied.has(promo.id));
      rejected.push({
        code: promo.def.code!,
        reason: helpsSomewhere
          ? 'Another offer gives you a better price on this cart'
          : 'This code does not apply to the items in your cart',
      });
    }

    const suggestions =
      this.options.suggestions === false
        ? []
        : suggestNearMisses({
            lines: markdowns.lines,
            ctx,
            state: best.state,
            bundleOffers,
            currentPlan: optimizer.applications,
            cartPromotions: orderLevel,
            ineligibleCartPromotions: ineligible.filter(p => p.cartAction()),
            pool: request.suggestionPool?.length ? computeMarkdowns(request.suggestionPool, markdownPromos, now).lines : [],
          });

    return this.toBreakdown(best, rejected, this.explain(best, scenarios, orderLevel, eligible), suggestions);
  }

  private run(markdowns: MarkdownResult, plan: Plan, chosen: readonly CompiledPromotion[]): PricingState {
    const ordered = [...chosen].sort(CompiledPromotion.compare);
    return PricingStage.chain(
      new MarkdownStage(markdowns),
      new BundleStage(plan),
      new CartDiscountStage(
        ordered.filter(p => p.stage === 'cart'),
        'cart',
      ),
      new CartDiscountStage(
        ordered.filter(p => p.stage === 'code'),
        'code',
      ),
      new ShippingStage(ordered.filter(p => p.stage === 'shipping')),
    ).handle(new PricingState(markdowns.lines));
  }

  /** Every way to pick at most one promotion per stack group (ungrouped promotions always apply). */
  private selections(promos: readonly CompiledPromotion[], totalWith: (chosen: CompiledPromotion[]) => Paise): Selection[] {
    const free = promos.filter(p => !p.stackGroup);
    const groups = new Map<string, CompiledPromotion[]>();
    for (const p of promos) if (p.stackGroup) groups.set(p.stackGroup, [...(groups.get(p.stackGroup) ?? []), p]);

    const combinations = [...groups.values()].reduce((n, members) => n * members.length, 1);
    if (combinations > (this.options.maxSelections ?? 64)) {
      const groupChoice = new Map<string, CompiledPromotion>();
      for (const [group, members] of groups) {
        groupChoice.set(
          group,
          members.reduce((a, b) => (totalWith([...free, b]) < totalWith([...free, a]) ? b : a)),
        );
      }
      return [{ chosen: [...free, ...groupChoice.values()], groupChoice }];
    }

    let out: Selection[] = [{ chosen: [...free], groupChoice: new Map() }];
    for (const [group, members] of groups) {
      out = out.flatMap(sel => members.map(m => ({ chosen: [...sel.chosen, m], groupChoice: new Map(sel.groupChoice).set(group, m) })));
    }
    return out;
  }

  private explain(
    best: Scenario,
    scenarios: readonly Scenario[],
    orderLevel: readonly CompiledPromotion[],
    eligible: readonly CompiledPromotion[],
  ): string[] {
    const out: string[] = [];
    for (const a of best.state.applied.values()) {
      out.push(`${a.name}: ${a.description}${a.times > 1 ? ` (applied ${a.times}×)` : ''} — saves ${formatINR(a.amount)}.`);
    }

    if (!best.exclusive) {
      const groups = new Map<string, CompiledPromotion[]>();
      for (const p of orderLevel) if (p.stackGroup) groups.set(p.stackGroup, [...(groups.get(p.stackGroup) ?? []), p]);
      for (const [group, members] of groups) {
        const kept = best.groupChoice.get(group);
        if (!kept || members.length < 2) continue;
        for (const other of members.filter(m => m !== kept)) {
          const alt = cheapest(scenarios.filter(s => !s.exclusive && s.label === best.label && s.groupChoice.get(group) === other));
          if (!alt || !alt.state.applied.has(other.id)) continue;
          const diff = alt.state.total - best.state.total;
          out.push(
            diff > 0
              ? `Applied "${kept.name}" instead of "${other.name}": only one ${group} offer can be used per order, and this one saves ${formatINR(diff)} more.`
              : `"${kept.name}" and "${other.name}" can't be combined and save the same here, so we kept "${kept.name}".`,
          );
        }
      }
    }

    const bestShared = cheapest(scenarios.filter(s => !s.exclusive));
    for (const exclusive of eligible.filter(p => p.exclusive)) {
      const solo = scenarios.find(s => s.exclusive === exclusive);
      if (!solo || !bestShared) continue;
      if (best.exclusive === exclusive) {
        out.push(
          `"${exclusive.name}" can't be combined with other offers, and on its own it saves ${formatINR(bestShared.state.total - best.state.total)} more than the best combination.`,
        );
      } else if (solo.state.applied.has(exclusive.id)) {
        out.push(
          `"${exclusive.name}" can't be combined with other offers; the combination applied saves ${formatINR(solo.state.total - best.state.total)} more.`,
        );
      }
    }

    const { optimizer } = best;
    if (best.label === 'optimal' && optimizer.savings > optimizer.greedySavings) {
      out.push(
        `Our optimizer found a bundle combination that saves ${formatINR(optimizer.savings - optimizer.greedySavings)} more than applying the single biggest offer first.`,
      );
    }
    if (optimizer.strategy === 'greedy-fallback') {
      out.push('This cart has many overlapping offers, so we applied the best combination found within our search limit.');
    }
    return out;
  }

  private toBreakdown(
    best: Scenario,
    rejectedCodes: RejectedCode[],
    explanations: string[],
    suggestions: PriceBreakdown['suggestions'],
  ): PriceBreakdown {
    const { state } = best;
    const lines = state.lines.map(({ line, amount, discounts }) => ({
      productId: line.productId,
      slug: line.slug,
      title: line.title,
      ...(line.image && { image: line.image }),
      category: line.category,
      size: line.size,
      qty: line.qty,
      unitPrice: line.unitPrice,
      markdownPerUnit: line.markdownPerUnit,
      effectiveUnitPrice: line.effectiveUnitPrice,
      lineSubtotal: line.effectiveUnitPrice * line.qty,
      discounts: [...discounts].map(([promotionId, value]) => ({ promotionId, amount: value })),
      lineTotal: amount,
    }));
    const sum = (f: (l: (typeof lines)[number]) => number) => lines.reduce((s, l) => s + f(l), 0);
    const { bundle, cart, code, markdown } = state.stageTotals;
    const discountTotal = bundle + cart + code;
    return {
      currency: 'INR',
      lines,
      listSubtotal: sum(l => l.unitPrice * l.qty),
      markdownTotal: markdown,
      merchandiseSubtotal: sum(l => l.lineSubtotal),
      bundleDiscount: bundle,
      cartDiscount: cart,
      codeDiscount: code,
      discountTotal,
      shipping: state.shipping,
      shippingDiscount: state.shippingDiscount,
      total: state.total,
      totalSavings: markdown + discountTotal + state.shippingDiscount,
      applied: [...state.applied.values()],
      explanations,
      suggestions,
      rejectedCodes,
      optimizer: {
        strategy: best.optimizer.strategy,
        nodesExplored: best.optimizer.nodesExplored,
        bundleSavings: bundle,
        greedySavings: best.optimizer.greedySavings,
      },
    };
  }
}
