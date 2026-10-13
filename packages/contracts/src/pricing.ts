import { z } from 'zod';
import { PaiseSchema, type Paise } from './money';

const percent = z.number().int('Percent must be a whole number').min(1, 'Percent must be at least 1').max(100, 'Percent cannot exceed 100');
const positivePaise = PaiseSchema.positive('Amount must be greater than 0');
const isoDate = z.string().datetime({ offset: true, message: 'Must be an ISO-8601 date-time' });

export const ProductSelectorSchema = z
  .object({
    productIds: z.array(z.string().min(1)).max(100).optional(),
    slugs: z.array(z.string().min(1)).max(100).optional(),
    categories: z.array(z.string().min(1)).max(20).optional(),
  })
  .strict()
  .refine(s => Boolean(s.productIds?.length || s.slugs?.length || s.categories?.length), {
    message: 'A selector needs at least one product id, slug or category',
  });
export type ProductSelector = z.infer<typeof ProductSelectorSchema>;

export const CUSTOMER_SEGMENTS = ['guest', 'signedIn', 'firstOrder', 'returning'] as const;
export type CustomerSegment = (typeof CUSTOMER_SEGMENTS)[number];

export const PAYMENT_METHODS = ['upi', 'card', 'netbanking', 'wallet', 'demo'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type ConditionSpec =
  | { type: 'all'; conditions: ConditionSpec[] }
  | { type: 'any'; conditions: ConditionSpec[] }
  | { type: 'not'; condition: ConditionSpec }
  | { type: 'cartContains'; selector: ProductSelector; minQty: number }
  | { type: 'minSubtotal'; amount: Paise }
  | { type: 'customerSegment'; segment: CustomerSegment }
  | { type: 'dateWindow'; from?: string; to?: string; daysOfWeek?: number[]; hours?: { start: number; end: number } }
  | { type: 'paymentMethod'; methods: PaymentMethod[] };

export const ConditionSpecSchema: z.ZodType<ConditionSpec> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('all'), conditions: z.array(ConditionSpecSchema).min(1).max(10) }).strict(),
    z.object({ type: z.literal('any'), conditions: z.array(ConditionSpecSchema).min(1).max(10) }).strict(),
    z.object({ type: z.literal('not'), condition: ConditionSpecSchema }).strict(),
    z.object({ type: z.literal('cartContains'), selector: ProductSelectorSchema, minQty: z.number().int().min(1).max(50) }).strict(),
    z.object({ type: z.literal('minSubtotal'), amount: positivePaise }).strict(),
    z.object({ type: z.literal('customerSegment'), segment: z.enum(CUSTOMER_SEGMENTS) }).strict(),
    z
      .object({
        type: z.literal('dateWindow'),
        from: isoDate.optional(),
        to: isoDate.optional(),
        daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
        hours: z
          .object({ start: z.number().int().min(0).max(23), end: z.number().int().min(1).max(24) })
          .strict()
          .refine(h => h.end > h.start, 'Hour window must end after it starts')
          .optional(),
      })
      .strict(),
    z.object({ type: z.literal('paymentMethod'), methods: z.array(z.enum(PAYMENT_METHODS)).min(1) }).strict(),
  ]),
);

const BundleComponentSchema = z.object({ selector: ProductSelectorSchema, qty: z.number().int().min(1).max(4) }).strict();

const TierSchema = z
  .object({ minSubtotal: positivePaise, percentOff: percent.optional(), amountOff: positivePaise.optional() })
  .strict()
  .refine(t => (t.percentOff === undefined) !== (t.amountOff === undefined), 'Each tier needs exactly one of percentOff or amountOff');

export const ActionSpecSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fixedBundle'), components: z.array(BundleComponentSchema).min(1).max(4), price: positivePaise }).strict(),
  z
    .object({
      type: z.literal('mixAndMatch'),
      selector: ProductSelectorSchema,
      quantity: z.number().int().min(2).max(6),
      price: positivePaise,
    })
    .strict(),
  z
    .object({
      type: z.literal('buyXGetY'),
      selector: ProductSelectorSchema,
      buyQty: z.number().int().min(1).max(4),
      getQty: z.number().int().min(1).max(2),
      percentOff: percent,
    })
    .strict(),
  z
    .object({
      type: z.literal('tiered'),
      selector: ProductSelectorSchema.optional(),
      tiers: z
        .array(TierSchema)
        .min(1)
        .max(5)
        .refine(ts => ts.every((t, i) => i === 0 || t.minSubtotal > ts[i - 1].minSubtotal), 'Tiers must have increasing minSubtotal'),
    })
    .strict(),
  z
    .object({ type: z.literal('percentOff'), selector: ProductSelectorSchema.optional(), percent, maxDiscount: positivePaise.optional() })
    .strict(),
  z.object({ type: z.literal('flatOff'), selector: ProductSelectorSchema.optional(), amount: positivePaise }).strict(),
  z.object({ type: z.literal('freeShipping') }).strict(),
  z.object({ type: z.literal('markdown'), selector: ProductSelectorSchema, percentOff: percent }).strict(),
  z
    .object({
      type: z.literal('clearance'),
      selector: ProductSelectorSchema.optional(),
      percentOff: percent,
      minStock: z.number().int().min(1),
      minAgeDays: z.number().int().min(0),
    })
    .strict(),
]);
export type ActionSpec = z.infer<typeof ActionSpecSchema>;
export type ActionType = ActionSpec['type'];

export const CONSUMING_ACTIONS = ['fixedBundle', 'mixAndMatch', 'buyXGetY'] as const satisfies readonly ActionType[];
export const MARKDOWN_ACTIONS = ['markdown', 'clearance'] as const satisfies readonly ActionType[];

export const PROMOTION_STATUSES = ['draft', 'active', 'paused', 'archived'] as const;
export type PromotionStatus = (typeof PROMOTION_STATUSES)[number];

export const PROMOTION_ACTIVATIONS = ['auto', 'code'] as const;
export type PromotionActivation = (typeof PROMOTION_ACTIVATIONS)[number];

const promotionFields = {
  name: z.string().trim().min(3, 'Name must be at least 3 characters').max(80),
  description: z.string().trim().max(300).default(''),
  status: z.enum(PROMOTION_STATUSES).default('draft'),
  activation: z.enum(PROMOTION_ACTIVATIONS).default('auto'),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{3,30}$/, 'Codes are 3-30 letters, digits, dashes or underscores')
    .optional(),
  priority: z.number().int().min(0).max(1000).default(100),
  stackGroup: z.string().trim().min(1).max(40).optional(),
  exclusive: z.boolean().default(false),
  conditions: ConditionSpecSchema.optional(),
  action: ActionSpecSchema,
  startsAt: isoDate.optional(),
  endsAt: isoDate.optional(),
  usageLimit: z.number().int().positive().optional(),
};

const activationRule = (p: { activation?: PromotionActivation; code?: string }) => (p.activation === 'code') === Boolean(p.code);
const activationMessage = { message: 'Code promotions need a code, and automatic promotions must not have one', path: ['code'] };
const windowRule = (p: { startsAt?: string; endsAt?: string }) => !p.startsAt || !p.endsAt || p.startsAt < p.endsAt;
const windowMessage = { message: 'endsAt must be after startsAt', path: ['endsAt'] };

export const PromotionInputSchema = z
  .object(promotionFields)
  .strict()
  .refine(activationRule, activationMessage)
  .refine(windowRule, windowMessage);
export type PromotionInput = z.infer<typeof PromotionInputSchema>;

export const PromotionUpdateSchema = z
  .object(promotionFields)
  .partial()
  .strict()
  .refine(p => p.activation === undefined || activationRule(p), activationMessage)
  .refine(windowRule, windowMessage);
export type PromotionUpdate = z.infer<typeof PromotionUpdateSchema>;

export interface Promotion extends Omit<PromotionInput, 'startsAt' | 'endsAt'> {
  _id: string;
  version: number;
  usedCount: number;
  startsAt?: string;
  endsAt?: string;
  createdAt: string;
  updatedAt: string;
}

export const PricingItemSchema = z
  .object({
    productId: z.string({ required_error: 'Product ID is required' }).min(1),
    size: z.string({ required_error: 'Size is required' }).min(1),
    qty: z.number({ required_error: 'Quantity is required' }).int().min(1).max(20),
  })
  .strict();
export type PricingItem = z.infer<typeof PricingItemSchema>;

export const PricingQuoteRequestSchema = z
  .object({
    items: z.array(PricingItemSchema).min(1, 'Cart is empty').max(50),
    codes: z.array(z.string().trim().toUpperCase().min(1).max(30)).max(3).default([]),
    paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  })
  .strict();
export type PricingQuoteRequest = z.infer<typeof PricingQuoteRequestSchema>;

export const PromotionSimulationSchema = PricingQuoteRequestSchema.extend({
  segment: z.enum(CUSTOMER_SEGMENTS).default('signedIn'),
  at: isoDate.optional(),
  includeDrafts: z.boolean().default(false),
}).strict();
export type PromotionSimulationInput = z.infer<typeof PromotionSimulationSchema>;

export type PricingStageName = 'markdown' | 'bundle' | 'cart' | 'code' | 'shipping';

export interface LineDiscount {
  promotionId: string;
  amount: Paise;
}

export interface PricedLine {
  productId: string;
  slug: string;
  title: string;
  image?: string;
  category: string;
  size: string;
  qty: number;
  unitPrice: Paise;
  markdownPerUnit: Paise;
  effectiveUnitPrice: Paise;
  lineSubtotal: Paise;
  discounts: LineDiscount[];
  lineTotal: Paise;
}

export interface AppliedPromotion {
  promotionId: string;
  version: number;
  name: string;
  actionType: ActionType;
  stage: PricingStageName;
  code?: string;
  amount: Paise;
  times: number;
  description: string;
}

export interface PricingSuggestion {
  kind: 'add-item' | 'spend-more';
  promotionId?: string;
  message: string;
  productId?: string;
  slug?: string;
  size?: string;
  qty?: number;
  addedCost: Paise;
  extraSavings: Paise;
}

export interface RejectedCode {
  code: string;
  reason: string;
}

export interface OptimizerReport {
  strategy: 'branch-and-bound' | 'greedy-fallback';
  nodesExplored: number;
  bundleSavings: Paise;
  greedySavings: Paise;
}

export interface PriceBreakdown {
  currency: 'INR';
  lines: PricedLine[];
  listSubtotal: Paise;
  markdownTotal: Paise;
  merchandiseSubtotal: Paise;
  bundleDiscount: Paise;
  cartDiscount: Paise;
  codeDiscount: Paise;
  discountTotal: Paise;
  shipping: Paise;
  shippingDiscount: Paise;
  total: Paise;
  totalSavings: Paise;
  applied: AppliedPromotion[];
  explanations: string[];
  suggestions: PricingSuggestion[];
  rejectedCodes: RejectedCode[];
  optimizer: OptimizerReport;
}

export interface PriceQuote {
  quoteId: string;
  contentHash: string;
  expiresAt: string;
  breakdown: PriceBreakdown;
}

export interface BundleOfferComponent {
  productId: string;
  slug: string;
  title: string;
  image?: string;
  price: Paise;
}

export interface BundleOffer {
  promotionId: string;
  name: string;
  description: string;
  actionType: ActionType;
  summary: string;
  components?: BundleOfferComponent[];
  bundlePrice?: Paise;
  listPrice?: Paise;
  savings?: Paise;
}
