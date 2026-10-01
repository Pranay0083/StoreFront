import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentTools } from '../agent/agent.tools';

const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });

/** Builds a stateless MCP server exposing the read-only store tools. */
export function buildMcpServer(tools: AgentTools): McpServer {
  const server = new McpServer({ name: 'storefront-mcp', version: '1.0.0' });

  server.registerTool(
    'search_products',
    {
      title: 'Search products',
      description: 'Search the STOREFRONT catalog by text query, category, and price range. Prices are in INR.',
      inputSchema: {
        query: z.string().optional().describe('Free-text search over titles and descriptions'),
        category: z.string().optional().describe('Exact category, e.g. Men, Women, Footwear, Accessories'),
        minPrice: z.number().optional(),
        maxPrice: z.number().optional(),
        featured: z.boolean().optional(),
        sort: z.enum(['price-asc', 'price-desc', 'newest', 'rating']).optional(),
        limit: z.number().max(8).optional(),
      },
    },
    async args => text(await tools.searchProducts(args)),
  );

  server.registerTool(
    'get_product_details',
    {
      title: 'Get product details',
      description: 'Full details for one product by slug: description, per-size stock, pricing, rating.',
      inputSchema: { slug: z.string().describe('Product slug, e.g. from search_products') },
    },
    async args => text(await tools.getProductDetails(args.slug)),
  );

  server.registerTool(
    'list_categories',
    { title: 'List categories', description: 'All product categories with product counts.', inputSchema: {} },
    async () => text(await tools.listCategories()),
  );

  server.registerTool(
    'get_order_status',
    {
      title: 'Get order status',
      description: 'Look up an order status and audit timeline. Requires the order number and the account email it was placed with.',
      inputSchema: {
        orderNumber: z.string().describe('Order number, e.g. SF-1234'),
        email: z.string().describe('Email of the account that placed the order'),
      },
    },
    async args => text(await tools.getOrderStatus(args, {})),
  );

  server.registerTool(
    'get_store_info',
    {
      title: 'Get store info',
      description: 'STOREFRONT policies: shipping, payments, returns/refunds, coupons, sizing, support.',
      inputSchema: {},
    },
    async () => text(await tools.execute('get_store_info', {}, {})),
  );

  return server;
}
