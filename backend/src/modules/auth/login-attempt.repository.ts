import { LoginAttemptModel, type LoginAttemptRecord } from './login-attempt.model';

const FORGET_AFTER_MS = 24 * 60 * 60 * 1000;

export class LoginAttemptRepository {
  findMany(identifiers: string[]): Promise<LoginAttemptRecord[]> {
    return LoginAttemptModel.find({ identifier: { $in: identifiers } }).lean<LoginAttemptRecord[]>();
  }

  async recordFailure(identifier: string, at: Date): Promise<void> {
    await LoginAttemptModel.updateOne(
      { identifier },
      { $inc: { failures: 1 }, $set: { lastFailureAt: at, expireAt: new Date(at.getTime() + FORGET_AFTER_MS) } },
      { upsert: true },
    );
  }

  async clear(identifier: string): Promise<void> {
    await LoginAttemptModel.deleteOne({ identifier });
  }
}
