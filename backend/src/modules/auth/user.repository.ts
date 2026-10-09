import type { Role } from '@storefront/contracts';
import type { FilterQuery } from 'mongoose';
import { UserModel, type UserRecord } from './user.model';

export interface NewUser {
  email: string;
  name: string;
  passwordHash: string;
  role?: Role;
}

export class UserRepository {
  findById(id: string): Promise<UserRecord | null> {
    return UserModel.findById(id).lean<UserRecord>();
  }

  findByEmail(email: string): Promise<UserRecord | null> {
    return UserModel.findOne({ email: email.toLowerCase() }).lean<UserRecord>();
  }

  async existsByEmail(email: string): Promise<boolean> {
    return (await UserModel.exists({ email: email.toLowerCase() })) !== null;
  }

  async create(user: NewUser): Promise<UserRecord> {
    const doc = await UserModel.create(user);
    return doc.toObject() as UserRecord;
  }

  async setPasswordHash(id: string, passwordHash: string): Promise<void> {
    await UserModel.updateOne({ _id: id }, { $set: { passwordHash } });
  }

  async invalidateSessionsBefore(id: string, at: Date): Promise<void> {
    await UserModel.updateOne({ _id: id }, { $set: { sessionsValidAfter: at } });
  }

  async search(filter: { q?: string; role?: Role }, page: number, limit: number): Promise<{ users: UserRecord[]; total: number }> {
    const query: FilterQuery<UserRecord> = {};
    if (filter.role) query.role = filter.role;
    if (filter.q) {
      const pattern = new RegExp(filter.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ email: pattern }, { name: pattern }];
    }
    const [users, total] = await Promise.all([
      UserModel.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<UserRecord[]>(),
      UserModel.countDocuments(query),
    ]);
    return { users, total };
  }

  setRole(id: string, role: Role): Promise<UserRecord | null> {
    return UserModel.findByIdAndUpdate(id, { $set: { role } }, { new: true, runValidators: true }).lean<UserRecord>();
  }

  countByRole(role: Role): Promise<number> {
    return UserModel.countDocuments({ role });
  }
}
