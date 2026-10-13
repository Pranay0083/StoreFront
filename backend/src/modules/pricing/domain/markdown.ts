import { percentOf, type Paise } from '@storefront/contracts';
import type { EffectiveLine, PricingLine } from './pricing-line';
import type { CompiledPromotion } from './promotion';

export interface MarkdownResult {
  lines: EffectiveLine[];
  /** Per promotion: total markdown and the lines it priced. */
  applied: Map<CompiledPromotion, { amount: Paise; lines: number[] }>;
}

/** Each line takes the single best markdown available to it; markdowns never compound. */
export function computeMarkdowns(lines: readonly PricingLine[], promotions: readonly CompiledPromotion[], now: Date): MarkdownResult {
  const applied = new Map<CompiledPromotion, { amount: Paise; lines: number[] }>();
  const priced = lines.map((line, index) => {
    let best: { promo: CompiledPromotion; percent: number } | undefined;
    for (const promo of promotions) {
      const percent = promo.markdownAction()?.percentFor(line, now) ?? 0;
      if (percent > 0 && (!best || percent > best.percent)) best = { promo, percent };
    }
    const markdownPerUnit = best ? percentOf(line.unitPrice, best.percent) : 0;
    if (best && markdownPerUnit > 0) {
      const entry = applied.get(best.promo) ?? { amount: 0, lines: [] };
      entry.amount += markdownPerUnit * line.qty;
      entry.lines.push(index);
      applied.set(best.promo, entry);
    }
    return { ...line, markdownPerUnit, effectiveUnitPrice: line.unitPrice - markdownPerUnit };
  });
  return { lines: priced, applied };
}
