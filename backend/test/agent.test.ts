import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../src/modules/agent/tools';
import { ADDRESS, createProduct, createUser } from './helpers/factories';
import { API, bearer, useTestApp } from './helpers/app';

const t = useTestApp();

const guest: ToolContext = { user: null, channel: 'widget', cart: [] };

describe('tool registry', () => {
  it('searches the catalog with a title fallback when full-text search misses', async () => {
    await createProduct({ title: 'Silk Slip Dress', category: 'Women', rating: 4.9 });
    await createProduct({ title: 'Oxford Shirt', category: 'Men', rating: 4.1 });
    const tools = t.container.services.agentTools;

    const byCategory = await tools.execute('search_products', { category: 'Women' }, guest);
    expect(byCategory.result).toMatchObject({
      count: 1,
      products: [expect.objectContaining({ title: 'Silk Slip Dress', url: '/products/silk-slip-dress' })],
    });
    const fallback = await tools.execute('search_products', '{"query":"oxf"}', guest);
    expect(fallback.result).toMatchObject({ count: 1, products: [expect.objectContaining({ title: 'Oxford Shirt' })] });
  });

  it('validates arguments, rejects unknown tools and hides customer tools from guests', async () => {
    const tools = t.container.services.agentTools;
    expect(await tools.execute('nope', {}, guest)).toEqual({ ok: false, result: { error: 'Unknown tool nope' } });
    expect((await tools.execute('search_products', { limit: 99 }, guest)).result).toMatchObject({ error: 'Invalid arguments' });
    expect((await tools.execute('search_products', '{oops', guest)).result).toEqual({ error: 'Tool arguments were not valid JSON' });
    expect((await tools.execute('get_my_orders', {}, guest)).result.error).toMatch(/signed in/);

    const guestTools = tools.definitions(guest).map(d => d.name);
    expect(guestTools).not.toContain('add_to_cart');
    expect(guestTools).toContain('get_best_price');
    const { user } = await createUser();
    const customer = {
      ...guest,
      user: { id: String(user._id), email: user.email, name: user.name, role: 'customer' as const, permissions: [] },
    };
    expect(tools.definitions(customer).map(d => d.name)).toEqual(expect.arrayContaining(['add_to_cart', 'cancel_order', 'request_refund']));
    const search = tools.definitions(guest).find(d => d.name === 'search_products')!;
    expect(search.parameters).toMatchObject({ type: 'object', properties: { maxPrice: { type: 'number' } } });
  });

  it('looks up orders for signed-in customers and guests with matching email', async () => {
    const buyer = await createUser({ email: 'kabir@test.dev' });
    const product = await createProduct();
    const order = (
      await t
        .http()
        .post(`${API}/orders`)
        .set(bearer(buyer.token))
        .send({ address: ADDRESS, items: [{ productId: String(product._id), size: 'M', qty: 1 }] })
        .expect(201)
    ).body;
    const tools = t.container.services.agentTools;
    const me = { ...guest, user: { id: buyer.id, email: buyer.user.email, name: 'K', role: 'customer' as const, permissions: [] } };

    expect((await tools.execute('get_order_status', {}, me)).result).toMatchObject({
      order: { orderNumber: order.orderNumber, status: 'created' },
    });
    expect(
      (await tools.execute('get_order_status', { orderNumber: order.orderNumber.toLowerCase(), email: 'KABIR@test.dev' }, guest)).result,
    ).toMatchObject({
      order: { orderNumber: order.orderNumber },
    });
    expect((await tools.execute('get_order_status', { orderNumber: order.orderNumber, email: 'someone@else.dev' }, guest)).ok).toBe(false);
  });

  it('reports prices in rupees and prices a bag through the promotion engine', async () => {
    const shirt = await createProduct({ title: 'Linen Shirt', price: 249_900, compareAtPrice: 329_900 });
    await createProduct({ title: 'Wool Coat', price: 1_299_900 });
    const tools = t.container.services.agentTools;
    expect((await tools.execute('search_products', { maxPrice: 5000 }, guest)).result).toMatchObject({
      count: 1,
      products: [{ title: 'Linen Shirt', price: '₹2,499', compareAtPrice: '₹3,299' }],
    });
    const quote = await tools.execute('get_best_price', {}, { ...guest, cart: [{ productId: String(shirt._id), size: 'M', qty: 2 }] });
    expect(quote.result).toMatchObject({ listSubtotal: '₹4,998', total: '₹4,998', shipping: 'Free' });
    expect((await tools.execute('get_best_price', {}, guest)).result.error).toMatch(/empty/);
    expect((await tools.execute('suggest_bundles', { slug: 'linen-shirt' }, guest)).result).toMatchObject({
      product: { slug: 'linen-shirt' },
      offers: [],
    });
  });
});

describe('agent http api', () => {
  it('returns 503 when no model is configured and empty history for new sessions', async () => {
    const res = await t.http().post(`${API}/agent/chat`).send({ sessionId: 'session-12345', message: 'hi' }).expect(503);
    expect(res.body.error).toMatch(/not configured/);
    expect((await t.http().get(`${API}/agent/history?sessionId=session-12345`).expect(200)).body).toEqual({ messages: [] });
  });
});

describe('mcp endpoint', () => {
  const rpc = (body: object) =>
    t.http().post(`${API}/mcp`).set('Accept', 'application/json, text/event-stream').set('Content-Type', 'application/json').send(body);

  it('lists the anonymous read tools from the registry and executes them statelessly', async () => {
    await createProduct({ title: 'Canvas Sneakers', category: 'Footwear' });
    const list = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }).expect(200);
    expect(list.body.result.tools.map((tool: { name: string }) => tool.name).sort()).toEqual([
      'get_best_price',
      'get_order_status',
      'get_product_details',
      'get_store_info',
      'list_categories',
      'search_products',
      'suggest_bundles',
    ]);

    const call = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_categories', arguments: {} } }).expect(200);
    expect(JSON.parse(call.body.result.content[0].text)).toEqual({ categories: [{ name: 'Footwear', products: 1 }] });

    const missing = await rpc({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'get_product_details', arguments: { slug: 'nope' } },
    }).expect(200);
    expect(missing.body.result.isError).toBe(true);
    await t.http().get(`${API}/mcp`).expect(405);
  });
});
