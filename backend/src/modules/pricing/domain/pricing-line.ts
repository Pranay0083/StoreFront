import type { Paise, PaymentMethod } from '@storefront/contracts';

/** A cart line hydrated with authoritative catalog data. Prices are integer paise. */
export interface PricingLine {
  productId: string;
  slug: string;
  title: string;
  image?: string;
  category: string;
  size: string;
  qty: number;
  unitPrice: Paise;
  stock: number;
  productCreatedAt: Date;
}

/** A line after the markdown stage has fixed its effective unit price. */
export interface EffectiveLine extends PricingLine {
  markdownPerUnit: Paise;
  effectiveUnitPrice: Paise;
}

export interface CustomerProfile {
  id?: string;
  signedIn: boolean;
  isFirstOrder: boolean;
}

export interface PricingContext {
  now: Date;
  lines: readonly PricingLine[];
  merchandiseSubtotal: Paise;
  customer: CustomerProfile;
  paymentMethod?: PaymentMethod;
}

export const GUEST: CustomerProfile = { signedIn: false, isFirstOrder: false };

export const listSubtotal = (lines: readonly PricingLine[]): Paise => lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);

export const effectiveSubtotal = (lines: readonly EffectiveLine[]): Paise => lines.reduce((s, l) => s + l.effectiveUnitPrice * l.qty, 0);

export const withoutMarkdown = (lines: readonly PricingLine[]): EffectiveLine[] =>
  lines.map(l => ({ ...l, markdownPerUnit: 0, effectiveUnitPrice: l.unitPrice }));
