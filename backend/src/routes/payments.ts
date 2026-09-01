import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, validate } from '../middleware';
import * as paymentsController from '../controllers/payments.controller';

const router = Router();

router.get('/config', paymentsController.getConfig);

const orderIdSchema = z.object({ orderId: z.string({ required_error: 'Order ID is required' }) }).strict();
router.post('/create', requireAuth, validate(orderIdSchema), paymentsController.createPayment);

const verifySchema = z.object({
  orderId: z.string({ required_error: 'Order ID is required' }),
  razorpay_order_id: z.string({ required_error: 'Razorpay order ID is required' }),
  razorpay_payment_id: z.string({ required_error: 'Razorpay payment ID is required' }),
  razorpay_signature: z.string({ required_error: 'Razorpay signature is required' }),
}).strict();
router.post('/verify', requireAuth, validate(verifySchema), paymentsController.verifyPayment);

router.post('/demo-confirm', requireAuth, validate(orderIdSchema), paymentsController.demoConfirm);

router.post('/webhook', paymentsController.handleWebhook);

export default router;
