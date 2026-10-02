import { z } from 'zod';

/** Integer amount in the smallest currency unit (1 INR = 100 paise). */
export type Paise = number;

export const PaiseSchema = z.number().int('Amount must be a whole number of paise').nonnegative('Amount cannot be negative');

export const rupeesToPaise = (rupees: number): Paise => Math.round(rupees * 100);

export const paiseToRupees = (paise: Paise): number => paise / 100;

export const percentOf = (amount: Paise, percent: number): Paise => Math.floor((amount * percent) / 100);

export function formatINR(paise: Paise | null | undefined): string {
  const value = paiseToRupees(paise ?? 0);
  const fractionDigits = Number.isInteger(value) ? 0 : 2;
  return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: fractionDigits, maximumFractionDigits: 2 })}`;
}

export const FREE_SHIPPING_THRESHOLD: Paise = 299_900;
export const SHIPPING_FEE: Paise = 9_900;

export const shippingFor = (subtotal: Paise): Paise => (subtotal === 0 || subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE);
