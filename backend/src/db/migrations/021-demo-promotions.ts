import { PromotionInputSchema, rupeesToPaise as inr, type PromotionInput } from '@storefront/contracts';
import type { mongo } from 'mongoose';
import type { Migration } from '../migration';

const SHIRTS_AND_TOPS = ['oxford-cotton-shirt', 'breton-linen-shirt', 'twill-overshirt', 'ribbed-knit-top'];
const SMALL_ACCESSORIES = [
  'full-grain-leather-belt',
  'ribbed-wool-beanie',
  'leather-card-holder',
  'hand-rolled-silk-scarf',
  'aviator-sunglasses',
];

/** Demo promotions that overlap on purpose, so the optimizer and stack-group rules have real choices to make. */
export const DEMO_PROMOTIONS: Array<Partial<PromotionInput> & Pick<PromotionInput, 'name' | 'action'>> = [
  {
    name: 'Weekend Uniform',
    description: 'Our Oxford shirt with selvedge denim, for one bundle price.',
    priority: 200,
    action: {
      type: 'fixedBundle',
      components: [
        { selector: { slugs: ['oxford-cotton-shirt'] }, qty: 1 },
        { selector: { slugs: ['selvedge-denim-jeans'] }, qty: 1 },
      ],
      price: inr(5999),
    },
  },
  {
    name: 'Any 3 shirts & tops',
    description: 'Mix and match any three shirts or knit tops.',
    priority: 150,
    action: { type: 'mixAndMatch', selector: { slugs: SHIRTS_AND_TOPS }, quantity: 3, price: inr(5999) },
  },
  {
    name: 'Buy 2, get 1 free on small accessories',
    description: 'Belts, beanies, card holders, scarves and sunglasses — the cheapest of every three is on us.',
    priority: 150,
    action: { type: 'buyXGetY', selector: { slugs: SMALL_ACCESSORIES }, buyQty: 2, getQty: 1, percentOff: 100 },
  },
  {
    name: 'Spend more, save more',
    description: '5% off orders over ₹10,000 and 10% off over ₹20,000.',
    stackGroup: 'order-discount',
    action: {
      type: 'tiered',
      tiers: [
        { minSubtotal: inr(10_000), percentOff: 5 },
        { minSubtotal: inr(20_000), percentOff: 10 },
      ],
    },
  },
  {
    name: 'WELCOME10',
    description: '10% off (up to ₹500) on orders above ₹1,000.',
    activation: 'code',
    code: 'WELCOME10',
    stackGroup: 'order-discount',
    conditions: { type: 'minSubtotal', amount: inr(1000) },
    action: { type: 'percentOff', percent: 10, maxDiscount: inr(500) },
  },
  {
    name: 'FLAT500',
    description: '₹500 off orders of ₹2,999 or more.',
    activation: 'code',
    code: 'FLAT500',
    stackGroup: 'order-discount',
    conditions: { type: 'minSubtotal', amount: inr(2999) },
    action: { type: 'flatOff', amount: inr(500) },
  },
  {
    name: 'First order ships free',
    description: 'Free shipping on your first order, whatever its size.',
    conditions: { type: 'customerSegment', segment: 'firstOrder' },
    action: { type: 'freeShipping' },
  },
  {
    name: 'Footwear Friday',
    description: '15% off all footwear, every Friday (IST).',
    conditions: { type: 'dateWindow', daysOfWeek: [5] },
    action: { type: 'markdown', selector: { categories: ['Footwear'] }, percentOff: 15 },
  },
  {
    name: 'Clearance',
    description: '20% off sizes we have had in deep stock for over 60 days.',
    action: { type: 'clearance', percentOff: 20, minStock: 15, minAgeDays: 60 },
  },
];

export const demoPromotions: Migration = {
  id: '021-demo-promotions',
  description: 'Seed overlapping demo promotions (combo, mix-and-match, BOGO, tiers, codes, segments, markdowns)',
  async up(db: mongo.Db) {
    const promotions = db.collection('promotions');
    const versions = db.collection('promotion_versions');
    const now = new Date();
    for (const raw of DEMO_PROMOTIONS) {
      const input = PromotionInputSchema.parse({ status: 'active', ...raw });
      if (await promotions.findOne({ $or: [{ name: input.name }, ...(input.code ? [{ code: input.code }] : [])] })) continue;
      const doc = {
        ...input,
        usedCount: 0,
        version: 1,
        createdBy: 'system:migration',
        updatedBy: 'system:migration',
        createdAt: now,
        updatedAt: now,
      };
      const { insertedId } = await promotions.insertOne(doc);
      const { usedCount: _usedCount, createdAt: _c, updatedAt: _u, ...snapshot } = doc;
      await versions.insertOne({ promotionId: insertedId, version: 1, snapshot, changedBy: 'system:migration', createdAt: now });
    }
  },
};
