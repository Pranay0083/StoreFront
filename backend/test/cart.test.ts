import { describe, expect, it } from 'vitest';
import { createUser } from './helpers/factories';
import { API, bearer, useTestApp } from './helpers/app';

const t = useTestApp();

const item = {
  productId: '64b7f0c2a1b2c3d4e5f60718',
  title: 'Oxford Shirt',
  image: 'https://x/y.jpg',
  price: 249_900,
  size: 'M',
  qty: 2,
  slug: 'oxford-shirt',
};

describe('cart', () => {
  it('stores and returns the server-side cart per user', async () => {
    const user = await createUser();
    expect((await t.http().get(`${API}/cart`).set(bearer(user.token)).expect(200)).body).toEqual({ items: [] });

    await t
      .http()
      .put(`${API}/cart`)
      .set(bearer(user.token))
      .send({ items: [item] })
      .expect(200);
    const res = await t.http().get(`${API}/cart`).set(bearer(user.token)).expect(200);
    expect(res.body.items).toEqual([expect.objectContaining({ ...item })]);

    const other = await createUser();
    expect((await t.http().get(`${API}/cart`).set(bearer(other.token)).expect(200)).body.items).toHaveLength(0);
  });

  it('validates cart payloads and requires auth', async () => {
    const user = await createUser();
    await t.http().get(`${API}/cart`).expect(401);
    await t
      .http()
      .put(`${API}/cart`)
      .set(bearer(user.token))
      .send({ items: [{ ...item, qty: 0 }] })
      .expect(400);
  });
});
