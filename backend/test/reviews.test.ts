import { describe, expect, it } from 'vitest';
import { createProduct, createUser } from './helpers/factories';
import { API, bearer, useTestApp } from './helpers/app';

const t = useTestApp();

describe('reviews', () => {
  it('upserts one review per user and recomputes the product rating', async () => {
    const product = await createProduct({ title: 'Wool Coat' });
    const a = await createUser({ name: 'Aarav' });
    const b = await createUser({ name: 'Meera' });

    await t.http().post(`${API}/reviews`).set(bearer(a.token)).send({ productId: String(product._id), rating: 5, comment: 'Great' }).expect(201);
    const second = await t.http().post(`${API}/reviews`).set(bearer(b.token)).send({ productId: String(product._id), rating: 4 }).expect(201);
    expect(second.body).toEqual({ ok: true, rating: 4.5, numReviews: 2 });

    const updated = await t.http().post(`${API}/reviews`).set(bearer(a.token)).send({ productId: String(product._id), rating: 3 }).expect(201);
    expect(updated.body).toMatchObject({ rating: 3.5, numReviews: 2 });

    const list = await t.http().get(`${API}/reviews/product/${product._id}`).expect(200);
    expect(list.body.map((r: { userName: string }) => r.userName).sort()).toEqual(['Aarav', 'Meera']);
    const p = await t.http().get(`${API}/products/wool-coat`).expect(200);
    expect(p.body).toMatchObject({ rating: 3.5, numReviews: 2 });
  });

  it('requires authentication and an existing product', async () => {
    const user = await createUser();
    await t.http().post(`${API}/reviews`).send({ productId: 'x', rating: 5 }).expect(401);
    await t.http().post(`${API}/reviews`).set(bearer(user.token)).send({ productId: '64b7f0c2a1b2c3d4e5f60718', rating: 5 }).expect(404);
  });
});
