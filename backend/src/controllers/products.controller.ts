import { z } from 'zod';
import { ApiError } from '../middleware';
import { Product } from '../models';
import { logger } from '../utils/logger';

/**
 * Lists products based on various filters (category, size, price, search query, featured),
 * sort order, and pagination.
 */
export const getProducts = async (req: any, res: any, next: any) => {
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
};

/**
 * Retrieves all distinct product categories along with their counts.
 */
export const getCategories = async (_req: any, res: any, next: any) => {
  try {
    const cats = await Product.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    res.json(cats.map(c => ({ name: c._id, count: c.count })));
  } catch (e) { next(e); }
};

/**
 * Retrieves full details for a single product by its URL slug.
 */
export const getProductBySlug = async (req: any, res: any, next: any) => {
  try {
    const product = await Product.findOne({ slug: req.params.slug }).lean();
    if (!product) throw new ApiError(404, 'Product not found');
    res.json(product);
  } catch (e) { next(e); }
};

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/**
 * Creates a new product. Generates a slug from the title if one is not provided.
 */
export const createProduct = async (req: any, res: any, next: any) => {
  try {
    const slug = req.body.slug || slugify(req.body.title);
    if (await Product.findOne({ slug })) throw new ApiError(409, 'Slug already exists');
    const product = await Product.create({ ...req.body, slug });
    logger.info({ adminId: req.user.id, productId: product._id, slug }, 'Product created');
    res.status(201).json(product);
  } catch (e) { next(e); }
};

/**
 * Updates an existing product by ID.
 */
export const updateProduct = async (req: any, res: any, next: any) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!product) throw new ApiError(404, 'Product not found');
    logger.info({ adminId: req.user.id, productId: product._id }, 'Product updated');
    res.json(product);
  } catch (e) { next(e); }
};

/**
 * Deletes a product by ID.
 */
export const deleteProduct = async (req: any, res: any, next: any) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) throw new ApiError(404, 'Product not found');
    logger.info({ adminId: req.user.id, productId: req.params.id }, 'Product deleted');
    res.json({ ok: true });
  } catch (e) { next(e); }
};
