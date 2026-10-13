import mongoose, { Schema, Types } from 'mongoose';

export interface DeadLetterRecord {
  _id: Types.ObjectId;
  queue: string;
  name: string;
  jobId: string;
  data: unknown;
  error: string;
  attempts: number;
  requestId?: string;
  failedAt: Date;
}

export type DeadLetterInput = Omit<DeadLetterRecord, '_id' | 'failedAt'> & { failedAt?: Date };

const deadLetterSchema = new Schema<DeadLetterRecord>(
  {
    queue: { type: String, required: true },
    name: { type: String, required: true },
    jobId: { type: String, required: true },
    data: { type: Schema.Types.Mixed },
    error: { type: String, required: true },
    attempts: { type: Number, required: true },
    requestId: String,
    failedAt: { type: Date, required: true },
  },
  { versionKey: false, minimize: false },
);

deadLetterSchema.index({ failedAt: -1 });
deadLetterSchema.index({ name: 1, failedAt: -1 });

export const DeadLetterModel = mongoose.model<DeadLetterRecord>('DeadLetterJob', deadLetterSchema, 'dead_letter_jobs');

/** Jobs that exhausted their retries. Kept in Mongo so they survive Redis flushes and are visible to admins. */
export interface DeadLetterStore {
  record(entry: DeadLetterInput): Promise<void>;
  list(filter?: { name?: string; limit?: number }): Promise<DeadLetterRecord[]>;
  find(id: string): Promise<DeadLetterRecord | null>;
  remove(id: string): Promise<boolean>;
  count(): Promise<number>;
}

export class MongoDeadLetterStore implements DeadLetterStore {
  async record(entry: DeadLetterInput): Promise<void> {
    await DeadLetterModel.create({ ...entry, failedAt: entry.failedAt ?? new Date() });
  }

  list(filter: { name?: string; limit?: number } = {}): Promise<DeadLetterRecord[]> {
    return DeadLetterModel.find(filter.name ? { name: filter.name } : {})
      .sort({ failedAt: -1 })
      .limit(filter.limit ?? 100)
      .lean<DeadLetterRecord[]>();
  }

  find(id: string): Promise<DeadLetterRecord | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return DeadLetterModel.findById(id).lean<DeadLetterRecord>();
  }

  async remove(id: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    return (await DeadLetterModel.deleteOne({ _id: id })).deletedCount === 1;
  }

  count(): Promise<number> {
    return DeadLetterModel.countDocuments();
  }
}
