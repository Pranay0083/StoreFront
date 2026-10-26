import http from 'k6/http';
import crypto from 'k6/crypto';
import { check } from 'k6';
import exec from 'k6/execution';
import { Counter } from 'k6/metrics';
import { API } from '../lib/common.js';

// Razorpay retries deliveries; this replays every payment.captured event many times, concurrently.
// Run `fixtures.mjs webhooks` first.
const fixture = JSON.parse(open('../.data/webhooks.json'));
const SECRET = __ENV.WEBHOOK_SECRET || 'loadtest-webhook-secret';
const RATE = Number(__ENV.RATE || 150);
const DURATION = __ENV.DURATION || '20s';

const accepted = new Counter('webhook_accepted');
const duplicates = new Counter('webhook_duplicate_ignored');
const rejected = new Counter('webhook_rejected');

export const options = {
  scenarios: {
    burst: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
  },
  thresholds: {
    webhook_accepted: [`count==${fixture.orders.length}`],
    webhook_rejected: ['count==0'],
    'http_req_duration{name:POST /payments/webhook}': ['p(95)<150', 'p(99)<400'],
  },
};

export default function () {
  const n = fixture.orders.length;
  const i = exec.scenario.iterationInTest % n;
  const order = fixture.orders[i];
  const body = JSON.stringify({
    event: 'payment.captured',
    payload: {
      payment: { entity: { id: `pay_lt${fixture.run}${i}`, order_id: order.gatewayOrderId, amount: 159_800, status: 'captured' } },
    },
  });
  const request = {
    method: 'POST',
    url: `${API}/payments/webhook`,
    body,
    params: {
      headers: {
        'Content-Type': 'application/json',
        'X-Razorpay-Signature': crypto.hmac('sha256', SECRET, body, 'hex'),
        'X-Razorpay-Event-Id': `evt_lt${fixture.run}${i}`,
      },
      tags: { name: 'POST /payments/webhook' },
    },
  };
  // Two identical deliveries in flight at once, on top of the replays across iterations.
  for (const res of http.batch([request, request])) {
    const status = res.status === 200 ? res.json('status') : null;
    if (status === 'accepted' || status === 'processed') accepted.add(1);
    else if (status === 'duplicate_ignored') duplicates.add(1);
    else rejected.add(1);
    check(res, { 'webhook 200': r => r.status === 200 });
  }
}
