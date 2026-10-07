import { describe, expect, it } from 'vitest';
import { CartModel } from '../src/modules/cart/cart.model';
import { ProductModel } from '../src/modules/catalog/product.model';
import { createProduct, createUser } from './helpers/factories';
import { API, bearer, useTestApp } from './helpers/app';

const t = useTestApp();

describe('cart', () => {
  it('persists only line references and hydrates catalog data on read', async () => {
    const user = await createUser();
    const shirt = await createProduct({ title: 'Oxford Shirt', price: 249_900 });
    expect((await t.http().get(`${API}/cart`).set(bearer(user.token)).expect(200)).body).toEqual({ items: [] });

    const put = await t
      .http()
      .put(`${API}/cart`)
      .set(bearer(user.token))
      .send({ items: [{ productId: String(shirt._id), size: 'M', qty: 2, title: 'Free shirt', price: 1 }] })
      .expect(200);
    expect(put.body.items).toEqual([
      {
        productId: String(shirt._id),
        size: 'M',
        qty: 2,
        title: 'Oxford Shirt',
        image: shirt.images[0],
        price: 249_900,
        slug: 'oxford-shirt',
        stock: 10,
        available: true,
      },
    ]);

    const stored = await CartModel.findOne({ userId: user.id }).lean();
    expect(stored!.items).toEqual([{ productId: shirt._id, size: 'M', qty: 2 }]);

    await ProductModel.updateOne({ _id: shirt._id }, { $set: { price: 199_900 } });
    const res = await t.http().get(`${API}/cart`).set(bearer(user.token)).expect(200);
    expect(res.body.items[0].price).toBe(199_900);

    const other = await createUser();
    expect((await t.http().get(`${API}/cart`).set(bearer(other.token)).expect(200)).body.items).toHaveLength(0);
  });

  it('merges duplicate lines, flags low stock and drops deleted products', async () => {
    const user = await createUser();
    const coat = await createProduct({ title: 'Coat' });
    const gone = await createProduct({ title: 'Gone' });
    await ProductModel.deleteOne({ _id: gone._id });

    const res = await t
      .http()
      .put(`${API}/cart`)
      .set(bearer(user.token))
      .send({
        items: [
          { productId: String(coat._id), size: 'L', qty: 1 },
          { productId: String(coat._id), size: 'L', qty: 2 },
          { productId: String(gone._id), size: 'M', qty: 1 },
        ],
      })
      .expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ size: 'L', qty: 3, stock: 2, available: false });
    expect((await CartModel.findOne({ userId: user.id }).lean())!.items).toHaveLength(1);
  });

  it('prices a guest cart without storing it', async () => {
    const product = await createProduct({ title: 'Scarf', price: 99_900 });
    const res = await t
      .http()
      .post(`${API}/cart/hydrate`)
      .send({ items: [{ productId: String(product._id), size: 'M', qty: 1 }] })
      .expect(200);
    expect(res.body.items[0]).toMatchObject({ title: 'Scarf', price: 99_900 });
    expect(await CartModel.countDocuments()).toBe(0);
  });

  it('validates cart payloads and requires auth for the stored cart', async () => {
    const user = await createUser();
    await t.http().get(`${API}/cart`).expect(401);
    await t
      .http()
      .put(`${API}/cart`)
      .set(bearer(user.token))
      .send({ items: [{ productId: '64b7f0c2a1b2c3d4e5f60718', size: 'M', qty: 0 }] })
      .expect(400);
    await t
      .http()
      .put(`${API}/cart`)
      .set(bearer(user.token))
      .send({ items: [{ productId: 'not-an-id', size: 'M', qty: 1 }] })
      .expect(400);
  });
});
