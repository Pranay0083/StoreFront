import { LoginAttemptModel, type LoginAttemptRecord } from './login-attempt.model';

const FORGET_AFTER_MS = 24 * 60 * 60 * 1000;

export class LoginAttemptRepository {
  findMany(keys: string[]): Promise<LoginAttemptRecord[]> {
    return LoginAttemptModel.find({ key: { $in: keys } }).lean<LoginAttemptRecord[]>();
  }

  async recordFailure(key: string, at: Date): Promise<void> {
    await LoginAttemptModel.updateOne(
      { key },
      { $inc: { failures: 1 }, $set: { lastFailureAt: at, expireAt: new Date(at.getTime() + FORGET_AFTER_MS) } },
      { upsert: true },
    );
  }

  async clear(key: string): Promise<void> {
    await LoginAttemptModel.deleteOne({ key });
  }
}
