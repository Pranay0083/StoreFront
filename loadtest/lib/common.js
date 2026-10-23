import http from 'k6/http';
import { check, fail } from 'k6';

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:4001';
export const API = `${BASE_URL}/api/v1`;

export const ADDRESS = {
  name: 'Load Test',
  line1: '12 Residency Road',
  city: 'Bengaluru',
  state: 'KA',
  pincode: '560025',
  phone: '9876543210',
};

export const json = { 'Content-Type': 'application/json' };
export const bearer = token => ({ ...json, Authorization: `Bearer ${token}` });

export function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const pick = list => list[Math.floor(Math.random() * list.length)];

/** Zipf-like skew so a few products get most traffic, as real catalogs do. */
export function skewedPick(list, s = 1.1) {
  const weights = list.map((_, i) => 1 / Math.pow(i + 1, s));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < list.length; i++) {
    r -= weights[i];
    if (r <= 0) return list[i];
  }
  return list[list.length - 1];
}

export function getJson(url, params = {}) {
  const res = http.get(url, params);
  check(res, { 'status 200': r => r.status === 200 });
  return res;
}

/** Loads the whole catalog once per test so VUs pick real slugs, ids and in-stock sizes. */
export function loadCatalog() {
  const products = [];
  let cursor = null;
  for (let i = 0; i < 200; i++) {
    const url = `${API}/products?limit=48${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = http.get(url);
    if (res.status !== 200) fail(`catalog load failed: ${res.status}`);
    const body = res.json();
    products.push(...body.items);
    cursor = body.nextCursor;
    if (!cursor) break;
  }
  const categories = http
    .get(`${API}/products/categories`)
    .json()
    .map(c => c.name);
  return {
    categories,
    products: products.map(p => ({
      id: p._id,
      slug: p.slug,
      title: p.title,
      category: p.category,
      sizes: p.sizes.filter(s => s.stock > 0).map(s => s.size),
    })),
  };
}

export const latencyThresholds = (p95, p99) => ({
  http_req_failed: ['rate<0.01'],
  http_req_duration: [`p(95)<${p95}`, `p(99)<${p99}`],
});
