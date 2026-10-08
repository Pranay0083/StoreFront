import type { Migration } from '../migration';
import { ensureIndexes } from './001-ensure-indexes';
import { amountsToPaise } from './002-amounts-to-paise';
import { pricingIndexes } from './020-pricing-indexes';
import { demoPromotions } from './021-demo-promotions';

export const migrations: readonly Migration[] = [ensureIndexes, amountsToPaise, pricingIndexes, demoPromotions];
