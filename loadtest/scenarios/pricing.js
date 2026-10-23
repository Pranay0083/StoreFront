import http from 'k6/http';
import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { API, json, latencyThresholds, loadCatalog, pick, skewedPick } from '../lib/common.js';

const RATE = Number(__ENV.RATE || 60);
const DURATION = __ENV.DURATION || '2m';
const cartUnits = new Trend('cart_units');
const savings = new Trend('quote_savings_paise');
const greedyFallback = new Rate('optimizer_greedy_fallback');
const beatGreedy = new Rate('optimizer_beat_greedy');

export const options = {
  scenarios: {
    quotes: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 40,
      maxVUs: 300,
    },
  },
  thresholds: {
    ...latencyThresholds(400, 900),
  },
};

export function setup() {
  const catalog = loadCatalog();
  const products = catalog.products.filter(p => p.sizes.length > 0);
  // Demo-seeded products are the ones the seeded promotions target; load-test fillers end in "-<n>".
  const promoted = products.filter(p => !/-\d+$/.test(p.slug));
  return { products, promoted };
}

/** Mixed carts: mostly small, some large enough to make the optimizer search. */
function cart(products, promoted) {
  const lines = Math.random() < 0.8 ? 1 + Math.floor(Math.random() * 4) : 5 + Math.floor(Math.random() * 6);
  const items = new Map();
  for (let i = 0; i < lines; i++) {
    const p = promoted.length && Math.random() < 0.7 ? pick(promoted) : skewedPick(products, 0.6);
    const size = pick(p.sizes);
    const key = `${p.id}:${size}`;
    const qty = (items.get(key)?.qty || 0) + (Math.random() < 0.25 ? 2 : 1);
    items.set(key, { productId: p.id, size, qty: Math.min(qty, 5) });
  }
  return [...items.values()];
}

export default function ({ products, promoted }) {
  const items = cart(products, promoted);
  cartUnits.add(items.reduce((s, i) => s + i.qty, 0));
  const body = { items, codes: Math.random() < 0.3 ? ['WELCOME10'] : [] };
  const res = http.post(`${API}/pricing/quote`, JSON.stringify(body), { headers: json, tags: { name: 'POST /pricing/quote' } });
  const ok = check(res, {
    'quote 200': r => r.status === 200,
    'total is non-negative': r => r.status === 200 && r.json('breakdown.total') >= 0,
  });
  if (!ok) return;
  savings.add(res.json('breakdown.totalSavings'));
  const optimizer = res.json('breakdown.optimizer');
  greedyFallback.add(optimizer.strategy === 'greedy-fallback');
  beatGreedy.add(optimizer.bundleSavings > optimizer.greedySavings);
}
