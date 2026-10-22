export interface AssociationThresholds {
  /** Minimum number of baskets containing both items. */
  minPairCount: number;
  minConfidence: number;
  minLift: number;
  maxPerItem: number;
}

export const DEFAULT_THRESHOLDS: AssociationThresholds = { minPairCount: 2, minConfidence: 0.05, minLift: 1, maxPerItem: 8 };

export interface Association {
  productId: string;
  pairCount: number;
  /** P(A and B) over all baskets. */
  support: number;
  /** P(B | A). */
  confidence: number;
  /** confidence / P(B); above 1 means buying A makes B more likely than baseline. */
  lift: number;
}

/** Treats floating-point noise as a tie so equal ratios fall through to the next criterion. */
const byMagnitude = (delta: number) => (Math.abs(delta) < 1e-9 ? 0 : delta);

/**
 * Pairwise association rules ("customers who bought A also bought B") over baskets of distinct
 * product ids. Quadratic in basket size, which is bounded by the 50-line cart limit.
 */
export function mineAssociations(
  baskets: Iterable<Iterable<string>>,
  thresholds: AssociationThresholds = DEFAULT_THRESHOLDS,
): Map<string, Association[]> {
  const itemCounts = new Map<string, number>();
  const pairCounts = new Map<string, Map<string, number>>();
  let basketCount = 0;

  for (const raw of baskets) {
    const items = [...new Set(raw)];
    if (!items.length) continue;
    basketCount++;
    for (const item of items) itemCounts.set(item, (itemCounts.get(item) ?? 0) + 1);
    for (const a of items) {
      for (const b of items) {
        if (a === b) continue;
        const row = pairCounts.get(a) ?? new Map<string, number>();
        row.set(b, (row.get(b) ?? 0) + 1);
        pairCounts.set(a, row);
      }
    }
  }

  const result = new Map<string, Association[]>();
  for (const [a, row] of pairCounts) {
    const countA = itemCounts.get(a)!;
    const rules: Association[] = [];
    for (const [b, pairCount] of row) {
      if (pairCount < thresholds.minPairCount) continue;
      const confidence = pairCount / countA;
      const lift = confidence / (itemCounts.get(b)! / basketCount);
      if (confidence < thresholds.minConfidence || lift < thresholds.minLift) continue;
      rules.push({ productId: b, pairCount, support: pairCount / basketCount, confidence, lift });
    }
    rules.sort(
      (x, y) =>
        byMagnitude(y.lift - x.lift) ||
        byMagnitude(y.confidence - x.confidence) ||
        y.pairCount - x.pairCount ||
        x.productId.localeCompare(y.productId),
    );
    if (rules.length) result.set(a, rules.slice(0, thresholds.maxPerItem));
  }
  return result;
}
