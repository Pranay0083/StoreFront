import { describe, expect, it } from 'vitest';
import { createProduct } from './helpers/factories';
import { API, useTestApp } from './helpers/app';

const t = useTestApp();

async function seed() {
  const prices = [50_000, 50_000, 50_000, 120_000, 80_000, 80_000, 200_000];
  for (const [i, price] of prices.entries()) await createProduct({ title: `Paged ${i}`, price });
}

async function walk(sort: string, limit: number) {
  const ids: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const qs: string = `sort=${sort}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await t.http().get(`${API}/products?${qs}`).expect(200);
    ids.push(...res.body.items.map((p: { _id: string }) => p._id));
    expect(res.body.total).toBe(7);
    cursor = res.body.nextCursor;
    pages++;
  } while (cursor && pages < 10);
  return { ids, pages };
}

describe('cursor pagination', () => {
  it('visits every product exactly once in sort order, even across tied prices', async () => {
    await seed();
    for (const sort of ['price-asc', 'price-desc', 'newest', 'rating']) {
      const { ids, pages } = await walk(sort, 3);
      const all = (await t.http().get(`${API}/products?sort=${sort}&limit=48`)).body.items.map((p: { _id: string }) => p._id);
      expect(ids).toEqual(all);
      expect(new Set(ids).size).toBe(7);
      expect(pages).toBe(3);
    }
  });

  it('keeps page-number pagination working for existing clients', async () => {
    await seed();
    const page2 = await t.http().get(`${API}/products?sort=price-asc&limit=3&page=2`).expect(200);
    const viaCursor = await t
      .http()
      .get(
        `${API}/products?sort=price-asc&limit=3&cursor=${(await t.http().get(`${API}/products?sort=price-asc&limit=3`)).body.nextCursor}`,
      );
    expect(page2.body.items.map((p: { _id: string }) => p._id)).toEqual(viaCursor.body.items.map((p: { _id: string }) => p._id));
    expect(page2.body).toMatchObject({ page: 2, pages: 3 });
  });

  it('rejects malformed cursors and cursors issued for another sort', async () => {
    await seed();
    const { nextCursor } = (await t.http().get(`${API}/products?sort=newest&limit=2`)).body;
    await t.http().get(`${API}/products?sort=price-asc&cursor=${nextCursor}`).expect(400);
    await t.http().get(`${API}/products?cursor=garbage`).expect(400);
  });
});
