import { rupeesToPaise as inr, type Paise } from '@storefront/contracts';

/** The four departments the storefront navigation is built on. */
export const DEMO_CATEGORIES = ['Men', 'Women', 'Footwear', 'Accessories'] as const;
export type DemoCategory = (typeof DEMO_CATEGORIES)[number];

export interface DemoProduct {
  title: string;
  category: DemoCategory;
  price: Paise;
  compareAtPrice?: Paise;
  featured?: boolean;
  /** Every photo has been checked by eye to show this product; no photo is shared between products. */
  images: string[];
  sizes: Array<{ size: string; stock: number }>;
  description: string;
}

const img = (id: string) => `https://images.unsplash.com/${id}?w=900&q=80&auto=format&fit=crop`;
const APPAREL = ['S', 'M', 'L', 'XL'];
const SHOES = ['UK 7', 'UK 8', 'UK 9', 'UK 10'];
const ONE = ['One Size'];

const sizes = (list: string[], stocks: number[]) => list.map((size, i) => ({ size, stock: stocks[i % stocks.length] }));

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

/** The demo catalogue. Slugs, prices and copy are relied on by promotions, tests and e2e. */
export const DEMO_PRODUCTS: DemoProduct[] = [
  // ── Original catalogue ────────────────────────────────────────────────────────────────────────
  {
    title: 'Oxford Cotton Shirt',
    category: 'Men',
    price: inr(2499),
    compareAtPrice: inr(3299),
    featured: true,
    images: [img('photo-1604695573706-53170668f6a6'), img('photo-1589310243389-96a5483213a8')],
    sizes: sizes(APPAREL, [14, 22, 18, 9]),
    description:
      'A crisp Oxford weave in pure long-staple cotton. Mother-of-pearl buttons, single-needle stitching, and a collar that holds its line from morning to midnight.',
  },
  {
    title: 'Merino Crewneck Sweater',
    category: 'Men',
    price: inr(3999),
    featured: true,
    images: [img('photo-1604573824419-289a9a10672c')],
    sizes: sizes(APPAREL, [10, 16, 12, 4]),
    description: 'Extra-fine 19.5 micron merino, fully fashioned and garment-washed for a soft, structured drape.',
  },
  {
    title: 'Selvedge Denim Jeans',
    category: 'Men',
    price: inr(4599),
    compareAtPrice: inr(5499),
    images: [img('photo-1542272604-787c3835535d'), img('photo-1604176354204-9268737828e4')],
    sizes: sizes(APPAREL, [12, 20, 15, 8]),
    description: '14oz Japanese selvedge, sanforized. Ages beautifully — high contrast fades in six months of honest wear.',
  },
  {
    title: 'Unstructured Linen Blazer',
    category: 'Men',
    price: inr(7999),
    featured: true,
    images: [img('photo-1732384069249-fb208dcef49c')],
    sizes: sizes(APPAREL, [6, 9, 7, 3]),
    description: 'Half-canvassed, unlined linen blazer in a stone hue. Tailored in a relaxed silhouette for warm evenings.',
  },
  {
    title: 'Twill Overshirt',
    category: 'Men',
    price: inr(3299),
    images: [img('photo-1586689311267-e88bb0509995')],
    sizes: sizes(APPAREL, [11, 14, 10, 6]),
    description: 'A heavyweight cotton twill overshirt that works as a light jacket three seasons a year.',
  },
  {
    title: 'Breton Linen Shirt',
    category: 'Men',
    price: inr(2799),
    images: [img('photo-1603984103828-0301b174469d')],
    sizes: sizes(APPAREL, [13, 17, 11, 7]),
    description: 'Airy European flax, garment-dyed. Wrinkles are part of the charm.',
  },
  {
    title: 'Silk Slip Dress',
    category: 'Women',
    price: inr(6499),
    compareAtPrice: inr(7999),
    featured: true,
    images: [img('photo-1664076458686-3449062080ac')],
    sizes: sizes(APPAREL, [8, 12, 9, 4]),
    description: 'Bias-cut 22-momme mulberry silk with an adjustable strap. Falls like water, moves like light.',
  },
  {
    title: 'Wide-Leg Trousers',
    category: 'Women',
    price: inr(3899),
    featured: true,
    images: [img('photo-1687825515654-23620796760c')],
    sizes: sizes(APPAREL, [10, 15, 12, 6]),
    description: 'High-rise, floor-skimming trousers in a fluid crepe. Pressed front crease, invisible side zip.',
  },
  {
    title: 'Cashmere Cardigan',
    category: 'Women',
    price: inr(8999),
    images: [img('photo-1579206464424-7e43a81cadc1')],
    sizes: sizes(APPAREL, [5, 8, 6, 2]),
    description: 'Grade-A Mongolian cashmere, 12-gauge knit. A lifetime piece with corozo buttons.',
  },
  {
    title: 'Pleated Midi Skirt',
    category: 'Women',
    price: inr(3499),
    images: [img('photo-1762342676177-33b08c2b724e')],
    sizes: sizes(APPAREL, [9, 13, 10, 5]),
    description: 'Knife pleats in a satin-back crepe that catch the light with every step.',
  },
  {
    title: 'Double-Faced Wool Coat',
    category: 'Women',
    price: inr(12999),
    compareAtPrice: inr(15999),
    featured: true,
    images: [img('photo-1539533018447-63fcce2678e3')],
    sizes: sizes(APPAREL, [4, 6, 5, 2]),
    description: 'Hand-finished double-faced wool with a belted waist. The winter silhouette, perfected.',
  },
  {
    title: 'Ribbed Knit Top',
    category: 'Women',
    price: inr(1999),
    images: [img('photo-1789110855604-b693bd403e43')],
    sizes: sizes(APPAREL, [16, 20, 14, 8]),
    description: 'A second-skin ribbed knit in stretch modal. The foundation of every capsule wardrobe.',
  },
  {
    title: 'Court Leather Sneakers',
    category: 'Footwear',
    price: inr(5499),
    featured: true,
    images: [img('photo-1608231387042-66d1773070a5')],
    sizes: sizes(SHOES, [9, 14, 11, 6]),
    description: 'Full-grain Italian leather on a cupsole. Minimal branding, maximal wear.',
  },
  {
    title: 'Suede Chelsea Boots',
    category: 'Footwear',
    price: inr(7499),
    images: [img('photo-1608629601270-a0007becead3')],
    sizes: sizes(SHOES, [7, 10, 8, 3]),
    description: 'Water-repellent suede, elastic gores, Goodyear-welted crepe sole.',
  },
  {
    title: 'Canvas High-Tops',
    category: 'Footwear',
    price: inr(2999),
    images: [img('photo-1607522370275-f14206abe5d3')],
    sizes: sizes(SHOES, [12, 16, 13, 9]),
    description: 'Vulcanized rubber, organic canvas, broken-in comfort from the first lace-up.',
  },
  {
    title: 'Suede Loafers',
    category: 'Footwear',
    price: inr(6299),
    compareAtPrice: inr(6999),
    images: [img('photo-1576792741377-eb0f4f6d1a47')],
    sizes: sizes(SHOES, [8, 11, 9, 4]),
    description: 'Unlined suede penny loafers with a hand-stitched apron. Wear sockless, live better.',
  },
  {
    title: 'Structured Leather Tote',
    category: 'Accessories',
    price: inr(8499),
    featured: true,
    images: [img('photo-1624687943971-e86af76d57de')],
    sizes: sizes(ONE, [7]),
    description: 'Vegetable-tanned leather that patinas with you. Fits a 14" laptop and a week of ambition.',
  },
  {
    title: 'Hand-Rolled Silk Scarf',
    category: 'Accessories',
    price: inr(2299),
    images: [img('photo-1777795530497-205664bbd965')],
    sizes: sizes(ONE, [15]),
    description: 'A 90cm twill square, hand-rolled edges, archival print. Twelve ways to wear it.',
  },
  {
    title: 'Aviator Sunglasses',
    category: 'Accessories',
    price: inr(3499),
    images: [img('photo-1589642380614-4a8c2147b857'), img('photo-1567473810954-507d59716c25')],
    sizes: sizes(ONE, [11]),
    description: 'Titanium frame, CR-39 polarized lenses, 100% UV protection.',
  },
  {
    title: 'Minimal Automatic Watch',
    category: 'Accessories',
    price: inr(11999),
    compareAtPrice: inr(13999),
    images: [img('photo-1524592094714-0f0654e20314')],
    sizes: sizes(ONE, [4]),
    description: 'A 38mm automatic with a sapphire crystal and Horween leather strap. Quietly excellent.',
  },
  {
    title: 'Full-Grain Leather Belt',
    category: 'Accessories',
    price: inr(1799),
    images: [img('photo-1624222247344-550fb60583dc')],
    sizes: sizes(APPAREL, [10, 13, 11, 7]),
    description: 'A single strip of bridle leather with a solid brass buckle. Darkens gracefully.',
  },
  {
    title: 'Ribbed Wool Beanie',
    category: 'Accessories',
    price: inr(1299),
    images: [img('photo-1618354691792-d1d42acfd860')],
    sizes: sizes(ONE, [18]),
    description: 'Lambswool, knitted in a fisherman rib. The last beanie you will buy.',
  },
  {
    title: 'Leather Card Holder',
    category: 'Accessories',
    price: inr(1499),
    images: [img('photo-1601592996763-f05c9c80a7f1')],
    sizes: sizes(ONE, [2]),
    description: 'Six cards, folded notes, nothing else. Saddle-stitched by hand.',
  },
  {
    title: 'Waxed Canvas Backpack',
    category: 'Accessories',
    price: inr(5999),
    images: [img('photo-1553062407-98eeb64c6a62')],
    sizes: sizes(ONE, [8]),
    description: 'Weatherproof waxed canvas, leather trim, 20L. Built for the daily carry decade.',
  },
];
