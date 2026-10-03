import { Types } from 'mongoose';
import { AuthSessionModel, type AuthSessionRecord, type RevokeReason } from './session.model';

export interface NewAuthSession {
  _id: Types.ObjectId;
  userId: string;
  currentHash: string;
  expiresAt: Date;
  ip?: string;
  userAgent?: string;
}

export class AuthSessionRepository {
  async create(session: NewAuthSession): Promise<void> {
    await AuthSessionModel.create({ ...session, lastUsedAt: new Date() });
  }

  findById(id: string): Promise<AuthSessionRecord | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return AuthSessionModel.findById(id).lean<AuthSessionRecord>();
  }

  /** Atomically swaps the current token for its successor; null when the presented token is not current. */
  rotate(id: string, presentedHash: string, nextHash: string, now: Date): Promise<AuthSessionRecord | null> {
    return AuthSessionModel.findOneAndUpdate(
      { _id: id, currentHash: presentedHash, revokedAt: null, expiresAt: { $gt: now } },
      { $set: { previousHash: presentedHash, currentHash: nextHash, rotatedAt: now, lastUsedAt: now } },
      { new: true },
    ).lean<AuthSessionRecord>();
  }

  async revoke(id: string, reason: RevokeReason, userId?: string): Promise<boolean> {
    const filter = { _id: id, revokedAt: null, ...(userId && { userId }) };
    const res = await AuthSessionModel.updateOne(filter, { $set: { revokedAt: new Date(), revokedReason: reason } });
    return res.modifiedCount > 0;
  }

  async revokeAllForUser(userId: string, reason: RevokeReason): Promise<number> {
    const res = await AuthSessionModel.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: reason } });
    return res.modifiedCount;
  }

  listActive(userId: string): Promise<AuthSessionRecord[]> {
    return AuthSessionModel.find({ userId, revokedAt: null, expiresAt: { $gt: new Date() } })
      .sort({ lastUsedAt: -1 })
      .lean<AuthSessionRecord[]>();
  }
}
