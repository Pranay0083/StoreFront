import { Order, Product, User } from '../models';

export interface ToolCtx {
  userId?: string;
  userEmail?: string;
}

const productSummary = (p: any) => ({
  title: p.title,
  slug: p.slug,
  url: `/products/${p.slug}`,
  price: p.price,
  compareAtPrice: p.compareAtPrice || null,
  category: p.category,
  rating: p.rating,
  numReviews: p.numReviews,
  sizesInStock: (p.sizes || []).filter((s: any) => s.stock > 0).map((s: any) => s.size),
});

const orderSummary = (o: any) => ({
  orderNumber: o.orderNumber,
  status: o.status,
  total: o.total,
  placedAt: o.createdAt,
  items: (o.items || []).map((i: any) => ({ title: i.title, size: i.size, qty: i.qty, price: i.price })),
  timeline: (o.statusHistory || []).map((h: any) => ({ to: h.to, at: h.at, note: h.note })),
});

export const STORE_INFO = {
  name: 'STOREFRONT',
  tagline: 'Considered clothing',
  currency: 'INR (₹)',
  shipping: 'Free shipping on orders of ₹2,999 or more. Below that, a flat ₹99 shipping fee applies. Orders are packed within 24 hours of payment and typically delivered in 3-5 business days.',
  payments: 'We accept Razorpay (cards, UPI, netbanking). A DEMO PAY option is available in demo mode which exercises the exact same order flow.',
  returns: 'Orders can be cancelled any time before they are shipped. After delivery, refunds can be requested within 7 days — refunds are processed to the original payment method. Every order follows an audited lifecycle: created → paid → packed → shipped → delivered.',
  coupons: 'Coupon WELCOME10 gives 10% off (max ₹500) on orders above ₹1,000. Apply it at checkout.',
  sizes: 'Apparel is available in XS-XXL depending on the product; footwear in UK 6-11. Stock per size is shown on each product page.',
  support: 'Track orders under "My orders" after signing in. This AI assistant can also check order status for you.',
};

export const toolExecutors: Record<string, (args: any, ctx: ToolCtx) => Promise<any>> = {
  async search_products(args) {
    const filter: any = {};
    if (args.category) filter.category = args.category;
    if (args.query) filter.$text = { $search: String(args.query) };
    if (args.minPrice || args.maxPrice) {
      filter.price = {};
      if (args.minPrice) filter.price.$gte = Number(args.minPrice);
      if (args.maxPrice) filter.price.$lte = Number(args.maxPrice);
    }
    if (args.featured === true) filter.featured = true;
    const sortMap: Record<string, any> = {
      'price-asc': { price: 1 }, 'price-desc': { price: -1 },
      newest: { createdAt: -1 }, rating: { rating: -1 },
    };
    const limit = Math.min(8, Number(args.limit) || 5);
    let items = await Product.find(filter).sort(sortMap[args.sort] || { rating: -1 }).limit(limit).lean();
    if (!items.length && args.query) {
      items = await Product.find({ title: { $regex: String(args.query).split(/\s+/).join('|'), $options: 'i' } }).limit(limit).lean();
    }
    return { count: items.length, products: items.map(productSummary) };
  },

  async get_product_details(args) {
    const p: any = await Product.findOne({ slug: args.slug }).lean();
    if (!p) return { error: `No product found with slug "${args.slug}"` };
    return {
      ...productSummary(p),
      description: p.description,
      sizes: (p.sizes || []).map((s: any) => ({ size: s.size, stock: s.stock })),
    };
  },

  async list_categories() {
    const cats = await Product.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    return { categories: cats.map(c => ({ name: c._id, products: c.count })) };
  },

  async get_order_status(args, ctx) {
    const filter: any = {};
    if (args.orderNumber) filter.orderNumber = String(args.orderNumber).toUpperCase();
    if (ctx.userId) {
      filter.userId = ctx.userId;
      if (!args.orderNumber) {
        const latest = await Order.findOne({ userId: ctx.userId }).sort({ createdAt: -1 }).lean();
        return latest ? { order: orderSummary(latest) } : { error: 'No orders found for your account.' };
      }
    } else {
      if (!args.orderNumber || !args.email) return { error: 'orderNumber and email are required to look up an order.' };
      const user = await User.findOne({ email: String(args.email).toLowerCase() }).lean();
      if (!user) return { error: 'No order found matching that order number and email.' };
      filter.userId = user._id;
    }
    const order = await Order.findOne(filter).lean();
    if (!order) return { error: 'No order found matching those details.' };
    return { order: orderSummary(order) };
  },

  async get_my_orders(_args, ctx) {
    if (!ctx.userId) return { error: 'The customer is not signed in. Ask them to sign in to view their orders, or provide an order number and email.' };
    const orders = await Order.find({ userId: ctx.userId }).sort({ createdAt: -1 }).limit(5).lean();
    return { count: orders.length, orders: orders.map(orderSummary) };
  },

  async get_store_info() {
    return STORE_INFO;
  },
};

export const agentToolDefs = [
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
          minPrice: { type: 'number' },
          maxPrice: { type: 'number' },
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
      description: 'Look up the status and timeline of an order. If the customer is signed in, only orderNumber is needed (or omit it for their latest order).',
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
