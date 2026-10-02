import { describe, expect, it } from 'vitest';
import { ADDRESS, createProduct, createUser } from './helpers/factories';
import { API, bearer, useTestApp } from './helpers/app';

const t = useTestApp();

describe('agent tools', () => {
  it('searches the catalog with a title fallback when full-text search misses', async () => {
    await createProduct({ title: 'Silk Slip Dress', category: 'Women', rating: 4.9 });
    await createProduct({ title: 'Oxford Shirt', category: 'Men', rating: 4.1 });
    const tools = t.container.services.agentTools;

    const byCategory = await tools.execute('search_products', { category: 'Women' }, {});
    expect(byCategory).toMatchObject({ count: 1, products: [expect.objectContaining({ title: 'Silk Slip Dress', url: '/products/silk-slip-dress' })] });

    const fallback = await tools.execute('search_products', { query: 'oxf' }, {});
    expect(fallback).toMatchObject({ count: 1, products: [expect.objectContaining({ title: 'Oxford Shirt' })] });
  });

  it('looks up orders for signed-in customers and guests with matching email', async () => {
    const buyer = await createUser({ email: 'kabir@test.dev' });
    const product = await createProduct();
    const order = (await t.http().post(`${API}/orders`).set(bearer(buyer.token)).send({ address: ADDRESS, items: [{ productId: String(product._id), size: 'M', qty: 1 }] }).expect(201)).body;
    const tools = t.container.services.agentTools;

    expect(await tools.execute('get_order_status', {}, { userId: buyer.id })).toMatchObject({ order: { orderNumber: order.orderNumber, status: 'created' } });
    expect(await tools.execute('get_order_status', { orderNumber: order.orderNumber.toLowerCase(), email: 'KABIR@test.dev' }, {})).toMatchObject({
      order: { orderNumber: order.orderNumber },
    });
    expect(await tools.execute('get_order_status', { orderNumber: order.orderNumber, email: 'someone@else.dev' }, {})).toHaveProperty('error');
    expect(await tools.execute('get_my_orders', {}, {})).toHaveProperty('error');
    expect(await tools.execute('nope', {}, {})).toEqual({ error: 'Unknown tool nope' });
  });
});

describe('agent http api', () => {
  it('returns 503 when no LLM key is configured and empty history for new sessions', async () => {
    const res = await t.http().post(`${API}/agent/chat`).send({ sessionId: 'session-12345', message: 'hi' }).expect(503);
    expect(res.body.error).toMatch(/not configured/);
    expect((await t.http().get(`${API}/agent/history?sessionId=session-12345`).expect(200)).body).toEqual({ messages: [] });
  });
});

describe('mcp endpoint', () => {
  const rpc = (body: object) =>
    t.http().post(`${API}/mcp`).set('Accept', 'application/json, text/event-stream').set('Content-Type', 'application/json').send(body);

  it('lists tools and executes them statelessly', async () => {
    await createProduct({ title: 'Canvas Sneakers', category: 'Footwear' });
    const list = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }).expect(200);
    expect(list.body.result.tools.map((tool: { name: string }) => tool.name).sort()).toEqual([
      'get_order_status',
      'get_product_details',
      'get_store_info',
      'list_categories',
      'search_products',
    ]);

    const call = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_categories', arguments: {} } }).expect(200);
    expect(JSON.parse(call.body.result.content[0].text)).toEqual({ categories: [{ name: 'Footwear', products: 1 }] });

    await t.http().get(`${API}/mcp`).expect(405);
  });
});

describe('agent money formatting', () => {
  it('reports prices in rupees and filters by rupee price ranges', async () => {
    await createProduct({ title: 'Linen Shirt', price: 249_900, compareAtPrice: 329_900 });
    await createProduct({ title: 'Wool Coat', price: 1_299_900 });
    const result = await t.container.services.agentTools.execute('search_products', { maxPrice: 5000 }, {});
    expect(result).toMatchObject({ count: 1, products: [{ title: 'Linen Shirt', price: '₹2,499', compareAtPrice: '₹3,299' }] });
  });
});
