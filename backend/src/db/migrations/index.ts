import type { Migration } from '../migration';
import { ensureIndexes } from './001-ensure-indexes';
import { amountsToPaise } from './002-amounts-to-paise';

export const migrations: readonly Migration[] = [ensureIndexes, amountsToPaise];
