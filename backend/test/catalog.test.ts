import { describe, expect, it } from 'vitest';
import { createProduct, createUser } from './helpers/factories';
import { API, bearer, useTestApp } from './helpers/app';

const t = useTestApp();

async function seedCatalog() {
  await createProduct({ title: 'Oxford Shirt', category: 'Men', price: 249_900, featured: true, rating: 4.5 });
  await createProduct({ title: 'Linen Blazer', category: 'Men', price: 799_900, rating: 4.1, sizes: [{ size: 'M', stock: 0 }, { size: 'L', stock: 3 }] });
  await createProduct({ title: 'Silk Dress', category: 'Women', price: 649_900, featured: true, rating: 4.9 });
  await createProduct({ title: 'Canvas Sneakers', category: 'Footwear', price: 299_900, rating: 3.8, sizes: [{ size: 'UK 8', stock: 4 }] });
}

describe('catalog', () => {
  it('lists products with pagination metadata', async () => {
    await seedCatalog();
    const res = await t.http().get(`${API}/products?limit=3`).expect(200);
    expect(res.body.items).toHaveLength(3);
    expect(res.body).toMatchObject({ total: 4, page: 1, pages: 2 });
  });

  it('filters by category, featured flag and price range', async () => {
    await seedCatalog();
    const men = await t.http().get(`${API}/products?category=Men`).expect(200);
    expect(men.body.items.map((p: { title: string }) => p.title).sort()).toEqual(['Linen Blazer', 'Oxford Shirt']);

    const featured = await t.http().get(`${API}/products?featured=true`).expect(200);
    expect(featured.body.total).toBe(2);

    const range = await t.http().get(`${API}/products?minPrice=250000&maxPrice=700000`).expect(200);
    expect(range.body.items.map((p: { title: string }) => p.title).sort()).toEqual(['Canvas Sneakers', 'Silk Dress']);
  });

  it('only matches sizes that are in stock', async () => {
    await seedCatalog();
    const res = await t.http().get(`${API}/products?size=M`).expect(200);
    expect(res.body.items.map((p: { title: string }) => p.title).sort()).toEqual(['Oxford Shirt', 'Silk Dress']);
  });

  it('sorts by price and searches text', async () => {
    await seedCatalog();
    const asc = await t.http().get(`${API}/products?sort=price-asc`).expect(200);
    expect(asc.body.items.map((p: { price: number }) => p.price)).toEqual([249_900, 299_900, 649_900, 799_900]);

    const search = await t.http().get(`${API}/products?q=blazer`).expect(200);
    expect(search.body.items).toHaveLength(1);
    expect(search.body.items[0].title).toBe('Linen Blazer');
  });

  it('returns categories with counts and products by slug', async () => {
    await seedCatalog();
    const cats = await t.http().get(`${API}/products/categories`).expect(200);
    expect(cats.body).toEqual([
      { name: 'Footwear', count: 1 },
      { name: 'Men', count: 2 },
      { name: 'Women', count: 1 },
    ]);
    const product = await t.http().get(`${API}/products/silk-dress`).expect(200);
    expect(product.body.title).toBe('Silk Dress');
    await t.http().get(`${API}/products/missing`).expect(404);
  });

  it('restricts product management to admins', async () => {
    const customer = await createUser();
    const admin = await createUser({ role: 'admin' });
    const body = { title: 'New Tee', category: 'Men', price: 99_900, images: ['https://example.com/a.jpg'], sizes: [{ size: 'M', stock: 5 }] };

    await t.http().post(`${API}/products`).send(body).expect(401);
    await t.http().post(`${API}/products`).set(bearer(customer.token)).send(body).expect(403);
    const created = await t.http().post(`${API}/products`).set(bearer(admin.token)).send(body).expect(201);
    expect(created.body.slug).toBe('new-tee');
    await t.http().post(`${API}/products`).set(bearer(admin.token)).send(body).expect(409);

    const invalid = await t.http().post(`${API}/products`).set(bearer(admin.token)).send({ title: 'X' }).expect(400);
    expect(invalid.body.error).toBe('Validation failed');
    expect(invalid.body.details.length).toBeGreaterThan(0);
  });
});
