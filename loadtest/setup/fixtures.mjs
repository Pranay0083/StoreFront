// Prepares data for the stateful scenarios. Usage: node loadtest/setup/fixtures.mjs <checkout|webhooks>
import {
  ADDRESS,
  adminToken,
  call,
  createProduct,
  idempotencyKey,
  inBatches,
  mongo,
  registerBuyers,
  transactionCounters,
  writeData,
} from './lib.mjs';

const mode = process.argv[2];
const run = Date.now().toString(36);
const admin = await adminToken();

if (mode === 'snapshot') {
  // k6 copies setup() data into every VU, so the catalog is handed over as a file read once into a SharedArray.
  const snapshot = mongo(`
    const products = db.products.find({}, { slug: 1, title: 1, category: 1, sizes: 1 }).toArray().map(p => ({
      id: String(p._id), slug: p.slug, title: p.title, category: p.category,
      sizes: p.sizes.filter(s => s.stock > 0).map(s => s.size),
    }));
    print(JSON.stringify({ products, categories: db.products.distinct('category') }));
  `);
  writeData('catalog.json', snapshot);
  console.log(`catalog snapshot: ${snapshot.products.length} products, ${snapshot.categories.length} categories`);
} else if (mode === 'catalog') {
  // The demo seed has two dozen products; grow it so caches and indexes see a realistic key space.
  const count = Number(process.env.CATALOG_SIZE || 1000);
  const adjectives = [
    'Relaxed',
    'Tailored',
    'Washed',
    'Heavyweight',
    'Organic',
    'Merino',
    'Linen',
    'Selvedge',
    'Brushed',
    'Cropped',
    'Pleated',
    'Quilted',
  ];
  const nouns = {
    Men: ['Oxford Shirt', 'Chino', 'Overshirt', 'Polo', 'Crewneck', 'Field Jacket', 'Cargo Pant'],
    Women: ['Wrap Dress', 'Midi Skirt', 'Blouse', 'Cardigan', 'Wide-Leg Trouser', 'Slip Dress', 'Knit Top'],
    Footwear: ['Derby', 'Loafer', 'Runner', 'Chelsea Boot', 'Canvas Sneaker', 'Sandal'],
    Accessories: ['Tote', 'Belt', 'Beanie', 'Scarf', 'Card Holder', 'Cap', 'Sunglasses'],
  };
  const categories = Object.keys(nouns);
  const created = await inBatches([...Array(count).keys()], 20, async i => {
    const category = categories[i % categories.length];
    const sizes =
      category === 'Footwear' ? ['UK 7', 'UK 8', 'UK 9', 'UK 10'] : category === 'Accessories' ? ['One Size'] : ['S', 'M', 'L', 'XL'];
    const title = `${adjectives[i % adjectives.length]} ${nouns[category][Math.floor(i / 4) % nouns[category].length]} ${run}-${i}`;
    return call('POST', '/products', {
      token: admin,
      body: {
        title,
        description: `${title} — load-test catalog item.`,
        category,
        price: 49_900 + ((i * 7919) % 90) * 10_000,
        images: ['https://images.unsplash.com/photo-1521572163474-6864f9cf17ab'],
        sizes: sizes.map((size, k) => ({ size, stock: (i + k) % 9 === 0 ? 0 : 20 + ((i * 31 + k) % 80) })),
        featured: i % 25 === 0,
      },
    });
  });
  console.log(`catalog fixtures: created ${created.length} products`);
} else if (mode === 'checkout') {
  const stock = Number(process.env.HOT_STOCK || 50);
  const buyers = Number(process.env.BUYERS || 300);
  const product = await createProduct(admin, `Loadtest Hot Drop ${run}`, stock);
  const tokens = await registerBuyers(run, buyers);
  writeData('checkout.json', { run, stock, productId: product._id, size: 'M', tokens, transactions: transactionCounters() });
  console.log(`checkout fixtures: ${tokens.length} buyers racing for ${stock} units of ${product.slug}`);
} else if (mode === 'webhooks') {
  const orders = Number(process.env.WEBHOOK_ORDERS || 150);
  const product = await createProduct(admin, `Loadtest Webhook Tee ${run}`, 100_000);
  const tokens = await registerBuyers(run, Math.min(orders, 50));
  const created = await inBatches([...Array(orders).keys()], 20, async i =>
    call('POST', '/orders', {
      token: tokens[i % tokens.length],
      headers: idempotencyKey(),
      body: { items: [{ productId: product._id, size: 'M', qty: 1 }], address: ADDRESS },
    }),
  );
  // Demo mode has no provider order ids, so stamp Razorpay-style ids the webhooks can address.
  const pairs = created.map((o, i) => [o._id, `order_lt${run}${i}`]);
  const result = mongo(`
    const pairs = ${JSON.stringify(pairs)};
    let n = 0;
    for (const [id, gw] of pairs) n += db.orders.updateOne({ _id: ObjectId(id) }, { $set: { 'payment.razorpayOrderId': gw } }).modifiedCount;
    print(JSON.stringify({ n }));
  `);
  writeData('webhooks.json', {
    run,
    transactions: transactionCounters(),
    productId: product._id,
    orders: pairs.map(([orderId, gatewayOrderId]) => ({ orderId, gatewayOrderId })),
  });
  console.log(`webhook fixtures: ${result.n} orders addressable by gateway order id`);
} else {
  console.error('usage: fixtures.mjs <checkout|webhooks>');
  process.exit(1);
}
