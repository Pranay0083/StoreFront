import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { ProductModel } from '../src/modules/catalog/product.model';
import { createProduct, createUser } from './helpers/factories';
import { API, bearer, useTestApp } from './helpers/app';

const t = useTestApp();

/** Inserted straight into the collection so the test does not depend on the checkout flow. */
async function orderFor(userId: string, productId: string, status = 'delivered') {
  await mongoose.connection.db!.collection('orders').insertOne({
    orderNumber: `SF-${randomUUID().slice(0, 8)}`,
    userId: new mongoose.Types.ObjectId(userId),
    status,
    items: [{ productId: new mongoose.Types.ObjectId(productId), title: 'x', price: 100, size: 'M', qty: 1 }],
  });
}

const review = (token: string, productId: string, rating: number, comment?: string) =>
  t
    .http()
    .post(`${API}/reviews`)
    .set(bearer(token))
    .send({ productId, rating, ...(comment && { comment }) });

describe('reviews', () => {
  it('accepts reviews from customers who received the product and keeps the average incrementally', async () => {
    const product = await createProduct({ title: 'Wool Coat' });
    const id = String(product._id);
    const a = await createUser({ name: 'Aarav' });
    const b = await createUser({ name: 'Meera' });
    await orderFor(a.id, id);
    await orderFor(b.id, id);

    expect((await review(a.token, id, 5, 'Great').expect(201)).body).toEqual({
      ok: true,
      rating: 5,
      numReviews: 1,
      verifiedPurchase: true,
    });
    expect((await review(b.token, id, 4).expect(201)).body).toMatchObject({ rating: 4.5, numReviews: 2 });
    expect((await review(a.token, id, 3).expect(201)).body).toMatchObject({ rating: 3.5, numReviews: 2 });

    const list = await t.http().get(`${API}/reviews/product/${id}`).expect(200);
    expect(list.body.map((r: { userName: string }) => r.userName).sort()).toEqual(['Aarav', 'Meera']);
    expect(list.body.every((r: { verifiedPurchase: boolean }) => r.verifiedPurchase)).toBe(true);
    const p = await t.http().get(`${API}/products/wool-coat`).expect(200);
    expect(p.body).toMatchObject({ rating: 3.5, numReviews: 2 });
  });

  it('rejects customers who have not received the product', async () => {
    const product = await createProduct();
    const id = String(product._id);
    const browser = await createUser();
    const waiting = await createUser();
    await orderFor(waiting.id, id, 'shipped');
    const elsewhere = await createUser();
    await orderFor(elsewhere.id, String((await createProduct())._id));

    for (const user of [browser, waiting, elsewhere]) {
      const res = await review(user.token, id, 5).expect(403);
      expect(res.body.error).toMatch(/received this product/);
    }
  });

  it('stays consistent under concurrent reviews', async () => {
    const product = await createProduct();
    const id = String(product._id);
    const users = await Promise.all(Array.from({ length: 8 }, () => createUser()));
    await Promise.all(users.map(u => orderFor(u.id, id)));

    await Promise.all(users.map((u, i) => review(u.token, id, (i % 5) + 1).expect(201)));

    const stored = await ProductModel.findById(id).lean();
    expect(stored).toMatchObject({ numReviews: 8, ratingSum: 1 + 2 + 3 + 4 + 5 + 1 + 2 + 3, rating: 2.6 });
  });

  it('continues from legacy aggregates that predate ratingSum', async () => {
    const product = await createProduct({ rating: 4, numReviews: 2 });
    const id = String(product._id);
    const user = await createUser();
    await orderFor(user.id, id);
    expect((await review(user.token, id, 1).expect(201)).body).toMatchObject({ rating: 3, numReviews: 3 });
  });

  it('requires authentication and an existing product', async () => {
    const user = await createUser();
    await t.http().post(`${API}/reviews`).send({ productId: 'x', rating: 5 }).expect(401);
    await review(user.token, '64b7f0c2a1b2c3d4e5f60718', 5).expect(404);
  });
});
