import type { Migration } from '../migration';
import { ensureIndexes } from './001-ensure-indexes';
import { amountsToPaise } from './002-amounts-to-paise';
import { inventoryLedger } from './010-inventory-ledger';
import { orderConsistencyIndexes } from './011-order-consistency-indexes';
import { pricingIndexes } from './020-pricing-indexes';
import { demoPromotions } from './021-demo-promotions';
import { authSessions } from './030-auth-sessions';
import { loginThrottle } from './031-login-throttle';
import { cartLines } from './032-cart-lines';
import { reviewAggregates } from './033-review-aggregates';
import { auditLog } from './034-audit-log';

export const migrations: readonly Migration[] = [
  ensureIndexes,
  amountsToPaise,
  inventoryLedger,
  orderConsistencyIndexes,
  pricingIndexes,
  demoPromotions,
  authSessions,
  loginThrottle,
  cartLines,
  reviewAggregates,
  auditLog,
];
