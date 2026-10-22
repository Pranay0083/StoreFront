import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADDRESS, createProduct, createUser } from './helpers/factories';
import { API, bearer, useTestApp } from './helpers/app';
import { waitFor } from './helpers/wait';

const t = useTestApp();
let server: Server;
let base: string;

beforeAll(() => {
  server = t.app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${API}`;
});

afterAll(async () => {
  t.container.services.realtime.close();
  await new Promise(r => server.close(r));
});

async function openStream(token: string, channels: string) {
  const controller = new AbortController();
  const res = await fetch(`${base}/realtime/stream?channels=${channels}`, { headers: bearer(token), signal: controller.signal });
  const received: string[] = [];
  if (res.ok && res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    void (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          received.push(decoder.decode(value));
        }
      } catch {
        // aborted
      }
    })();
  }
  const events = () =>
    received
      .join('')
      .split('\n\n')
      .filter(block => block.startsWith('id:'))
      .map(block => ({ event: /event: (.+)/.exec(block)![1], data: JSON.parse(/data: (.+)/.exec(block)![1]) }));
  return { res, events, close: () => controller.abort() };
}

describe('realtime streams', () => {
  it('requires authentication and the permission for each requested channel', async () => {
    const anon = await fetch(`${base}/realtime/stream`);
    expect(anon.status).toBe(401);
    const customer = await createUser();
    const forbidden = await fetch(`${base}/realtime/stream?channels=orders,admin-orders`, { headers: bearer(customer.token) });
    expect(forbidden.status).toBe(403);
    const unknown = await fetch(`${base}/realtime/stream?channels=everything`, { headers: bearer(customer.token) });
    expect(unknown.status).toBe(400);
  });

  it("streams a customer's own order updates and the admin order queue", async () => {
    const buyer = await createUser();
    const stranger = await createUser();
    const fulfillment = await createUser({ role: 'fulfillment' });
    const mine = await openStream(buyer.token, 'orders');
    const theirs = await openStream(stranger.token, 'orders');
    const queue = await openStream(fulfillment.token, 'admin-orders');
    expect(mine.res.headers.get('content-type')).toMatch(/text\/event-stream/);

    const product = await createProduct();
    const order = (
      await t
        .http()
        .post(`${API}/orders`)
        .set(bearer(buyer.token))
        .send({ address: ADDRESS, items: [{ productId: String(product._id), size: 'M', qty: 1 }] })
        .expect(201)
    ).body;
    await t.http().post(`${API}/payments/create`).set(bearer(buyer.token)).send({ orderId: order._id }).expect(200);
    await t.http().post(`${API}/payments/demo-confirm`).set(bearer(buyer.token)).send({ orderId: order._id }).expect(200);
    await t.settle();

    await waitFor(() => mine.events().some(e => e.data.status === 'paid'));
    expect(mine.events().map(e => e.data.status)).toEqual(['created', 'paid']);
    expect(mine.events()[1].data).toMatchObject({ orderId: order._id, orderNumber: order.orderNumber });
    await waitFor(() => queue.events().some(e => e.event === 'order.paid'));
    expect(queue.events().map(e => e.event)).toEqual(expect.arrayContaining(['order.placed', 'order.paid', 'order.status']));
    expect(theirs.events()).toHaveLength(0);

    for (const s of [mine, theirs, queue]) s.close();
  });
});
