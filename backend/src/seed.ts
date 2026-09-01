import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { env } from './config/env';
import { Coupon, Order, Product, Review, User } from './models';

const img = (id: string) => `https://images.unsplash.com/${id}?w=900&q=80&auto=format&fit=crop`;
const APPAREL = ['S', 'M', 'L', 'XL'];
const SHOES = ['UK 7', 'UK 8', 'UK 9', 'UK 10'];
const ONE = ['One Size'];

const sizes = (list: string[], stocks: number[]) => list.map((size, i) => ({ size, stock: stocks[i % stocks.length] }));

const PRODUCTS = [
  { title: 'Oxford Cotton Shirt', category: 'Men', price: 2499, compareAtPrice: 3299, featured: true, images: [img('photo-1603189343302-e603f7add05a'), img('photo-1611312449408-fcece27cdbb7')], sizes: sizes(APPAREL, [14, 22, 18, 9]), description: 'A crisp Oxford weave in pure long-staple cotton. Mother-of-pearl buttons, single-needle stitching, and a collar that holds its line from morning to midnight.' },
  { title: 'Merino Crewneck Sweater', category: 'Men', price: 3999, featured: true, images: [img('photo-1591047139829-d91aecb6caea')], sizes: sizes(APPAREL, [10, 16, 12, 4]), description: 'Extra-fine 19.5 micron merino, fully fashioned and garment-washed for a soft, structured drape.' },
  { title: 'Selvedge Denim Jeans', category: 'Men', price: 4599, compareAtPrice: 5499, images: [img('photo-1542272604-787c3835535d'), img('photo-1541099649105-f69ad21f3246')], sizes: sizes(APPAREL, [12, 20, 15, 8]), description: '14oz Japanese selvedge, sanforized. Ages beautifully — high contrast fades in six months of honest wear.' },
  { title: 'Unstructured Linen Blazer', category: 'Men', price: 7999, featured: true, images: [img('photo-1594938298603-c8148c4dae35')], sizes: sizes(APPAREL, [6, 9, 7, 3]), description: 'Half-canvassed, unlined linen blazer in a stone hue. Tailored in a relaxed silhouette for warm evenings.' },
  { title: 'Twill Overshirt', category: 'Men', price: 3299, images: [img('photo-1620012253295-c15cc3e65df4')], sizes: sizes(APPAREL, [11, 14, 10, 6]), description: 'A heavyweight cotton twill overshirt that works as a light jacket three seasons a year.' },
  { title: 'Breton Linen Shirt', category: 'Men', price: 2799, images: [img('photo-1596755094514-f87e34085b2c')], sizes: sizes(APPAREL, [13, 17, 11, 7]), description: 'Airy European flax, garment-dyed. Wrinkles are part of the charm.' },
  { title: 'Silk Slip Dress', category: 'Women', price: 6499, compareAtPrice: 7999, featured: true, images: [img('photo-1664076458686-3449062080ac'), img('photo-1515372039744-b8f02a3ae446')], sizes: sizes(APPAREL, [8, 12, 9, 4]), description: 'Bias-cut 22-momme mulberry silk with an adjustable strap. Falls like water, moves like light.' },
  { title: 'Wide-Leg Trousers', category: 'Women', price: 3899, featured: true, images: [img('photo-1594633312681-425c7b97ccd1')], sizes: sizes(APPAREL, [10, 15, 12, 6]), description: 'High-rise, floor-skimming trousers in a fluid crepe. Pressed front crease, invisible side zip.' },
  { title: 'Cashmere Cardigan', category: 'Women', price: 8999, images: [img('photo-1434389677669-e08b4cac3105')], sizes: sizes(APPAREL, [5, 8, 6, 2]), description: 'Grade-A Mongolian cashmere, 12-gauge knit. A lifetime piece with corozo buttons.' },
  { title: 'Pleated Midi Skirt', category: 'Women', price: 3499, images: [img('photo-1582142306909-195724d33ffc')], sizes: sizes(APPAREL, [9, 13, 10, 5]), description: 'Knife pleats in a satin-back crepe that catch the light with every step.' },
  { title: 'Double-Faced Wool Coat', category: 'Women', price: 12999, compareAtPrice: 15999, featured: true, images: [img('photo-1539533018447-63fcce2678e3')], sizes: sizes(APPAREL, [4, 6, 5, 2]), description: 'Hand-finished double-faced wool with a belted waist. The winter silhouette, perfected.' },
  { title: 'Ribbed Knit Top', category: 'Women', price: 1999, images: [img('photo-1496747611176-843222e1e57c')], sizes: sizes(APPAREL, [16, 20, 14, 8]), description: 'A second-skin ribbed knit in stretch modal. The foundation of every capsule wardrobe.' },
  { title: 'Court Leather Sneakers', category: 'Footwear', price: 5499, featured: true, images: [img('photo-1595950653106-6c9ebd614d3a'), img('photo-1560769629-975ec94e6a86')], sizes: sizes(SHOES, [9, 14, 11, 6]), description: 'Full-grain Italian leather on a cupsole. Minimal branding, maximal wear.' },
  { title: 'Suede Chelsea Boots', category: 'Footwear', price: 7499, images: [img('photo-1638247025967-b4e38f787b76')], sizes: sizes(SHOES, [7, 10, 8, 3]), description: 'Water-repellent suede, elastic gores, Goodyear-welted crepe sole.' },
  { title: 'Canvas High-Tops', category: 'Footwear', price: 2999, images: [img('photo-1600269452121-4f2416e55c28')], sizes: sizes(SHOES, [12, 16, 13, 9]), description: 'Vulcanized rubber, organic canvas, broken-in comfort from the first lace-up.' },
  { title: 'Suede Loafers', category: 'Footwear', price: 6299, compareAtPrice: 6999, images: [img('photo-1614252369475-531eba835eb1')], sizes: sizes(SHOES, [8, 11, 9, 4]), description: 'Unlined suede penny loafers with a hand-stitched apron. Wear sockless, live better.' },
  { title: 'Structured Leather Tote', category: 'Accessories', price: 8499, featured: true, images: [img('photo-1591561954557-26941169b49e'), img('photo-1584917865442-de89df76afd3')], sizes: sizes(ONE, [7]), description: 'Vegetable-tanned leather that patinas with you. Fits a 14" laptop and a week of ambition.' },
  { title: 'Hand-Rolled Silk Scarf', category: 'Accessories', price: 2299, images: [img('photo-1601924994987-69e26d50dc26')], sizes: sizes(ONE, [15]), description: 'A 90cm twill square, hand-rolled edges, archival print. Twelve ways to wear it.' },
  { title: 'Aviator Sunglasses', category: 'Accessories', price: 3499, images: [img('photo-1572635196237-14b3f281503f'), img('photo-1511499767150-a48a237f0083')], sizes: sizes(ONE, [11]), description: 'Titanium frame, CR-39 polarized lenses, 100% UV protection.' },
  { title: 'Minimal Automatic Watch', category: 'Accessories', price: 11999, compareAtPrice: 13999, images: [img('photo-1524592094714-0f0654e20314')], sizes: sizes(ONE, [4]), description: 'A 38mm automatic with a sapphire crystal and Horween leather strap. Quietly excellent.' },
  { title: 'Full-Grain Leather Belt', category: 'Accessories', price: 1799, images: [img('photo-1624222247344-550fb60583dc')], sizes: sizes(APPAREL, [10, 13, 11, 7]), description: 'A single strip of bridle leather with a solid brass buckle. Darkens gracefully.' },
  { title: 'Ribbed Wool Beanie', category: 'Accessories', price: 1299, images: [img('photo-1576871337622-98d48d1cf531')], sizes: sizes(ONE, [18]), description: 'Lambswool, knitted in a fisherman rib. The last beanie you will buy.' },
  { title: 'Leather Card Holder', category: 'Accessories', price: 1499, images: [img('photo-1627123424574-724758594e93')], sizes: sizes(ONE, [2]), description: 'Six cards, folded notes, nothing else. Saddle-stitched by hand.' },
  { title: 'Waxed Canvas Backpack', category: 'Accessories', price: 5999, images: [img('photo-1553062407-98eeb64c6a62')], sizes: sizes(ONE, [8]), description: 'Weatherproof waxed canvas, leather trim, 20L. Built for the daily carry decade.' },
];

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const rand = (n: number) => Math.floor(Math.random() * n);
const pick = <T,>(arr: T[]) => arr[rand(arr.length)];

async function seedAdmin() {
  const existing = await User.findOne({ email: env.ADMIN_EMAIL });
  if (!existing) {
    await User.create({ email: env.ADMIN_EMAIL, name: 'Store Admin', role: 'admin', passwordHash: await bcrypt.hash(env.ADMIN_PASSWORD, 10) });
    console.log('[seed] admin created');
  } else if (!(await bcrypt.compare(env.ADMIN_PASSWORD, existing.passwordHash))) {
    existing.passwordHash = await bcrypt.hash(env.ADMIN_PASSWORD, 10);
    await existing.save();
  }
}

async function seedCustomer(email: string, name: string, password: string) {
  let user = await User.findOne({ email });
  if (!user) user = await User.create({ email, name, passwordHash: await bcrypt.hash(password, 10) });
  return user;
}

/**
 * Seeds the database with an admin user, mock products, coupons, and historical demo orders.
 * Automatically skips seeding if the database is already populated.
 */
export async function seedIfNeeded() {
  await seedAdmin();
  const customer = await seedCustomer('customer@storefront.dev', 'Demo Customer', 'Customer@123');
  if (await Coupon.countDocuments() === 0) {
    await Coupon.insertMany([
      { code: 'WELCOME10', type: 'percent', value: 10, minSubtotal: 1000, maxDiscount: 500, active: true },
      { code: 'FLAT500', type: 'flat', value: 500, minSubtotal: 2999, active: true },
    ]);
    console.log('[seed] coupons created');
  }
  if (await Product.countDocuments() > 0) return;

  const products = await Product.insertMany(PRODUCTS.map(p => ({ ...p, slug: slugify(p.title) })));
  console.log(`[seed] ${products.length} products`);

  const buyers = [customer];
  for (let i = 1; i <= 4; i++) {
    buyers.push(await seedCustomer(`buyer${i}@demo.storefront.dev`, ['Aarav Shah', 'Meera Iyer', 'Kabir Rao', 'Ananya Das'][i - 1], 'Buyer@123'));
  }

  // Demo orders spread across the last 35 days to feed the dashboard aggregations.
  const now = Date.now();
  const orders: any[] = [];
  for (let i = 0; i < 110; i++) {
    const daysAgo = rand(35);
    const createdAt = new Date(now - daysAgo * 86_400_000 - rand(86_400_000));
    const buyer = pick(buyers);
    const nItems = 1 + rand(3);
    const items = [];
    for (let j = 0; j < nItems; j++) {
      const p: any = pick(products);
      items.push({ productId: p._id, title: p.title, image: p.images[0], price: p.price, size: pick(p.sizes as any[]).size, qty: 1 + rand(2), slug: p.slug });
    }
    const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
    const shipping = subtotal >= 2999 ? 0 : 99;
    const roll = Math.random();
    let path: string[];
    if (roll < 0.06) path = ['created'];
    else if (roll < 0.12) path = ['created', 'cancelled'];
    else if (roll < 0.16) path = ['created', 'paid', 'refunded'];
    else if (daysAgo > 7) path = ['created', 'paid', 'packed', 'shipped', 'delivered'];
    else if (daysAgo > 3) path = ['created', 'paid', 'packed', pick(['shipped', 'shipped', 'packed'])].filter((v, idx, a) => a.indexOf(v) === idx);
    else path = ['created', pick([...['paid', 'paid', 'packed'].slice(0, 2)])].filter((v, idx, a) => a.indexOf(v) === idx);

    const statusHistory = [];
    let prev: string | null = null;
    let t = createdAt.getTime();
    let paidAt: Date | undefined;
    for (const st of path) {
      statusHistory.push({ from: prev, to: st, by: prev === null ? `user:${buyer._id}` : 'system:seed', note: prev === null ? 'Order placed' : '', at: new Date(t) });
      if (st === 'paid') paidAt = new Date(t);
      prev = st;
      t += 3_600_000 * (4 + rand(20));
    }
    orders.push({
      orderNumber: `SF-${createdAt.getTime().toString(36).toUpperCase()}${100 + i}`,
      userId: buyer._id, items,
      address: { name: buyer.name, line1: `${10 + rand(90)} Residency Road`, city: pick(['Mumbai', 'Bengaluru', 'Delhi', 'Pune', 'Chennai']), state: pick(['MH', 'KA', 'DL', 'TN']), pincode: `5600${10 + rand(89)}`, phone: `98${10000000 + rand(89999999)}` },
      subtotal, shipping, total: subtotal + shipping,
      status: path[path.length - 1],
      statusHistory,
      payment: { provider: 'demo', status: paidAt ? 'captured' : 'pending', razorpayPaymentId: paidAt ? `demo_seed_${i}` : undefined },
      paidAt,
      createdAt, updatedAt: new Date(t),
    });
  }
  await Order.insertMany(orders);
  console.log(`[seed] ${orders.length} orders`);

  const comments = [
    'Exceptional quality — the fabric feels far above this price point.',
    'Fits true to size and the finishing is immaculate.',
    'Delivery was quick and the packaging felt premium.',
    'Subtle, versatile, and clearly built to last.',
    'Already ordered a second one in another colour.',
  ];
  for (const p of products.slice(0, 12)) {
    const reviewers = buyers.slice(0, 2 + rand(3));
    let total = 0;
    for (const b of reviewers) {
      const rating = 4 + rand(2);
      total += rating;
      await Review.create({ productId: p._id, userId: b._id, userName: b.name, rating, comment: pick(comments) });
    }
    p.rating = Math.round((total / reviewers.length) * 10) / 10;
    p.numReviews = reviewers.length;
    await p.save();
  }
  console.log('[seed] reviews done');
}
