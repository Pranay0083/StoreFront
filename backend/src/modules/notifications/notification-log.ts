import mongoose, { Schema } from 'mongoose';
import type { Channel } from './channels';

export const NOTIFICATION_STATUSES = ['sending', 'sent', 'failed'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export interface NotificationLogRecord {
  /** `<idempotency key>:<channel>` */
  _id: string;
  key: string;
  template: string;
  channel: Channel;
  to: string;
  status: NotificationStatus;
  attempts: number;
  provider?: string;
  providerMessageId?: string;
  lastError?: string;
  lockedAt: Date;
  sentAt?: Date;
  createdAt: Date;
}

const schema = new Schema<NotificationLogRecord>(
  {
    _id: { type: String, required: true },
    key: { type: String, required: true },
    template: { type: String, required: true },
    channel: { type: String, required: true },
    to: { type: String, required: true },
    status: { type: String, enum: NOTIFICATION_STATUSES, required: true },
    attempts: { type: Number, default: 0 },
    provider: String,
    providerMessageId: String,
    lastError: String,
    lockedAt: { type: Date, required: true },
    sentAt: Date,
    createdAt: { type: Date, required: true },
  },
  { versionKey: false },
);

schema.index({ key: 1 });
schema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 3600 });

export const NotificationLogModel = mongoose.model<NotificationLogRecord>('NotificationLog', schema, 'notification_log');

const DUPLICATE_KEY = 11000;

/** Idempotency ledger: one row per (key, channel). A row that reached `sent` is never sent again. */
export class NotificationLogRepository {
  constructor(private readonly staleLockMs = 2 * 60_000) {}

  /** Claims the right to send; false when it was already sent or another worker is sending it right now. */
  async claim(entry: Pick<NotificationLogRecord, '_id' | 'key' | 'template' | 'channel' | 'to'>, now = new Date()): Promise<boolean> {
    try {
      await NotificationLogModel.create({ ...entry, status: 'sending', attempts: 1, lockedAt: now, createdAt: now });
      return true;
    } catch (e) {
      if ((e as { code?: number }).code !== DUPLICATE_KEY) throw e;
    }
    const taken = await NotificationLogModel.findOneAndUpdate(
      {
        _id: entry._id,
        $or: [{ status: 'failed' }, { status: 'sending', lockedAt: { $lt: new Date(now.getTime() - this.staleLockMs) } }],
      },
      { $set: { status: 'sending', lockedAt: now }, $inc: { attempts: 1 } },
    ).lean();
    return taken !== null;
  }

  async markSent(id: string, provider: string, providerMessageId?: string): Promise<void> {
    await NotificationLogModel.updateOne(
      { _id: id },
      { $set: { status: 'sent', sentAt: new Date(), provider, ...(providerMessageId && { providerMessageId }) }, $unset: { lastError: 1 } },
    );
  }

  async markFailed(id: string, error: string): Promise<void> {
    await NotificationLogModel.updateOne({ _id: id }, { $set: { status: 'failed', lastError: error.slice(0, 500) } });
  }

  find(id: string): Promise<NotificationLogRecord | null> {
    return NotificationLogModel.findById(id).lean<NotificationLogRecord>();
  }

  listByKey(key: string): Promise<NotificationLogRecord[]> {
    return NotificationLogModel.find({ key }).lean<NotificationLogRecord[]>();
  }
}
