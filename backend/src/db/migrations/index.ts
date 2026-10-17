import type { Migration } from '../migration';
import { ensureIndexes } from './001-ensure-indexes';
import { amountsToPaise } from './002-amounts-to-paise';
import { inventoryLedger } from './010-inventory-ledger';
import { orderConsistencyIndexes } from './011-order-consistency-indexes';
import { pricingIndexes } from './020-pricing-indexes';
import { authSessions } from './030-auth-sessions';
import { loginThrottle } from './031-login-throttle';
import { cartLines } from './032-cart-lines';
import { reviewAggregates } from './033-review-aggregates';
import { auditLog } from './034-audit-log';
import { promotionRedemptions } from './040-promotion-redemptions';
import { couponsToPromotions } from './041-coupons-to-promotions';
import { lineRefunds } from './042-line-refunds';
import { platformIndexes } from './050-platform-indexes';
import { experimentsIndexes } from './070-experiments';
import { recommendationsIndexes } from './071-recommendations';
import { productImportsIndexes } from './072-product-imports';

export const migrations: readonly Migration[] = [
  ensureIndexes,
  amountsToPaise,
  inventoryLedger,
  orderConsistencyIndexes,
  pricingIndexes,
  authSessions,
  loginThrottle,
  cartLines,
  reviewAggregates,
  auditLog,
  promotionRedemptions,
  couponsToPromotions,
  lineRefunds,
  platformIndexes,
  experimentsIndexes,
  recommendationsIndexes,
  productImportsIndexes,
];
