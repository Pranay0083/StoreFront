import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, validate } from '../middleware';
import * as couponsController from '../controllers/coupons.controller';

const router = Router();

const validateSchema = z.object({
  code: z.string({ required_error: 'Coupon code is required' }).min(2, 'Code must be at least 2 characters').max(30, 'Code cannot exceed 30 characters'),
  subtotal: z.number({ required_error: 'Subtotal is required' }).positive('Subtotal must be greater than 0'),
}).strict();

router.post('/validate', requireAuth, validate(validateSchema), couponsController.validateCoupon);

export default router;
