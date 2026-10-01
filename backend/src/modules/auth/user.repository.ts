import type { Role } from '@storefront/contracts';
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

  countByRole(role: Role): Promise<number> {
    return UserModel.countDocuments({ role });
  }
}
