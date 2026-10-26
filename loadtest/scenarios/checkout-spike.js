import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { ADDRESS, API, bearer, uuid } from '../lib/common.js';

// Every buyer tries to grab the same hot SKU at the same instant. Run `fixtures.mjs checkout` first.
const fixture = JSON.parse(open('../.data/checkout.json'));

const placed = new Counter('checkout_orders_placed');
const soldOut = new Counter('checkout_sold_out');
const paid = new Counter('checkout_orders_paid');
const replayMismatch = new Counter('checkout_idempotent_replay_mismatch');
const unexpected = new Counter('checkout_unexpected_status');

export const options = {
  scenarios: {
    spike: {
      executor: 'per-vu-iterations',
      vus: fixture.tokens.length,
      iterations: 1,
      maxDuration: '2m',
    },
  },
  thresholds: {
    checkout_orders_placed: [`count==${fixture.stock}`],
    checkout_orders_paid: [`count==${fixture.stock}`],
    checkout_idempotent_replay_mismatch: ['count==0'],
    checkout_unexpected_status: ['count==0'],
    'http_req_duration{name:POST /orders}': ['p(95)<3000'],
  },
};

export default function () {
  const token = fixture.tokens[__VU - 1];
  const key = uuid();
  const body = JSON.stringify({ items: [{ productId: fixture.productId, size: fixture.size, qty: 1 }], address: ADDRESS });
  const params = { headers: { ...bearer(token), 'Idempotency-Key': key }, tags: { name: 'POST /orders' } };
  const res = http.post(`${API}/orders`, body, params);

  if (res.status === 409) {
    soldOut.add(1);
    return;
  }
  if (!check(res, { 'order placed': r => r.status === 201 })) {
    unexpected.add(1);
    return;
  }
  placed.add(1);
  const orderId = res.json('_id');

  // A client retry with the same key must return the same order, not a second one.
  if (__VU % 5 === 0) {
    const replay = http.post(`${API}/orders`, body, { ...params, tags: { name: 'POST /orders (replay)' } });
    if (replay.status !== 201 || replay.json('_id') !== orderId) replayMismatch.add(1);
  }

  const pay = http.post(`${API}/payments/demo-confirm`, JSON.stringify({ orderId }), {
    headers: { ...bearer(token), 'Idempotency-Key': uuid() },
    tags: { name: 'POST /payments/demo-confirm' },
  });
  if (check(pay, { 'payment confirmed': r => r.status === 200 && r.json('order.status') === 'paid' })) paid.add(1);
  else unexpected.add(1);
}
