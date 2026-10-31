import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { DEMO_PROMOTIONS } from '../src/db/seed/demo-promotions';
import { DEMO_CATEGORIES, DEMO_PRODUCTS, slugify } from '../src/db/seed/demo-products';
import { seedDemoData } from '../src/db/seed/demo-seeder';
import { ProductModel } from '../src/modules/catalog/product.model';
import { recordOpeningBalances } from '../src/modules/inventory/opening-balances';
import { OrderModel } from '../src/modules/orders/order.model';
import { ReviewModel } from '../src/modules/reviews/review.model';
import { useTestApp } from './helpers/app';

const t = useTestApp();
const ENV = { ADMIN_EMAIL: 'admin@test.dev', ADMIN_PASSWORD: undefined };

/** The launch catalogue that stores seeded before the expansion already hold. */
const LAUNCH_SLUGS = [
  'oxford-cotton-shirt',
  'merino-crewneck-sweater',
  'selvedge-denim-jeans',
  'unstructured-linen-blazer',
  'twill-overshirt',
  'breton-linen-shirt',
  'silk-slip-dress',
  'wide-leg-trousers',
  'cashmere-cardigan',
  'pleated-midi-skirt',
  'double-faced-wool-coat',
  'ribbed-knit-top',
  'court-leather-sneakers',
  'suede-chelsea-boots',
  'canvas-high-tops',
  'suede-loafers',
  'structured-leather-tote',
  'hand-rolled-silk-scarf',
  'aviator-sunglasses',
  'minimal-automatic-watch',
  'full-grain-leather-belt',
  'ribbed-wool-beanie',
  'leather-card-holder',
  'waxed-canvas-backpack',
];

const movements = () => mongoose.connection.db!.collection('inventorymovements');

/** A store seeded before the expansion: the 24 launch products, then edited and sold from by the merchant. */
async function seedLaunchStore() {
  const launch = DEMO_PRODUCTS.filter(p => LAUNCH_SLUGS.includes(slugify(p.title)));
  await ProductModel.insertMany(
    launch.map(p => ({ ...p, slug: slugify(p.title), images: ['https://images.unsplash.com/photo-1603189343302-e603f7add05a'] })),
  );
  await recordOpeningBalances(mongoose.connection.db!, 'system:seed');
  // The merchant reprices one product and sells two units of another, through the ledger.
  await ProductModel.updateOne({ slug: 'oxford-cotton-shirt' }, { $set: { price: 199_900, title: 'Oxford Shirt (Blue)' } });
  const jeans = await ProductModel.findOneAndUpdate(
    { slug: 'selvedge-denim-jeans', 'sizes.size': 'M' },
    { $inc: { 'sizes.$.stock': -2 } },
    { new: true },
  ).lean();
  await movements().insertOne({
    productId: jeans!._id,
    size: 'M',
    type: 'SALE',
    qty: 2,
    delta: -2,
    actor: 'user:x',
    createdAt: new Date(),
  });
}

const snapshot = async (slugs: string[]) =>
  (
    await ProductModel.find({ slug: { $in: slugs } })
      .sort({ slug: 1 })
      .lean()
  ).map(p => ({ ...p, _id: String(p._id) }));

describe('demo catalogue data', () => {
  it('has about fifteen products in each of the four departments', () => {
    for (const category of DEMO_CATEGORIES) {
      expect(DEMO_PRODUCTS.filter(p => p.category === category).length, category).toBe(15);
    }
    expect(new Set(DEMO_PRODUCTS.map(p => p.category))).toEqual(new Set(DEMO_CATEGORIES));
  });

  it('keeps the launch catalogue and gives every product a unique slug and its own photos', () => {
    const slugs = DEMO_PRODUCTS.map(p => slugify(p.title));
    expect(slugs.slice(0, LAUNCH_SLUGS.length)).toEqual(LAUNCH_SLUGS);
    expect(new Set(slugs).size).toBe(slugs.length);
    const images = DEMO_PRODUCTS.flatMap(p => p.images);
    expect(new Set(images).size).toBe(images.length);
    for (const url of images) expect(url).toMatch(/^https:\/\/images\.unsplash\.com\/photo-\d+-[0-9a-f]+\?/);
  });

  it('prices in whole rupees and never discounts above the compare-at price', () => {
    for (const p of DEMO_PRODUCTS) {
      expect(p.price % 100, p.title).toBe(0);
      if (p.compareAtPrice !== undefined) expect(p.compareAtPrice, p.title).toBeGreaterThan(p.price);
      expect(p.sizes.length, p.title).toBeGreaterThan(0);
      for (const v of p.sizes) expect(v.stock, `${p.title} ${v.size}`).toBeGreaterThan(0);
    }
  });

  it('only advertises promotions on products that exist', () => {
    const slugs = new Set(DEMO_PRODUCTS.map(p => slugify(p.title)));
    const referenced = JSON.stringify(DEMO_PROMOTIONS).match(/"slugs":\[[^\]]*\]/g) ?? [];
    const all = referenced.flatMap(s => JSON.parse(`{${s}}`).slugs as string[]);
    expect(all.length).toBeGreaterThan(0);
    expect(all.filter(s => !slugs.has(s))).toEqual([]);
  });
});

// A fresh seed hashes passwords and writes 110 orders; give it headroom when the suite runs in parallel.
describe('additive demo seeding', { timeout: 60_000 }, () => {
  it('seeds every product on a fresh database with a reconciled ledger', async () => {
    expect(await seedDemoData(ENV)).toEqual({ catalogSeeded: true, productsAdded: DEMO_PRODUCTS.length });
    expect(await ProductModel.countDocuments()).toBe(DEMO_PRODUCTS.length);
    expect(await t.container.services.inventory.reconcile()).toMatchObject({ ok: true, mismatches: [] });
  });

  it('tops up a launch-era store with the missing products and leaves its own products untouched', async () => {
    await seedLaunchStore();
    const before = await snapshot(LAUNCH_SLUGS);
    const ledgerBefore = await movements().countDocuments();

    const result = await seedDemoData(ENV);

    expect(result).toEqual({ catalogSeeded: false, productsAdded: DEMO_PRODUCTS.length - LAUNCH_SLUGS.length });
    expect(await ProductModel.countDocuments()).toBe(DEMO_PRODUCTS.length);
    expect(await snapshot(LAUNCH_SLUGS)).toEqual(before);
    expect(await OrderModel.countDocuments()).toBe(0);
    expect(await ReviewModel.countDocuments()).toBe(0);

    const added = await ProductModel.find({ slug: { $nin: LAUNCH_SLUGS } }).lean();
    const openingRows = added.reduce((n, p) => n + p.sizes.length, 0);
    expect(await movements().countDocuments()).toBe(ledgerBefore + openingRows);
    expect(await movements().countDocuments({ productId: { $in: before.map(p => new mongoose.Types.ObjectId(p._id)) } })).toBe(
      ledgerBefore,
    );
    expect(await t.container.services.inventory.reconcile()).toMatchObject({ ok: true, mismatches: [] });
  });

  it('adds nothing when run again', async () => {
    await seedLaunchStore();
    await seedDemoData(ENV);
    const products = await snapshot(DEMO_PRODUCTS.map(p => slugify(p.title)));
    const ledger = await movements().countDocuments();

    expect(await seedDemoData(ENV)).toEqual({ catalogSeeded: false, productsAdded: 0 });
    expect(await snapshot(DEMO_PRODUCTS.map(p => slugify(p.title)))).toEqual(products);
    expect(await movements().countDocuments()).toBe(ledger);
  });

  it('does not paper over stock drift that existed before the top-up', async () => {
    await seedLaunchStore();
    await ProductModel.updateOne({ slug: 'suede-loafers', 'sizes.size': 'UK 8' }, { $inc: { 'sizes.$.stock': 3 } });

    await seedDemoData(ENV);

    const report = await t.container.services.inventory.reconcile();
    expect(report.ok).toBe(false);
    expect(report.mismatches).toEqual([expect.objectContaining({ size: 'UK 8', stock: 14, ledger: 11 })]);
  });
});
