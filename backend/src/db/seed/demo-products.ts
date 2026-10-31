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
const APPAREL_XS = ['XS', 'S', 'M', 'L', 'XL'];
const APPAREL_XXL = ['S', 'M', 'L', 'XL', 'XXL'];
const SHOES = ['UK 7', 'UK 8', 'UK 9', 'UK 10'];
const SHOES_FULL = ['UK 6', 'UK 7', 'UK 8', 'UK 9', 'UK 10', 'UK 11'];
const ONE = ['One Size'];

const sizes = (list: string[], stocks: number[]) => list.map((size, i) => ({ size, stock: stocks[i % stocks.length] }));

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

/**
 * The demo catalogue. The first 24 entries are the original launch catalogue (their slugs, prices and
 * copy are relied on by promotions, tests and e2e); later entries are additive and are topped up into
 * existing stores by slug.
 */
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

  // ── Men ───────────────────────────────────────────────────────────────────────────────────────
  {
    title: 'Heavyweight Cotton Tee',
    category: 'Men',
    price: inr(1299),
    images: [img('photo-1581655353564-df123a1eb820'), img('photo-1521572163474-6864f9cf17ab')],
    sizes: sizes(APPAREL_XXL, [18, 26, 24, 15, 6]),
    description:
      'A dense 240gsm combed-cotton jersey, knitted and garment-washed in Tiruppur. Boxy through the body with a thick ribbed collar that keeps its shape wash after wash.',
  },
  {
    title: 'Garment-Dyed Cotton Tee',
    category: 'Men',
    price: inr(1499),
    images: [img('photo-1562157873-818bc0726f68')],
    sizes: sizes(APPAREL_XXL, [14, 22, 19, 11, 3]),
    description:
      'Organic 200gsm cotton from Madhya Pradesh, dyed after sewing so every seam takes the colour a little differently. Regular fit, slightly dropped shoulder.',
  },
  {
    title: 'Breton Stripe Tee',
    category: 'Men',
    price: inr(1799),
    images: [img('photo-1591224615614-e300d72e37c5')],
    sizes: sizes(APPAREL, [9, 15, 12, 5]),
    description:
      'Yarn-dyed black-and-ecru stripes on a 220gsm cotton interlock that drapes rather than clings. Regular fit, crew neck, made in Tiruppur.',
  },
  {
    title: 'Brushed Flannel Check Shirt',
    category: 'Men',
    price: inr(2999),
    images: [img('photo-1611312449412-6cefac5dc3e4')],
    sizes: sizes(APPAREL_XXL, [7, 12, 10, 6, 2]),
    description:
      'A 6oz double-brushed cotton flannel in a charcoal buffalo check, woven in Portugal and cut in Bengaluru. Relaxed fit, two flap pockets, horn-effect buttons.',
  },
  {
    title: 'Leather Biker Jacket',
    category: 'Men',
    price: inr(18999),
    compareAtPrice: inr(22999),
    images: [img('photo-1551028719-00167b16eac5')],
    sizes: sizes(APPAREL, [3, 5, 4, 1]),
    description:
      'Black 0.8mm lambskin tanned in Kanpur, with an asymmetric brass zip, quilted shoulder panels and a cotton twill lining. Cut close; size up to wear a knit underneath.',
  },
  {
    title: 'Denim Trucker Jacket',
    category: 'Men',
    price: inr(5499),
    images: [img('photo-1495105787522-5334e3ffa0ef')],
    sizes: sizes(APPAREL, [8, 13, 11, 6]),
    description:
      'A 12oz light-wash denim from Ahmedabad, cut in the classic trucker shape with pleated chest pockets, adjustable waist tabs and copper shank buttons.',
  },
  {
    title: 'Tapered Wool Trousers',
    category: 'Men',
    price: inr(4999),
    images: [img('photo-1584865288642-42078afe6942')],
    sizes: sizes(APPAREL, [6, 11, 9, 4]),
    description:
      'Tropical-weight 230gsm Italian wool, half-lined, with a single forward pleat and a taper that stops just above the shoe. Side adjusters instead of belt loops.',
  },
  {
    title: 'Khadi Band-Collar Shirt',
    category: 'Men',
    price: inr(2299),
    images: [img('photo-1713881587420-113c1c43e28a')],
    sizes: sizes(APPAREL_XXL, [9, 14, 12, 7, 2]),
    description:
      'Hand-spun, handloom khadi from a weavers’ cooperative in Andhra Pradesh, left undyed. Band collar, short sleeves, a relaxed fit that softens with every wash.',
  },
  {
    title: 'Cotton Silk Kurta Set',
    category: 'Men',
    price: inr(5999),
    compareAtPrice: inr(6999),
    images: [img('photo-1770359993283-a2c2f386584e')],
    sizes: sizes(APPAREL_XXL, [5, 9, 8, 5, 3]),
    description:
      'A straight-cut kurta and tapered pyjama in indigo Chanderi cotton silk, woven in Madhya Pradesh. Concealed placket, side slits and a drawstring waist.',
  },

  // ── Women ─────────────────────────────────────────────────────────────────────────────────────
  {
    title: 'Chambray Shirt Dress',
    category: 'Women',
    price: inr(4299),
    images: [img('photo-1591369822096-ffd140ec948f')],
    sizes: sizes(APPAREL_XS, [5, 10, 12, 8, 3]),
    description:
      'A 5oz cotton chambray with a snap-front placket, flap pockets and a gathered skirt that falls just above the knee. Made in Bengaluru.',
  },
  {
    title: 'Block-Print Midi Dress',
    category: 'Women',
    price: inr(4799),
    images: [img('photo-1572804013309-59a88b7e92f1')],
    sizes: sizes(APPAREL_XS, [4, 9, 11, 7, 2]),
    description:
      'Hand-block-printed in Bagru, Rajasthan, on a crisp cotton poplin. Fit-and-flare with flutter sleeves and a self-fabric belt.',
  },
  {
    title: 'Georgette Wrap Maxi Dress',
    category: 'Women',
    price: inr(5999),
    compareAtPrice: inr(6999),
    images: [img('photo-1539008835657-9e8e9680c956')],
    sizes: sizes(APPAREL_XS, [3, 7, 9, 6, 2]),
    description:
      'A fluid viscose georgette in powder blue, cut as a true wrap with a deep V, tie waist and a long side slit. Lined to the knee.',
  },
  {
    title: 'Embroidered Cotton Shirt',
    category: 'Women',
    price: inr(3299),
    images: [img('photo-1564257631407-4deb1f99d992')],
    sizes: sizes(APPAREL_XS, [6, 11, 13, 8, 4]),
    description:
      'Fine cotton poplin scattered with hand-embroidered wildflowers by artisans in Lucknow. A relaxed, boxy fit to wear tucked, loose or knotted.',
  },
  {
    title: 'Linen Playsuit',
    category: 'Women',
    price: inr(3999),
    images: [img('photo-1618932260643-eee4a2f652a6')],
    sizes: sizes(APPAREL_XS, [4, 8, 10, 6, 2]),
    description:
      'Washed European flax in olive with adjustable straps, a self-tie belt and on-seam pockets. Relaxed through the leg; finished in Kolkata.',
  },
  {
    title: 'Shearling-Collar Suede Jacket',
    category: 'Women',
    price: inr(14999),
    compareAtPrice: inr(17999),
    images: [img('photo-1608063615781-e2ef8c73d114')],
    sizes: sizes(APPAREL_XS, [2, 4, 5, 3, 1]),
    description:
      'Soft goat suede with a natural shearling collar and facings, cut to the hip with a two-way zip. Tanned in Chennai; spot-clean only.',
  },
  {
    title: 'Oversized Wool Blazer',
    category: 'Women',
    price: inr(8499),
    images: [img('photo-1747815065172-a3234582223e')],
    sizes: sizes(APPAREL_XS, [3, 6, 8, 5, 2]),
    description:
      'A 280gsm wool-blend twill in oat, single-breasted and cut generously through the shoulder. Half-lined with two flap pockets and a one-button front.',
  },
  {
    title: 'Fair Isle Yoke Cardigan',
    category: 'Women',
    price: inr(4499),
    images: [img('photo-1758981400268-1181291b9503')],
    sizes: sizes(APPAREL, [6, 9, 8, 3]),
    description:
      'Pure lambswool hand-framed in Ludhiana, with a traditional Fair Isle yoke in ecru on chestnut. Crew neck, horn buttons, ribbed cuffs and hem.',
  },
  {
    title: 'Brushed Mohair Sweater',
    category: 'Women',
    price: inr(4999),
    images: [img('photo-1773747310674-b42a55d72003')],
    sizes: sizes(APPAREL_XS, [3, 7, 9, 5, 2]),
    description:
      'A featherweight kid mohair and silk blend in cream, knitted loose on a 5-gauge machine for an airy, see-through drape. Relaxed fit, balloon sleeves.',
  },

  // ── Footwear ──────────────────────────────────────────────────────────────────────────────────
  {
    title: 'Leather Derby Shoes',
    category: 'Footwear',
    price: inr(6999),
    images: [img('photo-1614252235316-8c857d38b5f4')],
    sizes: sizes(SHOES_FULL, [3, 7, 11, 10, 6, 2]),
    description:
      'Burnished cognac calf derbies with open lacing and a Blake-stitched leather sole, made in Agra on a round-toe last that suits wider feet.',
  },
  {
    title: 'Double Monk Strap Shoes',
    category: 'Footwear',
    price: inr(8499),
    images: [img('photo-1533867617858-e7b97e060509')],
    sizes: sizes(SHOES_FULL, [2, 5, 8, 7, 4, 1]),
    description:
      'Hand-finished brown calf with twin brass buckles and a Goodyear-welted leather sole. Made in Agra on a slim chisel-toe last.',
  },
  {
    title: 'Block-Heel Ankle Boots',
    category: 'Footwear',
    price: inr(6499),
    images: [img('photo-1531310197839-ccf54634509e')],
    sizes: sizes(SHOES_FULL, [6, 9, 8, 5, 3, 1]),
    description: 'Tan crust leather on a 5cm stacked block heel, with an inside zip and a rubber-capped leather sole. Runs true to size.',
  },
  {
    title: 'Nubuck Work Boots',
    category: 'Footwear',
    price: inr(7999),
    images: [img('photo-1605812860427-4024433a70fd')],
    sizes: sizes(SHOES_FULL, [3, 6, 9, 9, 5, 2]),
    description:
      'Waxed wheat nubuck with a padded collar, speed hooks and a lugged rubber sole, cemented and stitched in Kolkata. Built for monsoon pavements.',
  },
  {
    title: 'Cork Footbed Sandals',
    category: 'Footwear',
    price: inr(2999),
    images: [img('photo-1603487742131-4160ec999306')],
    sizes: sizes(SHOES_FULL, [8, 12, 14, 12, 7, 3]),
    description:
      'Two adjustable nubuck straps over a contoured cork-latex footbed lined in suede, on a light EVA sole. Moulds to your foot in a week.',
  },
  {
    title: 'Cross-Strap Platform Sandals',
    category: 'Footwear',
    price: inr(4499),
    images: [img('photo-1562273138-f46be4ebdf33')],
    sizes: sizes(SHOES_FULL, [7, 10, 8, 5, 2, 1]),
    description: 'Oxblood nappa straps on a 4cm wrapped-cork platform with a buckled slingback. Handmade by a family workshop in Kolhapur.',
  },
  {
    title: 'Suede Brogues',
    category: 'Footwear',
    price: inr(6799),
    images: [img('photo-1560343090-f0409e92791a')],
    sizes: sizes(SHOES_FULL, [2, 5, 7, 6, 4, 2]),
    description:
      'Teal calf suede with full broguing, a contrast tan leather sole and a soft leather lining. A smart shoe that refuses to be serious.',
  },
  {
    title: 'Suede Court Heels',
    category: 'Footwear',
    price: inr(5499),
    images: [img('photo-1515347619252-60a4bf4fff4f')],
    sizes: sizes(SHOES_FULL, [6, 9, 7, 4, 2, 1]),
    description: 'Navy kid suede on an 8.5cm heel with an almond toe, leather lining and a cushioned insole for the long evenings.',
  },
  {
    title: 'Canvas Chukka Boots',
    category: 'Footwear',
    price: inr(3999),
    images: [img('photo-1626947346165-4c2288dadc2a')],
    sizes: sizes(SHOES_FULL, [5, 9, 12, 10, 6, 2]),
    description:
      'Washed slate cotton canvas chukkas with two-eyelet lacing and a natural crepe-rubber sole. Unlined, so they breathe in May.',
  },
  {
    title: 'Horsebit Leather Loafers',
    category: 'Footwear',
    price: inr(7499),
    compareAtPrice: inr(8499),
    images: [img('photo-1616406432452-07bc5938759d')],
    sizes: sizes(SHOES_FULL, [2, 6, 8, 7, 3, 1]),
    description:
      'Polished cognac calf with a gilt horsebit and a Blake-stitched leather sole. Sleek enough for tailoring, sturdy enough for denim.',
  },
  {
    title: 'Canvas Low-Top Sneakers',
    category: 'Footwear',
    price: inr(2499),
    images: [img('photo-1525966222134-fcfa99b8ae77')],
    sizes: sizes(SHOES_FULL, [9, 14, 16, 13, 8, 4]),
    description: 'Heavy 12oz cotton canvas in oxblood on a vulcanised gum-rubber sole, with a padded collar and a cushioned insole.',
  },

  // ── Accessories ───────────────────────────────────────────────────────────────────────────────
  {
    title: 'Washed Cotton Cap',
    category: 'Accessories',
    price: inr(1199),
    images: [img('photo-1521369909029-2afed882baee')],
    sizes: sizes(ONE, [24]),
    description: 'A six-panel unstructured cap in enzyme-washed cotton twill with a brass slide-buckle strap. Fades like an old favourite.',
  },
  {
    title: 'Wool Felt Fedora',
    category: 'Accessories',
    price: inr(3499),
    images: [img('photo-1514327605112-b887c0e61c0a')],
    sizes: sizes(ONE, [6]),
    description: 'Pure wool felt in slate blue, hand-blocked in Jaipur, with a 7cm brim and a black grosgrain band.',
  },
  {
    title: 'Leather Bifold Wallet',
    category: 'Accessories',
    price: inr(2499),
    images: [img('photo-1627123424574-724758594e93')],
    sizes: sizes(ONE, [12]),
    description:
      'Full-grain chestnut leather with six card slots and a full-length note sleeve. Edge-painted and saddle-stitched in Kanpur.',
  },
  {
    title: 'Gold Vermeil Hoops',
    category: 'Accessories',
    price: inr(2799),
    images: [img('photo-1617038220319-276d3cfab638')],
    sizes: sizes(ONE, [9]),
    description: 'Chunky 25mm hoops in 18k gold vermeil over recycled, hallmarked sterling silver, with a hinged clasp.',
  },
  {
    title: 'Freshwater Pearl Pendant',
    category: 'Accessories',
    price: inr(3299),
    images: [img('photo-1611085583191-a3b181a88401')],
    sizes: sizes(ONE, [3]),
    description: 'A single 8mm freshwater pearl from Hyderabad on a fine 18k gold-plated sterling chain, 45cm with a 5cm extender.',
  },
  {
    title: 'Field Chronograph',
    category: 'Accessories',
    price: inr(14999),
    compareAtPrice: inr(16999),
    images: [img('photo-1542496658-e33a6d0d50f6')],
    sizes: sizes(ONE, [5]),
    description:
      'A 40mm brushed-steel chronograph with a panda dial, sapphire crystal and a brown leather strap. Quartz, 100m water resistant.',
  },
  {
    title: 'Rattan Top-Handle Bag',
    category: 'Accessories',
    price: inr(4999),
    images: [img('photo-1590874103328-eac38a683ce7')],
    sizes: sizes(ONE, [4]),
    description:
      'Hand-woven rattan from Assam with a tan leather flap, turn-lock closure and top handle. Cotton-lined; fits a phone, keys and a paperback.',
  },
];
