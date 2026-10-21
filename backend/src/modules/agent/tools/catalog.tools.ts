import { formatINR, rupeesToPaise } from '@storefront/contracts';
import { z } from 'zod';
import type { CatalogService } from '../../catalog/catalog.service';
import type { ProductRecord } from '../../catalog/product.model';
import { ProductQueryBuilder } from '../../catalog/product-query.builder';
import type { ReviewRepository } from '../../reviews/review.repository';
import { AgentTool, type ToolResult } from './agent-tool';

const toPaise = (rupees?: number) => (rupees && rupees > 0 ? rupeesToPaise(rupees) : undefined);

export const productSummary = (p: ProductRecord) => ({
  title: p.title,
  slug: p.slug,
  url: `/products/${p.slug}`,
  price: formatINR(p.price),
  compareAtPrice: p.compareAtPrice ? formatINR(p.compareAtPrice) : null,
  category: p.category,
  rating: p.rating,
  numReviews: p.numReviews,
  sizesInStock: p.sizes.filter(s => s.stock > 0).map(s => s.size),
});

const SearchSchema = z.object({
  query: z.string().max(200).optional().describe('Free-text search over titles and descriptions'),
  category: z.string().max(60).optional().describe('Exact category filter, e.g. Men, Women, Footwear, Accessories'),
  minPrice: z.number().nonnegative().optional().describe('Minimum price in rupees'),
  maxPrice: z.number().nonnegative().optional().describe('Maximum price in rupees'),
  featured: z.boolean().optional().describe('Only featured products'),
  sort: z.enum(['price-asc', 'price-desc', 'newest', 'rating']).optional(),
  limit: z.number().int().min(1).max(8).optional().describe('Max results (default 5)'),
});

export class SearchProductsTool extends AgentTool<typeof SearchSchema> {
  readonly name = 'search_products';
  readonly title = 'Search products';
  readonly description =
    'Search the STOREFRONT catalog by text, category and price range (in rupees). Use for discovery, recommendations and availability.';
  readonly schema = SearchSchema;

  constructor(private readonly catalog: CatalogService) {
    super();
  }

  async execute(args: z.infer<typeof SearchSchema>): Promise<ToolResult> {
    const limit = args.limit ?? 5;
    let items = await this.catalog.search(
      new ProductQueryBuilder()
        .inCategory(args.category)
        .priceBetween(toPaise(args.minPrice), toPaise(args.maxPrice))
        .featuredOnly(args.featured === true)
        .matchingText(args.query)
        .sortBy(args.sort, 'rating')
        .take(limit),
    );
    if (!items.length && args.query) {
      items = await this.catalog.search(new ProductQueryBuilder().titleMatchingAnyWord(args.query).take(limit));
    }
    return { count: items.length, products: items.map(productSummary) };
  }
}

const DetailsSchema = z.object({ slug: z.string().min(1).max(120).describe('Product slug from search results') });

export class GetProductDetailsTool extends AgentTool<typeof DetailsSchema> {
  readonly name = 'get_product_details';
  readonly title = 'Get product details';
  readonly description = 'Full details for one product by slug: description, per-size stock, pricing, rating and recent customer reviews.';
  readonly schema = DetailsSchema;

  constructor(
    private readonly catalog: CatalogService,
    private readonly reviews: ReviewRepository,
  ) {
    super();
  }

  async execute({ slug }: z.infer<typeof DetailsSchema>): Promise<ToolResult> {
    const p = await this.catalog.findBySlug(slug);
    if (!p) return { error: `No product found with slug "${slug}"` };
    const reviews = await this.reviews.listForProduct(String(p._id), 3);
    return {
      ...productSummary(p),
      description: p.description,
      sizes: p.sizes.map(s => ({ size: s.size, stock: s.stock })),
      recentReviews: reviews.map(r => ({ rating: r.rating, comment: r.comment, verifiedPurchase: r.verifiedPurchase ?? false })),
    };
  }
}

const NoArgs = z.object({});

export class ListCategoriesTool extends AgentTool<typeof NoArgs> {
  readonly name = 'list_categories';
  readonly title = 'List categories';
  readonly description = 'All product categories with product counts.';
  readonly schema = NoArgs;

  constructor(private readonly catalog: CatalogService) {
    super();
  }

  async execute(): Promise<ToolResult> {
    const cats = await this.catalog.categories();
    return { categories: cats.map(c => ({ name: c.name, products: c.count })) };
  }
}
