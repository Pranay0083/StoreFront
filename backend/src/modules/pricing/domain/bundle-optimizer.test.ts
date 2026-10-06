import type { ProductSelector } from '@storefront/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BuyXGetYAction, type ConsumingAction, FixedBundlePriceAction, MixAndMatchAction } from './actions';
import { type BundleCandidate, optimizeBundles } from './bundle-optimizer';
import { type EffectiveLine, withoutMarkdown } from './pricing-line';
import { matchesSelector } from './selector';
import { line } from './test-fixtures';

const offer = (id: string, action: ConsumingAction): BundleCandidate<string> => ({ promotion: id, action });

/** Independent unit-level exhaustive search used as the oracle. */
function bruteForce(lines: readonly EffectiveLine[], offers: readonly BundleCandidate<string>[]): number {
  const units = lines.flatMap(l => Array.from({ length: l.qty }, () => l));
  const used = units.map(() => false);

  const assignable = (picked: EffectiveLine[], slots: ReturnType<ConsumingAction['slots']>): boolean => {
    const fill = (i: number, left: number[]): boolean => {
      if (i === picked.length) return left.every(n => n === 0);
      return slots.some((s, j) => {
        if (left[j] === 0 || !matchesSelector(s.selector, picked[i])) return false;
        left[j]--;
        const ok = fill(i + 1, left);
        left[j]++;
        return ok;
      });
    };
    return fill(0, slots.map(s => s.qty));
  };

  const search = (from: number): number => {
    let u = from;
    while (u < units.length && used[u]) u++;
    if (u === units.length) return 0;
    used[u] = true;
    let best = search(u + 1);
    for (const o of offers) {
      const size = o.action.unitsPerApplication;
      const rest = units.map((_, i) => i).filter(i => i > u && !used[i]);
      const combos = (start: number, need: number, acc: number[]): number[][] =>
        need === 0 ? [acc] : rest.slice(start).flatMap((idx, k) => combos(start + k + 1, need - 1, [...acc, idx]));
      for (const combo of combos(0, size - 1, [])) {
        const picked = [u, ...combo];
        const pickedLines = picked.map(i => units[i]);
        if (!assignable(pickedLines, o.action.slots())) continue;
        const savings = o.action.savings(pickedLines.map(p => p.effectiveUnitPrice));
        if (savings <= 0) continue;
        combo.forEach(i => (used[i] = true));
        best = Math.max(best, savings + search(u + 1));
        combo.forEach(i => (used[i] = false));
      }
    }
    used[u] = false;
    return best;
  };
  return search(0);
}

function assertPlanIsValid(lines: readonly EffectiveLine[], result: ReturnType<typeof optimizeBundles<string>>, offers: BundleCandidate<string>[]) {
  const consumed = lines.map(() => 0);
  let total = 0;
  for (const app of result.applications) {
    const prices = app.lineUnits.flatMap(({ lineIndex, units }) => {
      consumed[lineIndex] += units;
      return Array.from({ length: units }, () => lines[lineIndex].effectiveUnitPrice);
    });
    const action = offers.find(o => o.promotion === app.promotion)!.action;
    const pickedLines = app.lineUnits.flatMap(({ lineIndex, units }) => Array.from({ length: units }, () => lines[lineIndex]));
    expect(pickedLines).toHaveLength(action.unitsPerApplication);
    expect(action.savings(prices)).toBe(app.savings);
    total += app.savings;
  }
  consumed.forEach((n, i) => expect(n).toBeLessThanOrEqual(lines[i].qty));
  expect(total).toBe(result.savings);
}

describe('optimizeBundles', () => {
  const a = line({ slug: 'a', unitPrice: 100_000 });
  const b = line({ slug: 'b', unitPrice: 100_000 });
  const c = line({ slug: 'c', unitPrice: 100_000 });
  const d = line({ slug: 'd', unitPrice: 100_000 });

  it('beats greedy when the biggest single offer blocks two smaller ones', () => {
    const lines = withoutMarkdown([a, b, c, d]);
    const offers = [
      offer('any-2-ab', new MixAndMatchAction({ slugs: ['a', 'b'] }, 2, 110_000)),
      offer('a+c', new FixedBundlePriceAction([{ selector: { slugs: ['a'] }, qty: 1 }, { selector: { slugs: ['c'] }, qty: 1 }], 140_000)),
      offer('b+d', new FixedBundlePriceAction([{ selector: { slugs: ['b'] }, qty: 1 }, { selector: { slugs: ['d'] }, qty: 1 }], 140_000)),
    ];
    const result = optimizeBundles(lines, offers);
    expect(result.greedySavings).toBe(90_000);
    expect(result.savings).toBe(120_000);
    expect(result.applications.map(x => x.promotion).sort()).toEqual(['a+c', 'b+d']);
    expect(result.strategy).toBe('branch-and-bound');
    assertPlanIsValid(lines, result, offers);
  });

  it('groups the most expensive eligible units into a mix-and-match set', () => {
    const lines = withoutMarkdown([line({ slug: 'tee', unitPrice: 79_900, qty: 2 }), line({ slug: 'polo', unitPrice: 129_900, qty: 2 })]);
    const offers = [offer('any-3', new MixAndMatchAction({ slugs: ['tee', 'polo'] }, 3, 249_900))];
    const result = optimizeBundles(lines, offers);
    expect(result.savings).toBe(129_900 * 2 + 79_900 - 249_900);
    expect(result.applications[0].lineUnits).toEqual([
      { lineIndex: 0, units: 1 },
      { lineIndex: 1, units: 2 },
    ]);
  });

  it('groups buy-x-get-y units so the most valuable items end up free', () => {
    const lines = withoutMarkdown([line({ slug: 'belt', unitPrice: 179_900, qty: 3 }), line({ slug: 'beanie', unitPrice: 129_900, qty: 3 })]);
    const offers = [offer('b2g1', new BuyXGetYAction({ slugs: ['belt', 'beanie'] }, 2, 1, 100))];
    const result = optimizeBundles(lines, offers);
    expect(result.applications).toHaveLength(2);
    // Mixed groups would free two beanies (₹2,598); grouping like with like frees a belt and a beanie.
    expect(result.savings).toBe(179_900 + 129_900);
    assertPlanIsValid(lines, result, offers);
  });

  it('returns an empty plan when nothing qualifies', () => {
    const result = optimizeBundles(withoutMarkdown([a]), [offer('any-2', new MixAndMatchAction({ slugs: ['a'] }, 2, 1_000))]);
    expect(result).toMatchObject({ applications: [], savings: 0, greedySavings: 0, strategy: 'branch-and-bound' });
  });

  it('falls back to the greedy incumbent when the node budget runs out', () => {
    const lines = withoutMarkdown(Array.from({ length: 12 }, (_, i) => line({ slug: `s${i}`, category: 'Men', unitPrice: 50_000 + i * 7_000, qty: 3 })));
    const offers = [
      offer('any-3', new MixAndMatchAction({ categories: ['Men'] }, 3, 120_000)),
      offer('b2g1', new BuyXGetYAction({ categories: ['Men'] }, 2, 1, 100)),
    ];
    const result = optimizeBundles(lines, offers, { nodeBudget: 50 });
    expect(result.strategy).toBe('greedy-fallback');
    expect(result.savings).toBeGreaterThanOrEqual(result.greedySavings);
    assertPlanIsValid(lines, result, offers);
  });
});

const PRODUCTS = ['p0', 'p1', 'p2', 'p3'];
const CATEGORIES = ['Men', 'Women'];

const selectorArb: fc.Arbitrary<ProductSelector> = fc.oneof(
  fc.subarray(PRODUCTS, { minLength: 1 }).map(slugs => ({ slugs })),
  fc.subarray(CATEGORIES, { minLength: 1 }).map(categories => ({ categories })),
);
const priceArb = fc.integer({ min: 20, max: 400 }).map(n => n * 1_000);

const actionArb: fc.Arbitrary<ConsumingAction> = fc.oneof(
  fc.tuple(selectorArb, fc.integer({ min: 2, max: 3 }), priceArb).map(([s, q, p]) => new MixAndMatchAction(s, q, p)),
  fc
    .tuple(fc.array(fc.record({ selector: selectorArb, qty: fc.integer({ min: 1, max: 2 }) }), { minLength: 1, maxLength: 2 }), priceArb)
    .map(([components, p]) => new FixedBundlePriceAction(components, p)),
  fc
    .tuple(selectorArb, fc.integer({ min: 1, max: 2 }), fc.constantFrom(50, 100))
    .map(([s, buy, pct]) => new BuyXGetYAction(s, buy, 1, pct)),
);

const scenarioArb = fc.record({
  products: fc.tuple(...PRODUCTS.map(() => fc.record({ category: fc.constantFrom(...CATEGORIES), price: priceArb, qty: fc.integer({ min: 0, max: 3 }) }))),
  actions: fc.array(actionArb, { minLength: 1, maxLength: 4 }),
});

describe('optimizeBundles properties', () => {
  it('matches exhaustive search, never loses to greedy and only consumes units that exist', () => {
    fc.assert(
      fc.property(scenarioArb, ({ products, actions }) => {
        const lines = withoutMarkdown(
          products
            .map((p, i) => line({ slug: PRODUCTS[i], productId: PRODUCTS[i], category: p.category, unitPrice: p.price, qty: p.qty }))
            .filter(l => l.qty > 0),
        );
        fc.pre(lines.reduce((s, l) => s + l.qty, 0) <= 8);
        const offers = actions.map((action, i) => offer(`o${i}`, action));
        const result = optimizeBundles(lines, offers);
        expect(result.strategy).toBe('branch-and-bound');
        expect(result.savings).toBe(bruteForce(lines, offers));
        expect(result.savings).toBeGreaterThanOrEqual(result.greedySavings);
        assertPlanIsValid(lines, result, offers);
      }),
      { numRuns: Number(process.env.FC_RUNS ?? 300) },
    );
  });
});
