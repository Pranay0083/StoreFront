import mongoose, { type ClientSession } from 'mongoose';

export type Session = ClientSession;

export interface TransactionRetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: TransactionRetryPolicy = { maxAttempts: 25, baseDelayMs: 4, maxDelayMs: 250 };

const TRANSIENT = 'TransientTransactionError';
const UNKNOWN_COMMIT = 'UnknownTransactionCommitResult';

const hasLabel = (err: unknown, label: string) =>
  typeof (err as { hasErrorLabel?: unknown })?.hasErrorLabel === 'function' &&
  (err as { hasErrorLabel(l: string): boolean }).hasErrorLabel(label);

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Runs work inside a MongoDB multi-document transaction, retrying transient failures such as write
 * conflicts between concurrent checkouts. Unlike the driver's withTransaction, which retries
 * immediately, retries back off with full jitter so a hot document is not hammered by every loser
 * at once. Callbacks must rebuild all in-memory state from what they read inside the session.
 */
export class TransactionRunner {
  private attempts = 0;
  private retries = 0;

  constructor(
    private readonly policy: TransactionRetryPolicy = DEFAULT_RETRY_POLICY,
    private readonly random: () => number = Math.random,
  ) {}

  get stats() {
    return { attempts: this.attempts, retries: this.retries };
  }

  async run<T>(work: (session: Session) => Promise<T>): Promise<T> {
    const session = await mongoose.startSession();
    try {
      for (let attempt = 1; ; attempt++) {
        this.attempts++;
        session.startTransaction({ readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
        try {
          const result = await work(session);
          await this.commit(session);
          return result;
        } catch (err) {
          if (session.inTransaction()) await session.abortTransaction().catch(() => undefined);
          if (!hasLabel(err, TRANSIENT) || attempt >= this.policy.maxAttempts) throw err;
          this.retries++;
          await sleep(this.delay(attempt));
        }
      }
    } finally {
      await session.endSession();
    }
  }

  private async commit(session: Session): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await session.commitTransaction();
      } catch (err) {
        if (!hasLabel(err, UNKNOWN_COMMIT) || attempt >= this.policy.maxAttempts) throw err;
      }
    }
  }

  private delay(attempt: number): number {
    const ceiling = Math.min(this.policy.maxDelayMs, this.policy.baseDelayMs * 2 ** attempt);
    return Math.floor(this.random() * ceiling);
  }
}
