import type { Paise } from './money';
import type { ActionSpec, ActionType, CustomerSegment, PromotionActivation } from './pricing';

/**
 * How the storefront groups an advertised offer:
 * - `set`: a fixed-price bundle of named pieces
 * - `multiBuy`: any N for a price, or buy X get Y
 * - `spendMore`: spend tiers and order discounts with a minimum spend
 * - `sale`: markdowns, clearance and plain percent or amount off
 * - `delivery`: free shipping
 * - `code`: anything that needs a promo code the admin chose to advertise
 */
export const OFFER_KINDS = ['set', 'multiBuy', 'spendMore', 'sale', 'delivery', 'code'] as const;
export type OfferKind = (typeof OFFER_KINDS)[number];

export function offerKindOf(p: { activation: PromotionActivation; action: Pick<ActionSpec, 'type'>; hasMinSpend?: boolean }): OfferKind {
  if (p.activation === 'code') return 'code';
  const KINDS: Record<ActionType, OfferKind> = {
    fixedBundle: 'set',
    mixAndMatch: 'multiBuy',
    buyXGetY: 'multiBuy',
    tiered: 'spendMore',
    percentOff: p.hasMinSpend ? 'spendMore' : 'sale',
    flatOff: p.hasMinSpend ? 'spendMore' : 'sale',
    markdown: 'sale',
    clearance: 'sale',
    freeShipping: 'delivery',
  };
  return KINDS[p.action.type];
}

/** A catalogue piece an offer can be used with, in stock now. */
export interface OfferProduct {
  productId: string;
  slug: string;
  title: string;
  image?: string;
  category: string;
  /** List price per unit. */
  price: Paise;
  /** First size in stock: what the worked example and "Add the set to bag" use. */
  size: string;
  /** Units in stock in that size. */
  stock: number;
}

export interface OfferExampleLine extends OfferProduct {
  qty: number;
}

/**
 * A small bag priced by the real pricing engine, exactly as checkout would price it for a guest (or,
 * for an offer limited to one kind of customer, for that customer). Nothing here is computed by hand.
 */
export interface OfferExample {
  lines: OfferExampleLine[];
  /** The pieces at list price. */
  listTotal: Paise;
  /** What the bag charges for the pieces, before delivery. */
  total: Paise;
  /** `listTotal − total`: everything the bag takes off these pieces. */
  saving: Paise;
  /** The part of `saving` this offer gives on its own. */
  offerSaving: Paise;
  /** Delivery the same bag pays (0 when it ships free). */
  shipping: Paise;
  /** Other offers the optimizer also applied to the same bag. */
  alsoApplied: string[];
  /** The kind of customer the example was priced for, when the offer is limited to one. */
  pricedFor?: CustomerSegment;
}

export interface OfferTier {
  minSubtotal: Paise;
  percentOff?: number;
  amountOff?: Paise;
  /** e.g. "5% off" or "₹500 off". */
  reward: string;
}

/** A live promotion as the storefront may show it: no internal fields (priority, stack group, usage). */
export interface Offer {
  id: string;
  /** Changes on every edit of the promotion. */
  version: number;
  name: string;
  description: string;
  kind: OfferKind;
  actionType: ActionType;
  /** The rule in one line, from the engine's own description of the action. */
  summary: string;
  /** The reward in a few words, straight from the rule: "Any 3 for ₹5,999", "Buy 2, get 1 free", "15% off". */
  headline: string;
  /** The conditions in words, e.g. "On orders of ₹1,000 or more", "Every Friday". */
  terms: string[];
  /** When the offer stops, if it has an end date. */
  endsAt?: string;
  /** Only present for code offers the admin chose to advertise. */
  code?: string;
  /** In-stock pieces the offer applies to (at most 48); empty for whole-order offers. */
  pieces: OfferProduct[];
  /** A worked example priced by the engine, when one exists for this offer. */
  example?: OfferExample;
  /** Spend thresholds (tiered offers). */
  tiers?: OfferTier[];
  /** Percent off (markdown, clearance, percent-off offers). */
  percentOff?: number;
}

export interface OffersResponse {
  offers: Offer[];
  generatedAt: string;
  /** The next moment an offer starts or stops on its own; the list is recomputed then. */
  nextChangeAt?: string;
}

/** The small line a product card prints for a piece that belongs to an advertised offer. */
export interface OfferBadge {
  offerId: string;
  name: string;
  kind: OfferKind;
  headline: string;
  /** For a set: the worked example's saving on the whole set. */
  saving?: Paise;
}

/**
 * One badge per product: sets first (they name the piece), then multi-buys; the larger saving wins.
 * Built once per page from the offers read model and passed down, so cards never fetch.
 */
export function offerBadges(offers: readonly Offer[]): Record<string, OfferBadge> {
  const rank = (b: OfferBadge) => (b.kind === 'set' ? 2 : 1) * 1e12 + (b.saving ?? 0);
  const out: Record<string, OfferBadge> = {};
  for (const offer of offers) {
    if (offer.kind !== 'set' && offer.kind !== 'multiBuy') continue;
    const ids = new Set(offer.kind === 'set' ? (offer.example?.lines.map(l => l.productId) ?? []) : offer.pieces.map(p => p.productId));
    for (const productId of ids) {
      const badge: OfferBadge = {
        offerId: offer.id,
        name: offer.name,
        kind: offer.kind,
        headline: offer.headline,
        // The set's own saving: the example bag may also reach a spend tier, which is not this offer's doing.
        ...(offer.kind === 'set' && offer.example && { saving: offer.example.offerSaving }),
      };
      const current = out[productId];
      if (!current || rank(badge) > rank(current)) out[productId] = badge;
    }
  }
  return out;
}
