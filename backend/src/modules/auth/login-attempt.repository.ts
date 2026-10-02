import { LoginAttemptModel, type LoginAttemptRecord } from './login-attempt.model';

export class LoginAttemptRepository {
  find(identifier: string): Promise<LoginAttemptRecord | null> {
    return LoginAttemptModel.findOne({ identifier }).lean<LoginAttemptRecord>();
  }

  async recordFailure(identifier: string, count: number, lockedUntil?: Date): Promise<void> {
    await LoginAttemptModel.updateOne({ identifier }, { $set: { count, ...(lockedUntil && { lockedUntil }) } }, { upsert: true });
  }

  async clear(identifier: string): Promise<void> {
    await LoginAttemptModel.deleteOne({ identifier });
  }
}
