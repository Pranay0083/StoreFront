import { z } from 'zod';
import { PaiseSchema, type Paise } from './money';

export const COUPON_TYPES = ['percent', 'flat'] as const;
export type CouponType = (typeof COUPON_TYPES)[number];

export const CouponInputSchema = z
  .object({
    code: z
      .string({ required_error: 'Coupon code is required' })
      .min(2, 'Code must be at least 2 characters')
      .max(30, 'Code cannot exceed 30 characters')
      .transform(s => s.trim().toUpperCase()),
    type: z.enum(COUPON_TYPES, {
      required_error: 'Coupon type is required',
      invalid_type_error: 'Type must be either percent or flat',
    }),
    value: z
      .number({ required_error: 'Discount value is required' })
      .int('Discount value must be a whole number')
      .positive('Discount value must be greater than 0'),
    minSubtotal: PaiseSchema.default(0),
    maxDiscount: PaiseSchema.positive('Maximum discount must be greater than 0').optional().nullable(),
    usageLimit: z.number().int('Usage limit must be a whole number').positive('Usage limit must be greater than 0').optional().nullable(),
    active: z.boolean().default(true),
    expiresAt: z.string().datetime('Must be a valid ISO datetime').optional().nullable(),
  })
  .strict()
  .refine(c => c.type !== 'percent' || c.value <= 100, { message: 'Percent discount cannot exceed 100', path: ['value'] });
export type CouponInput = z.infer<typeof CouponInputSchema>;

export const CouponUpdateSchema = CouponInputSchema.innerType().partial();
export type CouponUpdate = z.infer<typeof CouponUpdateSchema>;

export const ValidateCouponSchema = z
  .object({
    code: z
      .string({ required_error: 'Coupon code is required' })
      .min(2, 'Code must be at least 2 characters')
      .max(30, 'Code cannot exceed 30 characters'),
    subtotal: PaiseSchema.positive('Subtotal must be greater than 0'),
  })
  .strict();
export type ValidateCouponInput = z.infer<typeof ValidateCouponSchema>;

export interface Coupon {
  _id: string;
  code: string;
  type: CouponType;
  /** Percentage for `percent` coupons, paise for `flat` coupons. */
  value: number;
  minSubtotal: Paise;
  maxDiscount?: Paise | null;
  usageLimit?: number | null;
  usedCount: number;
  active: boolean;
  expiresAt?: string | null;
  createdAt: string;
}

export interface CouponValidation {
  code: string;
  type: CouponType;
  value: number;
  discount: Paise;
}
