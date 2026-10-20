import { formatINR, type PriceBreakdown } from '@storefront/contracts';
import { z } from 'zod';
import type { CatalogService } from '../../catalog/catalog.service';
import type { PricingService } from '../../pricing/pricing.service';
import { AgentTool, type ToolContext, type ToolResult } from './agent-tool';

const money = (paise: number) => formatINR(paise);

export function breakdownSummary(b: PriceBreakdown) {
  return {
    items: b.lines.map(l => ({ title: l.title, slug: l.slug, size: l.size, qty: l.qty, lineTotal: money(l.lineTotal) })),
    listSubtotal: money(b.listSubtotal),
    totalSavings: money(b.totalSavings),
    shipping: b.shipping - b.shippingDiscount > 0 ? money(b.shipping - b.shippingDiscount) : 'Free',
    total: money(b.total),
    appliedOffers: b.applied.map(a => ({ name: a.name, saving: money(a.amount), code: a.code ?? null })),
    explanations: b.explanations,
    suggestions: b.suggestions.map(s => ({ message: s.message, slug: s.slug ?? null, extraSavings: money(s.extraSavings) })),
    rejectedCodes: b.rejectedCodes,
  };
}

const QuoteSchema = z.object({
  items: z
    .array(z.object({ slug: z.string().min(1).max(120), size: z.string().min(1).max(20), qty: z.number().int().min(1).max(20) }))
    .max(30)
    .optional()
    .describe("Items to price; omit to price the customer's current bag"),
  codes: z.array(z.string().max(30)).max(5).optional().describe('Promo codes the customer mentioned'),
});

export class GetBestPriceTool extends AgentTool<typeof QuoteSchema> {
  readonly name = 'get_best_price';
  readonly title = 'Get best price';
  readonly description =
    'Price a bag with the promotion engine, which automatically finds the cheapest combination of offers. Returns totals, applied offers and suggestions that unlock more savings.';
  readonly schema = QuoteSchema;

  constructor(
    private readonly pricing: PricingService,
    private readonly catalog: CatalogService,
  ) {
    super();
  }

  async execute(args: z.infer<typeof QuoteSchema>, ctx: ToolContext): Promise<ToolResult> {
    let items = ctx.cart.map(l => ({ productId: String(l.productId), size: l.size, qty: l.qty }));
    if (args.items?.length) {
      items = [];
      for (const it of args.items) {
        const product = await this.catalog.findBySlug(it.slug);
        if (!product) return { error: `No product found with slug "${it.slug}"` };
        items.push({ productId: String(product._id), size: it.size, qty: it.qty });
      }
    }
    if (!items.length) return { error: 'The bag is empty. Ask which products the customer wants priced.' };
    const quote = await this.pricing.quote({ items, codes: args.codes }, { userId: ctx.user?.id });
    return breakdownSummary(quote.breakdown);
  }
}

const BundlesSchema = z.object({ slug: z.string().min(1).max(120).describe('Product slug') });

export class SuggestBundlesTool extends AgentTool<typeof BundlesSchema> {
  readonly name = 'suggest_bundles';
  readonly title = 'Suggest bundles';
  readonly description = 'Offers that include a product: combos, buy-X-get-Y and mix-and-match deals, with bundle prices and savings.';
  readonly schema = BundlesSchema;

  constructor(
    private readonly pricing: PricingService,
    private readonly catalog: CatalogService,
  ) {
    super();
  }

  async execute({ slug }: z.infer<typeof BundlesSchema>): Promise<ToolResult> {
    const product = await this.catalog.findBySlug(slug);
    if (!product) return { error: `No product found with slug "${slug}"` };
    const offers = await this.pricing.bundlesForProduct(String(product._id));
    return {
      product: { title: product.title, slug: product.slug },
      offers: offers.map(o => ({
        name: o.name,
        summary: o.summary,
        components: o.components?.map(c => ({ title: c.title, slug: c.slug, url: `/products/${c.slug}`, price: money(c.price) })) ?? [],
        bundlePrice: o.bundlePrice !== undefined ? money(o.bundlePrice) : null,
        savings: o.savings !== undefined ? money(o.savings) : null,
      })),
    };
  }
}
