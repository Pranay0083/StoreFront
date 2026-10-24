import { describe, expect, it, vi } from 'vitest';
import { ProductModel } from '../src/modules/catalog/product.model';
import { OrderModel } from '../src/modules/orders/order.model';
import { createProduct, createUser } from './helpers/factories';
import { API, bearer, useTestApp } from './helpers/app';

const t = useTestApp();

async function paidOrder(userId: unknown, products: Array<{ _id: unknown; title: string; slug: string; price: number }>, n: number) {
  for (let i = 0; i < n; i++) {
    const total = products.reduce((s, p) => s + p.price, 0);
    await OrderModel.collection.insertOne({
      orderNumber: `SF-REC-${Math.random().toString(36).slice(2)}`,
      userId,
      items: products.map(p => ({ productId: p._id, title: p.title, slug: p.slug, price: p.price, size: 'M', qty: 1, image: '' })),
      subtotal: total,
      shipping: 0,
      discount: 0,
      total,
      status: 'paid',
      paidAt: new Date(),
      statusHistory: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}

describe('recommendations', () => {
  it('serves frequently-bought-together products after a rebuild, ranked by lift', async () => {
    const buyer = await createUser();
    const shirt = await createProduct({ title: 'Oxford Shirt Rec' });
    const jeans = await createProduct({ title: 'Selvedge Jeans Rec' });
    const belt = await createProduct({ title: 'Leather Belt Rec', category: 'Accessories' });
    const lonely = await createProduct({ title: 'Lonely Tee Rec' });
    await paidOrder(buyer.user._id, [shirt, jeans], 3);
    await paidOrder(buyer.user._id, [shirt, belt], 2);
    await paidOrder(buyer.user._id, [lonely], 1);

    const stats = await t.container.services.recommendations.rebuild();
    expect(stats).toMatchObject({ orders: 6 });

    const res = await t.http().get(`${API}/products/${shirt._id}/recommendations`).expect(200);
    expect(res.body.source).toBe('frequently-bought-together');
    expect(res.body.items.map((p: { slug: string }) => p.slug)).toEqual([jeans.slug, belt.slug]);
    expect(res.body.items[0].score).toMatchObject({ pairCount: 3 });
  });

  it('falls back to in-stock same-category bestsellers when there is no signal', async () => {
    const buyer = await createUser();
    const target = await createProduct({ title: 'Target Rec', category: 'Women' });
    const popular = await createProduct({ title: 'Popular Rec', category: 'Women' });
    const quiet = await createProduct({ title: 'Quiet Rec', category: 'Women' });
    await createProduct({ title: 'Sold Out Rec', category: 'Women', sizes: [{ size: 'M', stock: 0 }] });
    await createProduct({ title: 'Other Category Rec', category: 'Men' });
    await paidOrder(buyer.user._id, [popular], 2);

    const res = await t.http().get(`${API}/products/${target._id}/recommendations`).query({ limit: 5 }).expect(200);
    expect(res.body.source).toBe('category-bestsellers');
    expect(res.body.items.map((p: { slug: string }) => p.slug)).toEqual([popular.slug, quiet.slug]);
  });

  it('ranks a large category once and shares the bounded pool across its products', async () => {
    const products = [];
    for (let i = 0; i < 40; i++) products.push(await createProduct({ title: `Pool Rec ${i}`, category: 'Footwear' }));
    for (const [i, p] of products.entries()) await ProductModel.updateOne({ _id: p._id }, { $set: { rating: (i * 7) % 50 } });
    const aggregate = vi.spyOn(OrderModel, 'aggregate');
    try {
      const first = await t.http().get(`${API}/products/${products[0]._id}/recommendations`).query({ limit: 12 }).expect(200);
      const second = await t.http().get(`${API}/products/${products[1]._id}/recommendations`).query({ limit: 12 }).expect(200);
      expect(aggregate).toHaveBeenCalledTimes(1);

      const ratings = (await ProductModel.find({ category: 'Footwear' }).lean()).map(p => [String(p._id), p.rating] as const);
      const expected = ratings.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1)).map(([id]) => id);
      expect(first.body.items.map((p: { _id: string }) => p._id)).toEqual(
        expected.filter(id => id !== String(products[0]._id)).slice(0, 12),
      );
      expect(second.body.items).toHaveLength(12);
      expect(second.body.items.some((p: { _id: string }) => p._id === String(products[1]._id))).toBe(false);
    } finally {
      aggregate.mockRestore();
    }
  });

  it('validates ids, 404s unknown products and gates manual rebuilds', async () => {
    await t.http().get(`${API}/products/not-an-id/recommendations`).expect(400);
    await t.http().get(`${API}/products/64b7f0c2a1b2c3d4e5f60718/recommendations`).expect(404);
    const customer = await createUser();
    await t.http().post(`${API}/admin/recommendations/rebuild`).set(bearer(customer.token)).expect(403);
    const manager = await createUser({ role: 'catalog_manager' });
    await t.http().post(`${API}/admin/recommendations/rebuild`).set(bearer(manager.token)).expect(202);
  });
});
