import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin, validate } from '../middleware';
import { ORDER_STATUSES } from '../types';
import * as adminController from '../controllers/admin.controller';

const router = Router();
router.use(requireAdmin);

router.get('/stats', adminController.getStats);
router.get('/revenue-by-day', adminController.getRevenueByDay);
router.get('/funnel', adminController.getFunnel);
router.get('/top-products', adminController.getTopProducts);
router.get('/low-stock', adminController.getLowStock);
router.get('/orders', adminController.getOrders);

const bulkSchema = z.object({
  ids: z.array(z.string()).min(1, 'At least one order ID is required').max(100, 'Cannot process more than 100 orders at once'),
  to: z.enum(ORDER_STATUSES, { required_error: 'Target status is required', invalid_type_error: 'Invalid order status' }),
}).strict();
router.post('/orders/bulk-transition', validate(bulkSchema), adminController.bulkTransitionOrders);

router.get('/conversations', adminController.getConversations);

const couponSchema = z.object({
  code: z.string({ required_error: 'Coupon code is required' }).min(2, 'Code must be at least 2 characters').max(30, 'Code cannot exceed 30 characters').transform(s => s.trim().toUpperCase()),
  type: z.enum(['percent', 'flat'], { required_error: 'Coupon type is required', invalid_type_error: 'Type must be either percent or flat' }),
  value: z.number({ required_error: 'Discount value is required' }).positive('Discount value must be greater than 0'),
  minSubtotal: z.number().min(0, 'Minimum subtotal cannot be negative').default(0),
  maxDiscount: z.number().positive('Maximum discount must be greater than 0').optional().nullable(),
  usageLimit: z.number().int('Usage limit must be a whole number').positive('Usage limit must be greater than 0').optional().nullable(),
  active: z.boolean().default(true),
  expiresAt: z.string().datetime('Must be a valid ISO datetime').optional().nullable(),
}).strict();

router.get('/coupons', adminController.getCoupons);
router.post('/coupons', validate(couponSchema), adminController.createCoupon);
router.put('/coupons/:id', validate(couponSchema.partial()), adminController.updateCoupon);
router.delete('/coupons/:id', adminController.deleteCoupon);

export default router;
