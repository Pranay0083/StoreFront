import type { Migration } from '../migration';
import { ensureIndexes } from './001-ensure-indexes';
import { amountsToPaise } from './002-amounts-to-paise';
import { inventoryLedger } from './010-inventory-ledger';

export const migrations: readonly Migration[] = [ensureIndexes, amountsToPaise, inventoryLedger];
