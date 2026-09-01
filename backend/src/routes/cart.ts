import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, validate } from '../middleware';
import * as cartController from '../controllers/cart.controller';

const router = Router();
router.use(requireAuth);

router.get('/', cartController.getCart);

export const cartSchema = z.object({
  items: z.array(z.object({
    productId: z.string({ required_error: 'Product ID is required' }),
    title: z.string({ required_error: 'Product title is required' }),
    image: z.string({ required_error: 'Product image is required' }),
    price: z.number({ required_error: 'Price is required' }).nonnegative('Price cannot be negative'),
    size: z.string({ required_error: 'Size is required' }),
    qty: z.number({ required_error: 'Quantity is required' }).int('Quantity must be a whole number').min(1, 'Quantity must be at least 1').max(20, 'Quantity cannot exceed 20 per item'),
    slug: z.string({ required_error: 'Product slug is required' }),
  })).max(50, 'Cart cannot exceed 50 distinct items'),
}).strict();

router.put('/', validate(cartSchema), cartController.updateCart);

export default router;
