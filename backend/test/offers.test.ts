import type { Offer, OffersResponse, PriceQuote } from '@storefront/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { OutboxModel } from '../src/core/events/outbox.model';
import { PromotionModel } from '../src/modules/pricing/promotion.model';
import { API, bearer, useTestApp } from './helpers/app';
import { createProduct, createUser } from './helpers/factories';

const t = useTestApp();
const HOUR = 3_600_000;
// The read model lives in the shared cache, which outlives each test's emptied collections.
beforeEach(() => t.container.services.offers.invalidate());

async function admin() {
  return (await createUser({ role: 'admin' })).token;
}

async function promote(token: string, body: Record<string, unknown>) {
  const res = await t
    .http()
    .post(`${API}/admin/promotions`)
    .set(bearer(token))
    .send({ status: 'active', ...body });
  expect(res.status).toBe(201);
  return res.body as { _id: string; version: number; showOnStorefront: boolean };
}

async function offers(): Promise<Offer[]> {
  await t.settle();
  const res = await t.http().get(`${API}/offers`).expect(200);
  return (res.body as OffersResponse).offers;
}

const names = (list: Offer[]) => list.map(o => o.name).sort();

async function catalog() {
  const shirt = await createProduct({ title: 'Oxford Shirt', price: 249_900 });
  const jeans = await createProduct({ title: 'Denim Jeans', price: 459_900 });
  const tee = await createProduct({ title: 'Pocket Tee', price: 99_900 });
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
  const card = await createProduct({
    title: 'Card Holder',
    price: 89_900,
    category: 'Accessories',
    sizes: [{ size: 'One Size', stock: 0 }],
  });
  return { shirt, jeans, tee, belt, beanie, card };
}

const bundle = (a: { slug: string }, b: { slug: string }, price = 599_900) => ({
  type: 'fixedBundle',
  components: [
    { selector: { slugs: [a.slug] }, qty: 1 },
    { selector: { slugs: [b.slug] }, qty: 1 },
  ],
  price,
});

describe('GET /offers', () => {
  it('advertises a fixed bundle with its pieces and an example equal to a real quote', async () => {
    const token = await admin();
    const { shirt, jeans } = await catalog();
    const promo = await promote(token, { name: 'Weekend Uniform', description: 'Shirt and jeans.', action: bundle(shirt, jeans) });
    expect(promo.showOnStorefront).toBe(true);

    const [offer] = await offers();
    expect(offer).toMatchObject({
      id: promo._id,
      name: 'Weekend Uniform',
      kind: 'set',
      headline: 'The set for ₹5,999',
      example: { listTotal: 709_800, total: 599_900, saving: 109_900, offerSaving: 109_900, shipping: 0, alsoApplied: [] },
    });
    expect(offer.pieces.map(p => p.slug).sort()).toEqual([jeans.slug, shirt.slug].sort());
    expect(offer.example!.lines.map(l => [l.slug, l.size, l.qty])).toEqual([
      [shirt.slug, 'M', 1],
      [jeans.slug, 'M', 1],
    ]);
    expect(offer).not.toHaveProperty('priority');
    expect(offer).not.toHaveProperty('usedCount');

    const quote = await t
      .http()
      .post(`${API}/pricing/quote`)
      .send({ items: offer.example!.lines.map(l => ({ productId: l.productId, size: l.size, qty: l.qty })) })
      .expect(200);
    const b = (quote.body as PriceQuote).breakdown;
    expect(b.total - (b.shipping - b.shippingDiscount)).toBe(offer.example!.total);
    expect(b.applied.find(a => a.promotionId === promo._id)?.amount).toBe(offer.example!.offerSaving);
  });

  it('only lists promotions that are live now, advertised and not used up', async () => {
    const token = await admin();
    const { shirt, jeans, tee } = await catalog();
    const now = Date.now();
    await promote(token, { name: 'Live set', action: bundle(shirt, jeans) });
    await promote(token, { name: 'Draft set', status: 'draft', action: bundle(shirt, jeans, 499_900) });
    await promote(token, { name: 'Paused set', status: 'paused', action: bundle(shirt, jeans, 499_900) });
    await promote(token, {
      name: 'Starts tomorrow',
      startsAt: new Date(now + 24 * HOUR).toISOString(),
      action: bundle(shirt, jeans, 499_900),
    });
    await promote(token, {
      name: 'Ended',
      startsAt: new Date(now - 48 * HOUR).toISOString(),
      endsAt: new Date(now - HOUR).toISOString(),
      action: bundle(shirt, jeans, 499_900),
    });
    await promote(token, { name: 'Hidden set', showOnStorefront: false, action: bundle(shirt, tee, 300_000) });
    const exhausted = await promote(token, { name: 'Used up', usageLimit: 2, action: bundle(jeans, tee, 499_900) });
    await PromotionModel.updateOne({ _id: exhausted._id }, { usedCount: 2 });
    // Date windows run on store time (IST), so "not today" is three days from today in Kolkata.
    const today = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
      new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' }).format(new Date(now)),
    );
    await promote(token, {
      name: 'Not today',
      conditions: { type: 'dateWindow', daysOfWeek: [(today + 3) % 7] },
      action: { type: 'markdown', selector: { slugs: [tee.slug] }, percentOff: 20 },
    });

    const live = await offers();
    expect(names(live)).toEqual(['Live set']);
  });

  it('keeps codes private unless the admin chooses to advertise them', async () => {
    const token = await admin();
    const { beanie } = await catalog();
    const welcome = await promote(token, {
      name: 'Welcome 10',
      activation: 'code',
      code: 'WELCOME10',
      conditions: { type: 'minSubtotal', amount: 100_000 },
      action: { type: 'percentOff', percent: 10, maxDiscount: 50_000 },
    });
    expect(welcome.showOnStorefront).toBe(false);
    expect(JSON.stringify(await offers())).not.toContain('WELCOME10');

    await t.http().put(`${API}/admin/promotions/${welcome._id}`).set(bearer(token)).send({ showOnStorefront: true }).expect(200);
    const [offer] = await offers();
    expect(offer).toMatchObject({ kind: 'code', code: 'WELCOME10', terms: ['On orders of ₹1,000 or more'], percentOff: 10 });
    // Priced with the code applied, on the cheapest piece that reaches the ₹1,000 minimum.
    expect(offer.example).toMatchObject({ lines: [{ slug: beanie.slug }], listTotal: 129_900, offerSaving: 12_990, total: 116_910 });

    // Turning an advertised automatic offer into a code hides it again unless the admin says otherwise.
    const auto = await promote(token, { name: 'Flash 5', action: { type: 'percentOff', percent: 5 } });
    await t.http().put(`${API}/admin/promotions/${auto._id}`).set(bearer(token)).send({ activation: 'code', code: 'FLASH5' }).expect(200);
    expect(JSON.stringify(await offers())).not.toContain('FLASH5');
  });

  it('prices multi-buys on the cheapest qualifying set and states tiers and delivery in words', async () => {
    const token = await admin();
    const { belt, beanie, card, shirt, tee } = await catalog();
    await promote(token, {
      name: 'Buy 2 get 1 free',
      action: { type: 'buyXGetY', selector: { categories: ['Accessories'] }, buyQty: 2, getQty: 1, percentOff: 100 },
    });
    await promote(token, {
      name: 'Any 2 for 3,000',
      action: { type: 'mixAndMatch', selector: { categories: ['Men'] }, quantity: 2, price: 300_000 },
    });
    await promote(token, {
      name: 'Spend more',
      stackGroup: 'order-discount',
      action: {
        type: 'tiered',
        tiers: [
          { minSubtotal: 1_000_000, percentOff: 5 },
          { minSubtotal: 2_000_000, percentOff: 10 },
        ],
      },
    });
    await promote(token, {
      name: 'First order ships free',
      conditions: { type: 'customerSegment', segment: 'firstOrder' },
      action: { type: 'freeShipping' },
    });

    const byName = Object.fromEntries((await offers()).map(o => [o.name, o]));
    // Only two accessories are in stock (the card holder is sold out), so the cheaper one repeats.
    const b2g1 = byName['Buy 2 get 1 free'];
    expect(b2g1.kind).toBe('multiBuy');
    expect(b2g1.pieces.map(p => p.slug).sort()).toEqual([beanie.slug, belt.slug].sort());
    expect(b2g1.pieces.map(p => p.slug)).not.toContain(card.slug);
    expect(b2g1.example!.lines.reduce((s, l) => s + l.qty, 0)).toBe(3);
    expect(b2g1.example!.offerSaving).toBeGreaterThan(0);

    // Cheapest pair of shirts above ₹3,000: the tee and the Oxford (₹3,498), not the tee twice.
    const pair = byName['Any 2 for 3,000'];
    expect(pair.example).toMatchObject({ listTotal: 349_800, total: 300_000, saving: 49_800 });
    expect(pair.example!.lines.map(l => l.slug).sort()).toEqual([shirt.slug, tee.slug].sort());

    expect(byName['Spend more']).toMatchObject({
      kind: 'spendMore',
      headline: 'Up to 10% off',
      tiers: [
        { minSubtotal: 1_000_000, percentOff: 5, reward: '5% off' },
        { minSubtotal: 2_000_000, percentOff: 10, reward: '10% off' },
      ],
    });
    expect(byName['Spend more'].example).toBeUndefined();
    expect(byName['First order ships free']).toMatchObject({ kind: 'delivery', terms: ['On your first order'], pieces: [] });
  });

  it('hides a set whose pieces are sold out and shows a markdown with a priced sample', async () => {
    const token = await admin();
    const { shirt, card, tee } = await catalog();
    await promote(token, { name: 'Sold-out set', action: bundle(shirt, card, 200_000) });
    await promote(token, { name: 'Tee sale', action: { type: 'markdown', selector: { slugs: [tee.slug] }, percentOff: 20 } });
    const live = await offers();
    expect(names(live)).toEqual(['Tee sale']);
    expect(live[0]).toMatchObject({ kind: 'sale', percentOff: 20, example: { listTotal: 99_900, total: 79_920, offerSaving: 19_980 } });
  });

  it('announces every saved version through the outbox and drops the cached read model', async () => {
    const token = await admin();
    const { shirt, jeans } = await catalog();
    expect(await offers()).toEqual([]);
    const promo = await promote(token, { name: 'Weekend Uniform', action: bundle(shirt, jeans) });
    expect(names(await offers())).toEqual(['Weekend Uniform']);

    await t.http().put(`${API}/admin/promotions/${promo._id}`).set(bearer(token)).send({ status: 'paused' }).expect(200);
    expect(await offers()).toEqual([]);

    const events = await OutboxModel.find({ name: 'PromotionChanged', aggregateId: promo._id }).sort({ occurredAt: 1 }).lean();
    expect(events.map(e => e.payload)).toEqual([
      { promotionId: promo._id, version: 1, change: 'created', status: 'active' },
      { promotionId: promo._id, version: 2, change: 'status', status: 'paused' },
    ]);
  });

  it('reprices the advertised example when a piece changes price', async () => {
    const token = await admin();
    const { shirt, jeans } = await catalog();
    await promote(token, { name: 'Weekend Uniform', action: bundle(shirt, jeans) });
    expect((await offers())[0].example).toMatchObject({ listTotal: 709_800, saving: 109_900 });

    await t.container.services.cachedCatalog.update(String(shirt._id), { price: 299_900 }, 'admin:test');
    expect((await offers())[0].example).toMatchObject({ listTotal: 759_800, total: 599_900, saving: 159_900 });
  });
});
