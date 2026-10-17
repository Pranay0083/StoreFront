import mongoose from 'mongoose';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { MongoDeadLetterStore } from '../src/core/queue/dead-letter.store';
import { MemoryJobQueue } from '../src/core/queue/memory-job-queue';
import { ProductModel as Product } from '../src/modules/catalog/product.model';
import { recordOpeningBalances } from '../src/modules/inventory/opening-balances';
import { OrderModel as Order } from '../src/modules/orders/order.model';
import { EXPIRE_RESERVATION_JOB, QueuedReservationScheduler } from '../src/modules/orders/reservation-jobs';
import { EventBus } from '../src/core/events/event-bus';
import { ADDRESS, createProduct, createUser } from './helpers/factories';
import { API, bearer, useTestApp } from './helpers/app';

const t = useTestApp();
const TTL_MS = 15 * 60_000;

async function placeOrder() {
  const buyer = await createUser();
  const product = await createProduct();
  await recordOpeningBalances(mongoose.connection.db!);
  const res = await t
    .http()
    .post(`${API}/orders`)
    .set(bearer(buyer.token))
    .send({ address: ADDRESS, items: [{ productId: String(product._id), size: 'M', qty: 4 }] })
    .expect(201);
  return { order: res.body as { _id: string }, product };
}

function scheduler() {
  let now = Date.now();
  const jobs = new MemoryJobQueue(new MongoDeadLetterStore(), pino({ level: 'silent' }), { clock: () => now });
  const s = new QueuedReservationScheduler(
    t.container.services.orders,
    t.container.repositories.orders,
    jobs,
    pino({ level: 'silent' }),
    { ttlMs: TTL_MS, sweepIntervalMs: 60_000 },
    () => now,
  );
  s.register(new EventBus());
  return { s, jobs, advance: (ms: number) => (now += ms) };
}

describe('reservation expiry jobs', () => {
  it('schedules a delayed expiry job for every placed order', async () => {
    const { order } = await placeOrder();
    await t.container.services.relay.drain();
    const maintenance = (await t.container.jobs.counts()).find(c => c.queue === 'maintenance')!;
    expect(maintenance.delayed).toBe(1);
    expect(t.container.jobs.definition(EXPIRE_RESERVATION_JOB)).toBeDefined();
    expect(order._id).toBeDefined();
  });

  it('expires the reservation once its window has passed and returns the stock', async () => {
    const { order, product } = await placeOrder();
    const { s, jobs, advance } = scheduler();

    await jobs.enqueue(EXPIRE_RESERVATION_JOB, { orderId: order._id });
    await jobs.drain();
    expect((await Order.findById(order._id).lean())!.status).toBe('created');
    expect((await jobs.counts()).find(c => c.queue === 'maintenance')!.delayed).toBe(1);

    advance(TTL_MS + 2_000);
    await jobs.drain();
    expect((await Order.findById(order._id).lean())!.status).toBe('cancelled');
    expect((await Product.findById(product._id).lean())!.sizes.find(x => x.size === 'M')!.stock).toBe(10);

    await s.expire(order._id);
    expect(await t.container.services.inventory.reconcile()).toMatchObject({ ok: true });
  });

  it('leaves paid orders alone when their expiry job fires late', async () => {
    const buyer = await createUser();
    const product = await createProduct();
    await recordOpeningBalances(mongoose.connection.db!);
    const { body: order } = await t
      .http()
      .post(`${API}/orders`)
      .set(bearer(buyer.token))
      .send({ address: ADDRESS, items: [{ productId: String(product._id), size: 'M', qty: 1 }] })
      .expect(201);
    await t.http().post(`${API}/payments/demo-confirm`).set(bearer(buyer.token)).send({ orderId: order._id }).expect(200);

    const { s, advance } = scheduler();
    advance(TTL_MS * 2);
    await s.expire(order._id);
    expect((await Order.findById(order._id).lean())!.status).toBe('paid');
  });
});
