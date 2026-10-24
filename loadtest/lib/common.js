import http from 'k6/http';
import { check } from 'k6';

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

/** Power-law skew (index = n*u^k): with k=3 the first 1% of items get ~21% of picks and the first 10% ~46%. */
export const skewedPick = (list, k = 3) => list[Math.floor(list.length * Math.pow(Math.random(), k))];

export function getJson(url, params = {}) {
  const res = http.get(url, params);
  check(res, { 'status 200': r => r.status === 200 });
  return res;
}

export const latencyThresholds = (p95, p99) => ({
  http_req_failed: ['rate<0.01'],
  http_req_duration: [`p(95)<${p95}`, `p(99)<${p99}`],
});
