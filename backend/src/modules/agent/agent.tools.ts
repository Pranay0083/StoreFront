import { formatINR, rupeesToPaise, type ProductSort } from '@storefront/contracts';
import type { UserRepository } from '../auth/user.repository';
import type { CatalogService } from '../catalog/catalog.service';
import type { ProductRecord } from '../catalog/product.model';
import { ProductQueryBuilder } from '../catalog/product-query.builder';
import type { OrderRecord } from '../orders/order.model';
import type { OrderRepository } from '../orders/order.repository';
import { STORE_INFO } from './store-info';

export interface ToolContext {
  userId?: string;
  userEmail?: string;
}

export type ToolArgs = Record<string, unknown>;
type ToolResult = Record<string, unknown>;

export interface SearchProductsArgs {
  query?: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  featured?: boolean;
  sort?: ProductSort;
  limit?: number;
}

const toPaise = (rupees: unknown) => (Number(rupees) > 0 ? rupeesToPaise(Number(rupees)) : undefined);

const productSummary = (p: ProductRecord) => ({
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

const orderSummary = (o: OrderRecord) => ({
  orderNumber: o.orderNumber,
  status: o.status,
  total: formatINR(o.total),
  placedAt: o.createdAt,
  items: o.items.map(i => ({ title: i.title, size: i.size, qty: i.qty, price: formatINR(i.price) })),
  timeline: o.statusHistory.map(h => ({ to: h.to, at: h.at, note: h.note })),
});

export const AGENT_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'search_products',
      description: 'Search the STOREFRONT product catalog. Use for product discovery, recommendations, and availability questions.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Free-text search over titles and descriptions' },
          category: { type: 'string', description: 'Exact category filter, e.g. Men, Women, Footwear, Accessories' },
          minPrice: { type: 'number', description: 'Minimum price in rupees' },
          maxPrice: { type: 'number', description: 'Maximum price in rupees' },
          featured: { type: 'boolean', description: 'Only featured products' },
          sort: { type: 'string', enum: ['price-asc', 'price-desc', 'newest', 'rating'] },
          limit: { type: 'number', description: 'Max results (default 5, max 8)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_product_details',
      description: 'Get full details (description, per-size stock, pricing) for one product by its slug.',
      parameters: {
        type: 'object',
        properties: { slug: { type: 'string', description: 'Product slug from search results' } },
        required: ['slug'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_categories',
      description: 'List all product categories with product counts.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_order_status',
      description:
        'Look up the status and timeline of an order. If the customer is signed in, only orderNumber is needed (or omit it for their latest order).',
      parameters: {
        type: 'object',
        properties: {
          orderNumber: { type: 'string', description: 'Order number like SF-1234' },
          email: { type: 'string', description: 'Account email — only needed when the customer is not signed in' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_my_orders',
      description: "List the signed-in customer's 5 most recent orders with statuses.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_store_info',
      description: 'Store policies: shipping fees & timelines, payments, returns/refunds/cancellation, coupons, size guide.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

/** Read-only store tools shared by the chat agent and the MCP server. */
export class AgentTools {
  readonly definitions = AGENT_TOOL_DEFINITIONS;

  constructor(
    private readonly catalog: CatalogService,
    private readonly orders: OrderRepository,
    private readonly users: UserRepository,
  ) {}

  async execute(name: string, args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
    switch (name) {
      case 'search_products':
        return this.searchProducts(args as SearchProductsArgs);
      case 'get_product_details':
        return this.getProductDetails(String(args.slug ?? ''));
      case 'list_categories':
        return this.listCategories();
      case 'get_order_status':
        return this.getOrderStatus(args as { orderNumber?: string; email?: string }, ctx);
      case 'get_my_orders':
        return this.getMyOrders(ctx);
      case 'get_store_info':
        return { ...STORE_INFO };
      default:
        return { error: `Unknown tool ${name}` };
    }
  }

  async searchProducts(args: SearchProductsArgs): Promise<ToolResult> {
    const limit = Math.min(8, Number(args.limit) || 5);
    let items = await this.catalog.search(
      new ProductQueryBuilder()
        .inCategory(args.category)
        .priceBetween(toPaise(args.minPrice), toPaise(args.maxPrice))
        .featuredOnly(args.featured === true)
        .matchingText(args.query ? String(args.query) : undefined)
        .sortBy(args.sort, 'rating')
        .take(limit),
    );
    if (!items.length && args.query) {
      items = await this.catalog.search(new ProductQueryBuilder().titleMatchingAnyWord(String(args.query)).take(limit));
    }
    return { count: items.length, products: items.map(productSummary) };
  }

  async getProductDetails(slug: string): Promise<ToolResult> {
    const p = await this.catalog.findBySlug(slug);
    if (!p) return { error: `No product found with slug "${slug}"` };
    return { ...productSummary(p), description: p.description, sizes: p.sizes.map(s => ({ size: s.size, stock: s.stock })) };
  }

  async listCategories(): Promise<ToolResult> {
    const cats = await this.catalog.categories();
    return { categories: cats.map(c => ({ name: c.name, products: c.count })) };
  }

  async getOrderStatus(args: { orderNumber?: string; email?: string }, ctx: ToolContext): Promise<ToolResult> {
    if (ctx.userId) {
      const order = args.orderNumber
        ? await this.orders.findByNumberForUser(String(args.orderNumber), ctx.userId)
        : await this.orders.latestForUser(ctx.userId);
      if (!order) return { error: args.orderNumber ? 'No order found matching those details.' : 'No orders found for your account.' };
      return { order: orderSummary(order) };
    }
    if (!args.orderNumber || !args.email) return { error: 'orderNumber and email are required to look up an order.' };
    const user = await this.users.findByEmail(String(args.email));
    if (!user) return { error: 'No order found matching that order number and email.' };
    const order = await this.orders.findByNumberForUser(String(args.orderNumber), String(user._id));
    if (!order) return { error: 'No order found matching those details.' };
    return { order: orderSummary(order) };
  }

  async getMyOrders(ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.userId) {
      return { error: 'The customer is not signed in. Ask them to sign in to view their orders, or provide an order number and email.' };
    }
    const orders = await this.orders.listForUser(ctx.userId, 5);
    return { count: orders.length, orders: orders.map(orderSummary) };
  }
}
