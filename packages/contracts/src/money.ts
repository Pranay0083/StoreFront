import { z } from 'zod';

/** Integer amount in the smallest currency unit (1 INR = 100 paise). */
export type Paise = number;

export const PaiseSchema = z.number().int('Amount must be a whole number of paise').nonnegative('Amount cannot be negative');

export const rupeesToPaise = (rupees: number): Paise => Math.round(rupees * 100);

export const paiseToRupees = (paise: Paise): number => paise / 100;

export const percentOf = (amount: Paise, percent: number): Paise => Math.floor((amount * percent) / 100);

// toLocaleString with options builds a new Intl.NumberFormat on every call; pricing formats dozens
// of amounts per quote, so the formatters are created once.
const WHOLE_RUPEES = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const WITH_PAISE = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatINR(paise: Paise | null | undefined): string {
  const value = paiseToRupees(paise ?? 0);
  return `₹${(Number.isInteger(value) ? WHOLE_RUPEES : WITH_PAISE).format(value)}`;
}

export const FREE_SHIPPING_THRESHOLD: Paise = 299_900;
export const SHIPPING_FEE: Paise = 9_900;

export const shippingFor = (subtotal: Paise): Paise => (subtotal === 0 || subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE);
