import express from 'express';
import supertest from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../src/core/http/error-handler';
import { idempotent } from '../src/core/http/idempotency/idempotency.middleware';
import { IdempotencyModel } from '../src/core/http/idempotency/idempotency.model';
import { IdempotencyStore } from '../src/core/http/idempotency/idempotency.store';
import { ProductModel as Product } from '../src/modules/catalog/product.model';
import { OrderModel as Order } from '../src/modules/orders/order.model';
import { ADDRESS, createProduct, createUser } from './helpers/factories';
import { API, bearer, useTestApp } from './helpers/app';

const t = useTestApp();

async function setup() {
  const buyer = await createUser();
  const product = await createProduct();
  const body = { address: ADDRESS, items: [{ productId: String(product._id), size: 'M', qty: 2 }] };
  const post = (key: string | undefined, payload: object = body, token = buyer.token) => {
    const req = t.http().post(`${API}/orders`).set(bearer(token));
    return (key ? req.set('Idempotency-Key', key) : req).send(payload);
  };
  return { buyer, product, body, post };
}

describe('Idempotency-Key on checkout', () => {
  it('replays the original response instead of placing a second order', async () => {
    const { product, post } = await setup();
    const first = await post('checkout-1').expect(201);
    const retry = await post('checkout-1').expect(201);

    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(retry.body).toEqual(first.body);
    expect(await Order.countDocuments()).toBe(1);
    expect((await Product.findById(product._id).lean())!.sizes[0].stock).toBe(8);
  });

  it('treats JSON key order as the same request but a different body as misuse', async () => {
    const { body, post } = await setup();
    await post('checkout-2').expect(201);
    await post('checkout-2', { items: body.items, address: body.address }).expect(201);
    const misuse = await post('checkout-2', { ...body, items: [{ ...body.items[0], qty: 1 }] }).expect(422);
    expect(misuse.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(await Order.countDocuments()).toBe(1);
  });

  it('places exactly one order when duplicates race', async () => {
    const { post } = await setup();
    const results = await Promise.all(Array.from({ length: 6 }, () => post('checkout-race')));
    const created = results.filter(r => r.status === 201);
    expect(results.every(r => r.status === 201 || r.status === 409)).toBe(true);
    expect(new Set(created.map(r => r.body._id)).size).toBe(1);
    expect(await Order.countDocuments()).toBe(1);
  });

  it('answers 409 while the original request is still in flight', async () => {
    const { post } = await setup();
    await post('in-flight').expect(201);
    await IdempotencyModel.updateMany({}, { $set: { status: 'in_progress', lockedAt: new Date() }, $unset: { responseBody: 1 } });
    const res = await post('in-flight').expect(409);
    expect(res.body.error).toMatch(/still being processed/);
  });

  it('scopes keys per user and works without a key', async () => {
    const { post } = await setup();
    const other = await createUser();
    await post('shared-key').expect(201);
    await post('shared-key', undefined, other.token).expect(201);
    await post(undefined).expect(201);
    await post(undefined).expect(201);
    expect(await Order.countDocuments()).toBe(4);
  });

  it('does not consume a key on validation errors', async () => {
    const { body, post } = await setup();
    await post('validated', { ...body, items: [] }).expect(400);
    await post('validated').expect(201);
  });
});

describe('idempotency middleware', () => {
  function app(store: IdempotencyStore, handler: express.RequestHandler) {
    const a = express();
    a.use(express.json());
    a.post('/thing', idempotent(store), handler);
    a.use(errorHandler);
    return supertest(a);
  }

  it('releases the key after a server error so the client can retry', async () => {
    let calls = 0;
    const http = app(new IdempotencyStore(), (_req, res) => {
      calls++;
      if (calls === 1) res.status(500).json({ error: 'boom' });
      else res.status(201).json({ ok: true, calls });
    });
    await http.post('/thing').set('Idempotency-Key', 'k').send({ a: 1 }).expect(500);
    await http.post('/thing').set('Idempotency-Key', 'k').send({ a: 1 }).expect(201, { ok: true, calls: 2 });
    await http.post('/thing').set('Idempotency-Key', 'k').send({ a: 1 }).expect(201, { ok: true, calls: 2 });
    expect(calls).toBe(2);
  });

  it('stores client errors and lets a stale in-flight lock be taken over', async () => {
    let calls = 0;
    const http = app(new IdempotencyStore(0), (_req, res) => {
      calls++;
      res.status(404).json({ error: 'nope' });
    });
    await http.post('/thing').set('Idempotency-Key', 'k2').send({}).expect(404);
    await http.post('/thing').set('Idempotency-Key', 'k2').send({}).expect(404);
    expect(calls).toBe(1);

    await IdempotencyModel.updateMany({}, { $set: { status: 'in_progress', lockedAt: new Date(Date.now() - 1_000) } });
    await http.post('/thing').set('Idempotency-Key', 'k2').send({}).expect(404);
    expect(calls).toBe(2);
  });

  it('rejects oversized keys', async () => {
    const http = app(new IdempotencyStore(), (_req, res) => void res.json({}));
    await http.post('/thing').set('Idempotency-Key', 'x'.repeat(256)).send({}).expect(400);
  });
});
