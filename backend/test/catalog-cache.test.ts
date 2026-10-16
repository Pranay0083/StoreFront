import mongoose from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import { recordOpeningBalances } from '../src/modules/inventory/opening-balances';
import { ADDRESS, createProduct, createUser } from './helpers/factories';
import { API, bearer, useTestApp } from './helpers/app';

const t = useTestApp();

describe('catalog read cache', () => {
  it('serves repeated reads from cache, per distinct query', async () => {
    const product = await createProduct({ title: 'Cached Tee' });
    const bySlug = vi.spyOn(t.container.repositories.products, 'findBySlug');
    const find = vi.spyOn(t.container.repositories.products, 'find');

    for (let i = 0; i < 3; i++) await t.http().get(`${API}/products/${product.slug}`).expect(200);
    expect(bySlug).toHaveBeenCalledTimes(1);

    await t.http().get(`${API}/products?category=Men&sort=price-asc`).expect(200);
    await t.http().get(`${API}/products?sort=price-asc&category=Men`).expect(200);
    await t.http().get(`${API}/products?category=Women`).expect(200);
    expect(find).toHaveBeenCalledTimes(2);

    bySlug.mockRestore();
    find.mockRestore();
  });

  it('invalidates on admin writes so price changes are visible immediately', async () => {
    const admin = await createUser({ role: 'admin' });
    const product = await createProduct({ title: 'Repriced Tee', price: 100_000 });
    expect((await t.http().get(`${API}/products/${product.slug}`)).body.price).toBe(100_000);

    await t.http().put(`${API}/products/${product._id}`).set(bearer(admin.token)).send({ price: 80_000 }).expect(200);
    expect((await t.http().get(`${API}/products/${product.slug}`)).body.price).toBe(80_000);
  });

  it('invalidates when checkout moves stock, via the OrderPlaced event', async () => {
    const buyer = await createUser();
    const product = await createProduct({ title: 'Last Units Tee' });
    await recordOpeningBalances(mongoose.connection.db!);
    const stockM = async () =>
      (await t.http().get(`${API}/products/${product.slug}`)).body.sizes.find((s: { size: string }) => s.size === 'M').stock;
    expect(await stockM()).toBe(10);

    await t
      .http()
      .post(`${API}/orders`)
      .set(bearer(buyer.token))
      .send({ address: ADDRESS, items: [{ productId: String(product._id), size: 'M', qty: 3 }] })
      .expect(201);
    expect(await stockM()).toBe(10);
    await t.settle();
    expect(await stockM()).toBe(7);
  });

  it('does not cache misses', async () => {
    await t.http().get(`${API}/products/not-yet`).expect(404);
    await createProduct({ title: 'Not Yet' });
    await t.http().get(`${API}/products/not-yet`).expect(200);
  });
});
