import { PromotionInputSchema, rupeesToPaise as inr, type PromotionInput } from '@storefront/contracts';
import type { mongo } from 'mongoose';

const SHIRTS_AND_TOPS = ['oxford-cotton-shirt', 'breton-linen-shirt', 'twill-overshirt', 'ribbed-knit-top'];
const SMALL_ACCESSORIES = [
  'full-grain-leather-belt',
  'ribbed-wool-beanie',
  'leather-card-holder',
  'hand-rolled-silk-scarf',
  'aviator-sunglasses',
];
const KNITS = ['merino-crewneck-sweater', 'brushed-mohair-sweater', 'fair-isle-yoke-cardigan'];
const TEES = ['heavyweight-cotton-tee', 'garment-dyed-cotton-tee', 'breton-stripe-tee'];

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

  // Combos to advertise. Ranked below the launch offers above, and none of them touches the Oxford shirt, the
  // selvedge jeans or the shirts-and-tops set, so those offers keep winning exactly as before.
  {
    name: 'Desk to dinner',
    description: 'The unstructured linen blazer with tapered wool trousers for ₹10,999 — save ₹1,999.',
    priority: 120,
    action: {
      type: 'fixedBundle',
      components: [
        { selector: { slugs: ['unstructured-linen-blazer'] }, qty: 1 },
        { selector: { slugs: ['tapered-wool-trousers'] }, qty: 1 },
      ],
      price: inr(10_999),
    },
  },
  {
    name: 'The suiting set',
    description: 'Our oversized wool blazer with the wide-leg trousers for ₹10,499 — save ₹1,899.',
    priority: 120,
    action: {
      type: 'fixedBundle',
      components: [
        { selector: { slugs: ['oversized-wool-blazer'] }, qty: 1 },
        { selector: { slugs: ['wide-leg-trousers'] }, qty: 1 },
      ],
      price: inr(10_499),
    },
  },
  {
    name: 'Weekend away',
    description: 'Waxed canvas backpack, canvas low-tops and a washed cotton cap for ₹7,999 — save ₹1,698.',
    priority: 120,
    action: {
      type: 'fixedBundle',
      components: [
        { selector: { slugs: ['waxed-canvas-backpack'] }, qty: 1 },
        { selector: { slugs: ['canvas-low-top-sneakers'] }, qty: 1 },
        { selector: { slugs: ['washed-cotton-cap'] }, qty: 1 },
      ],
      price: inr(7999),
    },
  },
  {
    name: 'Derby & belt',
    description: 'Leather derby shoes with the full-grain leather belt for ₹7,499 — save ₹1,299.',
    priority: 120,
    action: {
      type: 'fixedBundle',
      components: [
        { selector: { slugs: ['leather-derby-shoes'] }, qty: 1 },
        { selector: { slugs: ['full-grain-leather-belt'] }, qty: 1 },
      ],
      price: inr(7499),
    },
  },
  {
    name: 'Any 2 knits',
    description: 'Any two of the merino crewneck, mohair sweater and Fair Isle cardigan for ₹6,999 — save up to ₹2,499.',
    priority: 120,
    action: { type: 'mixAndMatch', selector: { slugs: KNITS }, quantity: 2, price: inr(6999) },
  },
  {
    name: 'Buy 2 tees, get 1 free',
    description: 'Mix any three of our tees and the cheapest one is free — save up to ₹1,799.',
    priority: 120,
    action: { type: 'buyXGetY', selector: { slugs: TEES }, buyQty: 2, getQty: 1, percentOff: 100 },
  },
];

export async function seedDemoPromotions(db: mongo.Db): Promise<void> {
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
      createdBy: 'system:seed',
      updatedBy: 'system:seed',
      createdAt: now,
      updatedAt: now,
    };
    const { insertedId } = await promotions.insertOne(doc);
    const { usedCount: _usedCount, createdAt: _c, updatedAt: _u, ...snapshot } = doc;
    await versions.insertOne({ promotionId: insertedId, version: 1, snapshot, changedBy: 'system:seed', createdAt: now });
  }
}
