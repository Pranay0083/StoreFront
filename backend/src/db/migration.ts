import type { mongo } from 'mongoose';

export interface Migration {
  /** Sortable, never-reused identifier, e.g. `001-ensure-indexes`. */
  id: string;
  description: string;
  up(db: mongo.Db): Promise<void>;
}
