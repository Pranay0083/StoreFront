import type { ActionSpec, ConditionSpec } from '@storefront/contracts';
import { performance } from 'node:perf_hooks';
import type { PricingLine } from '../src/modules/pricing/domain/pricing-line';
import { CompiledPromotion } from '../src/modules/pricing/domain/promotion';
import { PromotionEngine } from '../src/modules/pricing/domain/promotion-engine';

/** Deterministic PRNG so every run benchmarks the same carts and promotions. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(42);
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(xs: readonly T[]) => xs[int(0, xs.length - 1)];
const sample = <T>(xs: readonly T[], n: number) => [...xs].sort(() => rand() - 0.5).slice(0, n);

const CATEGORIES = ['Men', 'Women', 'Footwear', 'Accessories'];
const PRODUCTS = Array.from({ length: 25 }, (_, i) => ({
  slug: `product-${i}`,
  category: CATEGORIES[i % CATEGORIES.length],
  price: int(10, 130) * 10_000 - 100,
}));

function lineFor(i: number, qty: number): PricingLine {
  const p = PRODUCTS[i];
  return {
    productId: `id-${p.slug}`,
    slug: p.slug,
    title: p.slug,
    category: p.category,
    size: 'M',
    qty,
    unitPrice: p.price,
    stock: int(0, 30),
    productCreatedAt: new Date('2026-05-01T00:00:00Z'),
  };
}

const selector = () => (rand() < 0.5 ? { categories: [pick(CATEGORIES)] } : { slugs: sample(PRODUCTS, int(3, 8)).map(p => p.slug) });

function randomAction(kind: number): ActionSpec {
  switch (kind % 8) {
    case 0:
    case 1:
      return { type: 'mixAndMatch', selector: selector(), quantity: int(2, 4), price: int(30, 200) * 10_000 };
    case 2:
      return {
        type: 'fixedBundle',
        components: [
          { selector: { slugs: [pick(PRODUCTS).slug] }, qty: 1 },
          { selector: selector(), qty: int(1, 2) },
        ],
        price: int(40, 200) * 10_000,
      };
    case 3:
      return { type: 'buyXGetY', selector: selector(), buyQty: int(1, 3), getQty: 1, percentOff: pick([50, 100]) };
    case 4:
      return {
        type: 'tiered',
        tiers: [
          { minSubtotal: 1_000_000, percentOff: 5 },
          { minSubtotal: 3_000_000, percentOff: 10 },
        ],
      };
    case 5:
      return { type: 'percentOff', selector: rand() < 0.5 ? selector() : undefined, percent: int(5, 20), maxDiscount: 300_000 };
    case 6:
      return { type: 'markdown', selector: selector(), percentOff: int(5, 25) };
    default:
      return { type: 'freeShipping' };
  }
}

const PROMOTIONS = Array.from({ length: 30 }, (_, i) => {
  const conditions: ConditionSpec | undefined = rand() < 0.3 ? { type: 'minSubtotal', amount: int(1, 20) * 100_000 } : undefined;
  return new CompiledPromotion({
    id: `promo-${i}`,
    version: 1,
    name: `Promo ${i}`,
    description: '',
    status: 'active',
    activation: 'auto',
    priority: int(1, 300),
    stackGroup: i % 8 === 4 || i % 8 === 5 ? pick(['order-discount', 'loyalty']) : undefined,
    exclusive: i === 29,
    conditions,
    action: randomAction(i),
    usedCount: 0,
  });
});

function cartOf(units: number): PricingLine[] {
  const lines: PricingLine[] = [];
  let left = units;
  for (const i of sample(
    PRODUCTS.map((_, k) => k),
    PRODUCTS.length,
  )) {
    if (!left) break;
    const qty = Math.min(left, int(1, 4));
    lines.push(lineFor(i, qty));
    left -= qty;
  }
  return lines;
}

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

function bench(label: string, units: number, carts = 40, repeats = 5) {
  const engine = new PromotionEngine();
  const now = new Date('2026-10-30T06:30:00Z');
  const samples: number[] = [];
  const strategies = { 'branch-and-bound': 0, 'greedy-fallback': 0 };
  let nodes = 0;
  let beatGreedy = 0;
  const workload = Array.from({ length: carts }, () => cartOf(units));
  for (const lines of workload.slice(0, 5)) engine.price({ lines, customer: { signedIn: false, isFirstOrder: false }, now }, PROMOTIONS);

  for (const lines of workload) {
    for (let r = 0; r < repeats; r++) {
      const started = performance.now();
      const b = engine.price({ lines, customer: { signedIn: false, isFirstOrder: false }, now }, PROMOTIONS);
      samples.push(performance.now() - started);
      if (r === 0) {
        strategies[b.optimizer.strategy] += 1;
        nodes += b.optimizer.nodesExplored;
        if (b.optimizer.bundleSavings > b.optimizer.greedySavings) beatGreedy += 1;
      }
    }
  }
  samples.sort((a, b) => a - b);
  const fmt = (ms: number) => `${ms.toFixed(2)} ms`;
  console.log(`\n${label}: ${units}-unit carts × ${PROMOTIONS.length} promotions (${carts} carts × ${repeats} runs)`);
  console.log(`  p50 ${fmt(percentile(samples, 50))}   p95 ${fmt(percentile(samples, 95))}   max ${fmt(samples[samples.length - 1])}`);
  console.log(
    `  exact (branch-and-bound): ${strategies['branch-and-bound']}/${carts}   budget fallback: ${strategies['greedy-fallback']}/${carts}`,
  );
  console.log(`  avg nodes explored: ${Math.round(nodes / carts)}   optimizer beat greedy on ${beatGreedy}/${carts} carts`);
}

bench('Typical cart', 8);
bench('Medium cart', 20);
bench('Large cart', 50);
