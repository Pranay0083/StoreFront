import http from 'k6/http';
import { check, group } from 'k6';
import { API, latencyThresholds, loadCatalog, pick, skewedPick } from '../lib/common.js';

const RATE = Number(__ENV.RATE || 200);
const DURATION = __ENV.DURATION || '2m';
const SORTS = ['newest', 'price-asc', 'price-desc', 'rating'];

export const options = {
  scenarios: {
    browse: {
      executor: 'ramping-arrival-rate',
      startRate: Math.ceil(RATE / 10),
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 400,
      stages: [
        { target: RATE, duration: '30s' },
        { target: RATE, duration: DURATION },
        { target: 0, duration: '10s' },
      ],
    },
  },
  thresholds: {
    ...latencyThresholds(250, 600),
    'http_req_duration{page:listing}': ['p(95)<300'],
    'http_req_duration{page:product}': ['p(95)<200'],
  },
};

export function setup() {
  return loadCatalog();
}

export default function (data) {
  const roll = Math.random();
  if (roll < 0.45) {
    group('product page', () => {
      const product = skewedPick(data.products);
      const res = http.get(`${API}/products/${product.slug}`, { tags: { page: 'product', name: 'GET /products/:slug' } });
      check(res, { 'product 200': r => r.status === 200 });
      http.get(`${API}/products/${product.id}/recommendations?limit=4`, {
        tags: { page: 'product', name: 'GET /products/:id/recommendations' },
      });
    });
  } else if (roll < 0.9) {
    const params = [`sort=${pick(SORTS)}`, 'limit=24'];
    if (Math.random() < 0.7) params.push(`category=${encodeURIComponent(skewedPick(data.categories))}`);
    if (Math.random() < 0.15) params.push('featured=true');
    const res = http.get(`${API}/products?${params.join('&')}`, { tags: { page: 'listing', name: 'GET /products' } });
    check(res, { 'listing 200': r => r.status === 200 });
  } else {
    const res = http.get(`${API}/products/categories`, { tags: { page: 'categories', name: 'GET /products/categories' } });
    check(res, { 'categories 200': r => r.status === 200 });
  }
}
