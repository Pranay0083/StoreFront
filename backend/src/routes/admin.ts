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

export default router;
