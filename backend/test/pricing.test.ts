import type { PriceBreakdown, PriceQuote } from '@storefront/contracts';
import { describe, expect, it } from 'vitest';
import { QuoteModel } from '../src/modules/pricing/quote.model';
import { API, bearer, useTestApp } from './helpers/app';
import { createProduct, createUser } from './helpers/factories';

const t = useTestApp();

async function admin() {
  return (await createUser({ role: 'admin' })).token;
}

async function createPromotion(token: string, body: Record<string, unknown>) {
  const res = await t
    .http()
    .post(`${API}/admin/promotions`)
    .set(bearer(token))
    .send({ status: 'active', ...body });
  expect(res.status).toBe(201);
  return res.body as { _id: string; version: number };
}

async function catalog() {
  const shirt = await createProduct({ title: 'Oxford Shirt', price: 249_900 });
  const jeans = await createProduct({ title: 'Denim Jeans', price: 459_900 });
  const belt = await createProduct({
    title: 'Leather Belt',
    price: 179_900,
    category: 'Accessories',
    sizes: [{ size: 'One Size', stock: 9 }],
  });
  const beanie = await createProduct({
    title: 'Wool Beanie',
    price: 129_900,
    category: 'Accessories',
    sizes: [{ size: 'One Size', stock: 9 }],
  });
  return { shirt, jeans, belt, beanie };
}

const item = (p: { _id: unknown }, size = 'M', qty = 1) => ({ productId: String(p._id), size, qty });

describe('POST /pricing/quote', () => {
  it('prices from catalog data, applies the best offers and persists a verifiable quote', async () => {
    const token = await admin();
    const { shirt, jeans } = await catalog();
    await createPromotion(token, {
      name: 'Weekend Uniform',
      action: {
        type: 'fixedBundle',
        components: [
          { selector: { slugs: [shirt.slug] }, qty: 1 },
          { selector: { slugs: [jeans.slug] }, qty: 1 },
        ],
        price: 599_900,
      },
    });
    await createPromotion(token, {
      name: 'Welcome 10',
      activation: 'code',
      code: 'WELCOME10',
      conditions: { type: 'minSubtotal', amount: 100_000 },
      action: { type: 'percentOff', percent: 10, maxDiscount: 50_000 },
    });

    const res = await t
      .http()
      .post(`${API}/pricing/quote`)
      .send({ items: [item(shirt), item(jeans)], codes: ['welcome10'] })
      .expect(200);
    const quote = res.body as PriceQuote;
    expect(quote.breakdown).toMatchObject({
      listSubtotal: 709_800,
      bundleDiscount: 109_900,
      codeDiscount: 50_000,
      shipping: 0,
      total: 549_900,
    });
    expect(quote.breakdown.applied.map(a => a.name)).toEqual(['Weekend Uniform', 'Welcome 10']);
    expect(quote.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(new Date(quote.expiresAt).getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);

    const pricing = t.container.services.pricing;
    const cart = { items: [item(jeans), item(shirt)], codes: ['WELCOME10'] };
    const verified = await pricing.verifyQuote(quote.quoteId, cart, {});
    expect(verified.total).toBe(549_900);
  });

  it('rejects verification when the cart, customer, prices or expiry no longer match', async () => {
    const { shirt } = await catalog();
    const pricing = t.container.services.pricing;
    const cart = { items: [item(shirt)] };
    const { quoteId } = await pricing.quote(cart, {});

    await expect(pricing.verifyQuote(quoteId, { items: [item(shirt, 'M', 2)] }, {})).rejects.toMatchObject({ status: 409 });
    await expect(pricing.verifyQuote(quoteId, cart, { userId: 'someone-else' })).rejects.toMatchObject({ status: 403 });

    await createPromotion(await admin(), { name: 'Flash 10', action: { type: 'percentOff', percent: 10 } });
    await expect(pricing.verifyQuote(quoteId, cart, {})).rejects.toMatchObject({ status: 409, code: 'PRICE_CHANGED' });

    await QuoteModel.updateOne({ _id: quoteId }, { expiresAt: new Date(Date.now() - 1000) });
    await expect(pricing.verifyQuote(quoteId, cart, {})).rejects.toMatchObject({ status: 410, code: 'QUOTE_EXPIRED' });
    await expect(pricing.verifyQuote('missing', cart, {})).rejects.toMatchObject({ status: 410 });
  });

  it('uses the signed-in customer for segment rules', async () => {
    const { shirt } = await catalog();
    await createPromotion(await admin(), {
      name: 'First order ships free',
      conditions: { type: 'customerSegment', segment: 'firstOrder' },
      action: { type: 'freeShipping' },
    });
    const customer = await createUser();
    const signedIn = await t
      .http()
      .post(`${API}/pricing/quote`)
      .set(bearer(customer.token))
      .send({ items: [item(shirt)] })
      .expect(200);
    expect(signedIn.body.breakdown).toMatchObject({ shipping: 9_900, shippingDiscount: 9_900 });
    const guest = await t
      .http()
      .post(`${API}/pricing/quote`)
      .send({ items: [item(shirt)] })
      .expect(200);
    expect(guest.body.breakdown.shippingDiscount).toBe(0);
  });

  it('suggests a catalog product that unlocks a buy-x-get-y offer', async () => {
    const { belt, beanie } = await catalog();
    await createPromotion(await admin(), {
      name: 'Buy 2 get 1 free',
      action: { type: 'buyXGetY', selector: { categories: ['Accessories'] }, buyQty: 2, getQty: 1, percentOff: 100 },
    });
    const res = await t
      .http()
      .post(`${API}/pricing/quote`)
      .send({ items: [item(belt, 'One Size', 2)] })
      .expect(200);
    const b = res.body.breakdown as PriceBreakdown;
    expect(b.suggestions[0]).toMatchObject({
      kind: 'add-item',
      slug: beanie.slug,
      size: 'One Size',
      qty: 1,
      addedCost: 129_900,
      extraSavings: 129_900,
    });
  });

  it('validates the cart against the catalog', async () => {
    const { shirt } = await catalog();
    const missing = await t
      .http()
      .post(`${API}/pricing/quote`)
      .send({ items: [{ productId: '64b7f0f0f0f0f0f0f0f0f0f0', size: 'M', qty: 1 }] });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toMatch(/Product not found/);
    const badSize = await t
      .http()
      .post(`${API}/pricing/quote`)
      .send({ items: [item(shirt, 'XXL')] });
    expect(badSize.body.error).toBe('Size XXL not available for Oxford Shirt');
    await t.http().post(`${API}/pricing/quote`).send({ items: [] }).expect(400);
  });
});

describe('PricingEngine.redeem', () => {
  it('counts usage all-or-nothing against usage limits', async () => {
    const token = await admin();
    const unlimited = await createPromotion(token, { name: 'Unlimited', action: { type: 'percentOff', percent: 5 } });
    const limited = await createPromotion(token, { name: 'Last one', usageLimit: 1, action: { type: 'freeShipping' } });
    const applied = (p: { _id: string }, name: string) =>
      ({ promotionId: p._id, version: 1, name, actionType: 'percentOff', stage: 'cart', amount: 1, times: 1, description: '' }) as const;
    const pricing = t.container.services.pricing;

    await pricing.redeem([applied(unlimited, 'Unlimited'), applied(limited, 'Last one')]);
    await expect(pricing.redeem([applied(unlimited, 'Unlimited'), applied(limited, 'Last one')])).rejects.toMatchObject({
      status: 409,
      message: '"Last one" has just been fully redeemed. Please review your cart.',
    });
    const after = await t.http().get(`${API}/admin/promotions/${unlimited._id}`).set(bearer(token)).expect(200);
    expect(after.body.usedCount).toBe(1);
  });
});

describe('GET /pricing/products/:id/bundles', () => {
  it('lists live, automatic bundle offers that include the product', async () => {
    const token = await admin();
    const { shirt, jeans } = await catalog();
    await createPromotion(token, {
      name: 'Weekend Uniform',
      description: 'Shirt and jeans, sorted.',
      action: {
        type: 'fixedBundle',
        components: [
          { selector: { slugs: [shirt.slug] }, qty: 1 },
          { selector: { categories: ['Men'] }, qty: 1 },
        ],
        price: 599_900,
      },
    });
    await createPromotion(token, {
      name: 'Draft',
      status: 'draft',
      action: { type: 'mixAndMatch', selector: { categories: ['Men'] }, quantity: 2, price: 1 },
    });
    await createPromotion(token, {
      name: 'Secret',
      activation: 'code',
      code: 'SECRET',
      action: { type: 'mixAndMatch', selector: { categories: ['Men'] }, quantity: 2, price: 1 },
    });

    const res = await t.http().get(`${API}/pricing/products/${shirt._id}/bundles`).expect(200);
    expect(res.body.offers).toHaveLength(1);
    expect(res.body.offers[0]).toMatchObject({
      name: 'Weekend Uniform',
      description: 'Shirt and jeans, sorted.',
      actionType: 'fixedBundle',
      bundlePrice: 599_900,
      listPrice: 709_800,
      savings: 109_900,
    });
    const forJeans = await t.http().get(`${API}/pricing/products/${jeans._id}/bundles`).expect(200);
    expect(forJeans.body.offers[0].components.map((c: { slug: string }) => c.slug)).toEqual([shirt.slug, jeans.slug]);
    await t.http().get(`${API}/pricing/products/not-an-id/bundles`).expect(400);
  });
});

describe('admin promotions', () => {
  it('is admin-only', async () => {
    const customer = await createUser();
    await t.http().get(`${API}/admin/promotions`).set(bearer(customer.token)).expect(403);
    await t.http().get(`${API}/admin/promotions`).expect(401);
  });

  it('creates, versions, updates with If-Match and archives promotions', async () => {
    const token = await admin();
    const created = await createPromotion(token, {
      name: 'Any 3',
      action: { type: 'mixAndMatch', selector: { categories: ['Men'] }, quantity: 3, price: 499_900 },
    });
    expect(created.version).toBe(1);

    const got = await t.http().get(`${API}/admin/promotions/${created._id}`).set(bearer(token)).expect(200);
    expect(got.headers.etag).toBe('"1"');

    const updated = await t
      .http()
      .put(`${API}/admin/promotions/${created._id}`)
      .set(bearer(token))
      .set('If-Match', '"1"')
      .send({ name: 'Any 3 for less' })
      .expect(200);
    expect(updated.body).toMatchObject({ name: 'Any 3 for less', version: 2 });

    const stale = await t
      .http()
      .put(`${API}/admin/promotions/${created._id}`)
      .set(bearer(token))
      .set('If-Match', '1')
      .send({ priority: 5 });
    expect(stale.status).toBe(409);

    const badCode = await t.http().put(`${API}/admin/promotions/${created._id}`).set(bearer(token)).send({ activation: 'code' });
    expect(badCode.status).toBe(400);

    const versions = await t.http().get(`${API}/admin/promotions/${created._id}/versions`).set(bearer(token)).expect(200);
    expect(versions.body.map((v: { version: number }) => v.version)).toEqual([2, 1]);

    const archived = await t.http().delete(`${API}/admin/promotions/${created._id}`).set(bearer(token)).expect(200);
    expect(archived.body).toMatchObject({ status: 'archived', version: 3 });

    const list = await t.http().get(`${API}/admin/promotions?status=archived`).set(bearer(token)).expect(200);
    expect(list.body).toHaveLength(1);
  });

  it('rejects duplicate codes and malformed rules', async () => {
    const token = await admin();
    const body = { name: 'Welcome', activation: 'code', code: 'WELCOME10', action: { type: 'percentOff', percent: 10 } };
    await createPromotion(token, body);
    await t.http().post(`${API}/admin/promotions`).set(bearer(token)).send(body).expect(409);
    const malformed = await t
      .http()
      .post(`${API}/admin/promotions`)
      .set(bearer(token))
      .send({ name: 'Broken', action: { type: 'mixAndMatch', selector: {}, quantity: 1, price: -5 } });
    expect(malformed.status).toBe(400);
    expect(malformed.body.details.length).toBeGreaterThan(0);
  });

  it('invalidates the promotion cache on writes', async () => {
    const token = await admin();
    const { shirt } = await catalog();
    const quote = () =>
      t
        .http()
        .post(`${API}/pricing/quote`)
        .send({ items: [item(shirt)] });
    expect((await quote()).body.breakdown.discountTotal).toBe(0);
    const promo = await createPromotion(token, { name: 'Ten off', action: { type: 'percentOff', percent: 10 } });
    expect((await quote()).body.breakdown.cartDiscount).toBe(24_990);
    await t.http().put(`${API}/admin/promotions/${promo._id}`).set(bearer(token)).send({ status: 'paused' }).expect(200);
    expect((await quote()).body.breakdown.cartDiscount).toBe(0);
  });

  it('simulates carts for any segment and moment, optionally including drafts', async () => {
    const token = await admin();
    const { shirt } = await catalog();
    await createPromotion(token, {
      name: 'Friday draft',
      status: 'draft',
      conditions: {
        type: 'all',
        conditions: [
          { type: 'dateWindow', daysOfWeek: [5] },
          { type: 'customerSegment', segment: 'firstOrder' },
        ],
      },
      action: { type: 'percentOff', percent: 20 },
    });
    const simulate = (body: Record<string, unknown>) =>
      t
        .http()
        .post(`${API}/admin/promotions/simulate`)
        .set(bearer(token))
        .send({ items: [item(shirt)], ...body })
        .expect(200);

    const friday = '2026-10-30T06:30:00.000Z';
    expect((await simulate({ at: friday, segment: 'firstOrder' })).body.cartDiscount).toBe(0);
    expect((await simulate({ at: friday, segment: 'firstOrder', includeDrafts: true })).body.cartDiscount).toBe(49_980);
    expect((await simulate({ at: friday, segment: 'returning', includeDrafts: true })).body.cartDiscount).toBe(0);
    expect((await simulate({ at: '2026-10-31T06:30:00.000Z', segment: 'firstOrder', includeDrafts: true })).body.cartDiscount).toBe(0);
  });
});
