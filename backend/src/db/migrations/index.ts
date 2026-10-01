import type { Migration } from '../migration';
import { ensureIndexes } from './001-ensure-indexes';

export const migrations: readonly Migration[] = [ensureIndexes];
