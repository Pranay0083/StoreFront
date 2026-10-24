import http from 'k6/http';
import { check } from 'k6';
import { words } from '../lib/catalog.js';
import { API, latencyThresholds, pick } from '../lib/common.js';

const RATE = Number(__ENV.RATE || 100);
const DURATION = __ENV.DURATION || '2m';

export const options = {
  scenarios: {
    search: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 50,
      maxVUs: 300,
    },
  },
  thresholds: {
    ...latencyThresholds(300, 700),
    'http_req_duration{kind:suggest}': ['p(95)<150'],
  },
};

const typo = word => {
  if (word.length < 5) return word;
  const i = 1 + Math.floor(Math.random() * (word.length - 2));
  return word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2);
};

export default function () {
  const word = pick(words);
  if (Math.random() < 0.6) {
    const prefix = word.slice(0, 2 + Math.floor(Math.random() * (word.length - 1)));
    const res = http.get(`${API}/products/suggest?q=${encodeURIComponent(prefix)}`, {
      tags: { kind: 'suggest', name: 'GET /products/suggest' },
    });
    check(res, { 'suggest 200': r => r.status === 200 });
  } else {
    const q = Math.random() < 0.3 ? typo(word) : `${word} ${pick(words)}`;
    const res = http.get(`${API}/products?q=${encodeURIComponent(q)}&limit=24`, { tags: { kind: 'search', name: 'GET /products?q' } });
    check(res, { 'search 200': r => r.status === 200 });
  }
}
