import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { agentToolDefs, ToolCtx, toolExecutors } from '../agent/tools';

/**
 * Helper to construct a standard text response format for MCP tools.
 */
const text = (data: any) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });

/**
 * Builds and registers tools for the Model Context Protocol (MCP) server.
 */
function buildServer() {
  const server = new McpServer({ name: 'storefront-mcp', version: '1.0.0' });

  server.registerTool('search_products', {
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
  }, async (args) => text(await toolExecutors.search_products(args, {})));

  server.registerTool('get_product_details', {
    title: 'Get product details',
    description: 'Full details for one product by slug: description, per-size stock, pricing, rating.',
    inputSchema: { slug: z.string().describe('Product slug, e.g. from search_products') },
  }, async (args) => text(await toolExecutors.get_product_details(args, {})));

  server.registerTool('list_categories', {
    title: 'List categories',
    description: 'All product categories with product counts.',
    inputSchema: {},
  }, async () => text(await toolExecutors.list_categories({}, {})));

  server.registerTool('get_order_status', {
    title: 'Get order status',
    description: 'Look up an order status and audit timeline. Requires the order number and the account email it was placed with.',
    inputSchema: {
      orderNumber: z.string().describe('Order number, e.g. SF-1234'),
      email: z.string().describe('Email of the account that placed the order'),
    },
  }, async (args) => text(await toolExecutors.get_order_status(args, {})));

  server.registerTool('get_store_info', {
    title: 'Get store info',
    description: 'STOREFRONT policies: shipping, payments, returns/refunds, coupons, sizing, support.',
    inputSchema: {},
  }, async () => text(await toolExecutors.get_store_info({}, {})));

  return server;
}

/**
 * Handles incoming HTTP POST requests to execute MCP tools.
 */
export async function handleMcpPost(req: Request, res: Response) {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on('close', () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req as any, res as any, req.body);
  } catch (e) {
    console.error('[mcp]', e);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  }
}

/**
 * Rejects non-POST requests to the MCP endpoint.
 */
export function handleMcpUnsupported(_req: Request, res: Response) {
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed. This MCP endpoint is stateless — use POST.' }, id: null });
}
