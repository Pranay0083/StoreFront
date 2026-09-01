import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin, validate } from '../middleware';
import * as productsController from '../controllers/products.controller';

const router = Router();

export const productSchema = z.object({
  title: z.string({ required_error: 'Product title is required' }).min(2, 'Title must be at least 2 characters'),
  slug: z.string().min(2, 'Slug must be at least 2 characters').optional(),
  description: z.string().default(''),
  category: z.string({ required_error: 'Category is required' }).min(2, 'Category must be at least 2 characters'),
  price: z.number({ required_error: 'Price is required' }).positive('Price must be greater than 0'),
  compareAtPrice: z.number().positive('Compare at price must be greater than 0').optional().nullable(),
  images: z.array(z.string().url('Image must be a valid URL')).min(1, 'At least one image is required'),
  sizes: z.array(z.object({ 
    size: z.string({ required_error: 'Size name is required' }), 
    stock: z.number({ required_error: 'Stock quantity is required' }).int('Stock must be a whole number').min(0, 'Stock cannot be negative') 
  })).min(1, 'At least one size is required'),
  featured: z.boolean().default(false),
}).strict();

router.get('/', productsController.getProducts);
router.get('/categories', productsController.getCategories);
router.get('/:slug', productsController.getProductBySlug);

router.post('/', requireAdmin, validate(productSchema), productsController.createProduct);
router.put('/:id', requireAdmin, validate(productSchema.partial()), productsController.updateProduct);
router.delete('/:id', requireAdmin, productsController.deleteProduct);

export default router;
