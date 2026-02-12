import { Router } from 'express';
import { z } from 'zod';
import { ApiError, requireAdmin, validate } from '../middleware';
import { Product } from '../models';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { category, size, minPrice, maxPrice, q, sort, featured, page = '1', limit = '24' } = req.query as Record<string, string>;
    const filter: any = {};
    if (category) filter.category = category;
    if (featured === 'true') filter.featured = true;
    if (size) filter['sizes'] = { $elemMatch: { size, stock: { $gt: 0 } } };
    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = Number(minPrice);
      if (maxPrice) filter.price.$lte = Number(maxPrice);
    }
    if (q) filter.$text = { $search: q };
    const sortMap: Record<string, any> = {
      'price-asc': { price: 1 }, 'price-desc': { price: -1 },
      'newest': { createdAt: -1 }, 'rating': { rating: -1 },
    };
    const pageN = Math.max(1, Number(page));
    const limitN = Math.min(48, Number(limit));
    const [items, total] = await Promise.all([
      Product.find(filter).sort(sortMap[sort] || { createdAt: -1 }).skip((pageN - 1) * limitN).limit(limitN).lean(),
      Product.countDocuments(filter),
    ]);
    res.json({ items, total, page: pageN, pages: Math.ceil(total / limitN) });
  } catch (e) { next(e); }
});

router.get('/categories', async (_req, res, next) => {
  try {
    const cats = await Product.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    res.json(cats.map(c => ({ name: c._id, count: c.count })));
  } catch (e) { next(e); }
});

router.get('/:slug', async (req, res, next) => {
  try {
    const product = await Product.findOne({ slug: req.params.slug }).lean();
    if (!product) throw new ApiError(404, 'Product not found');
    res.json(product);
  } catch (e) { next(e); }
});

const productSchema = z.object({
  title: z.string().min(2),
  slug: z.string().min(2).optional(),
  description: z.string().default(''),
  category: z.string().min(2),
  price: z.number().positive(),
  compareAtPrice: z.number().positive().optional().nullable(),
  images: z.array(z.string().url()).min(1),
  sizes: z.array(z.object({ size: z.string(), stock: z.number().int().min(0) })).min(1),
  featured: z.boolean().default(false),
});

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

router.post('/', requireAdmin, validate(productSchema), async (req, res, next) => {
  try {
    const slug = req.body.slug || slugify(req.body.title);
    if (await Product.findOne({ slug })) throw new ApiError(409, 'Slug already exists');
    const product = await Product.create({ ...req.body, slug });
    res.status(201).json(product);
  } catch (e) { next(e); }
});

router.put('/:id', requireAdmin, validate(productSchema.partial()), async (req, res, next) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!product) throw new ApiError(404, 'Product not found');
    res.json(product);
  } catch (e) { next(e); }
});

router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) throw new ApiError(404, 'Product not found');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
