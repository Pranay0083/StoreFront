import { z } from 'zod';

export const OrderIdBodySchema = z.object({ orderId: z.string({ required_error: 'Order ID is required' }) }).strict();

export const VerifyPaymentSchema = z
  .object({
    orderId: z.string({ required_error: 'Order ID is required' }),
    razorpay_order_id: z.string({ required_error: 'Razorpay order ID is required' }),
    razorpay_payment_id: z.string({ required_error: 'Razorpay payment ID is required' }),
    razorpay_signature: z.string({ required_error: 'Razorpay signature is required' }),
  })
  .strict();
