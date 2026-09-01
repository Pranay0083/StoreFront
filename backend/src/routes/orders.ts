import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, validate } from '../middleware';
import * as ordersController from '../controllers/orders.controller';

const router = Router();
router.use(requireAuth);

const createSchema = z.object({
  items: z.array(z.object({
    productId: z.string({ required_error: 'Product ID is required' }),
    size: z.string({ required_error: 'Size is required' }),
    qty: z.number({ required_error: 'Quantity is required' }).int('Quantity must be a whole number').min(1, 'Quantity must be at least 1').max(20, 'Quantity cannot exceed 20 per item'),
  }).strict()).min(1, 'Order must contain at least one item').max(50, 'Order cannot exceed 50 distinct items'),
  couponCode: z.string().max(30).optional(),
  address: z.object({
    name: z.string({ required_error: 'Recipient name is required' }).min(2, 'Name must be at least 2 characters'),
    line1: z.string({ required_error: 'Address line 1 is required' }).min(4, 'Address line 1 must be at least 4 characters'),
    city: z.string({ required_error: 'City is required' }).min(2, 'City must be at least 2 characters'),
    state: z.string({ required_error: 'State is required' }).min(2, 'State must be at least 2 characters'),
    pincode: z.string({ required_error: 'Pincode is required' }).regex(/^\d{6}$/, 'Pincode must be exactly 6 digits'),
    phone: z.string({ required_error: 'Phone number is required' }).regex(/^\d{10}$/, 'Phone number must be exactly 10 digits'),
  }).strict(),
}).strict();

router.post('/', validate(createSchema), ordersController.createOrder);
router.get('/', ordersController.getOrders);
router.get('/:id', ordersController.getOrderById);
router.post('/:id/cancel', ordersController.cancelOrder);

export default router;
