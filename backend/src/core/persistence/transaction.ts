import mongoose, { type ClientSession } from 'mongoose';

export type Session = ClientSession;

/**
 * Runs work inside a MongoDB multi-document transaction. The driver retries the callback on
 * transient errors (e.g. write conflicts between concurrent checkouts), so callbacks must
 * rebuild all in-memory state from what they read inside the session.
 */
export class TransactionRunner {
  async run<T>(work: (session: Session) => Promise<T>): Promise<T> {
    const session = await mongoose.startSession();
    try {
      let result!: T;
      await session.withTransaction(
        async () => {
          result = await work(session);
        },
        { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
      );
      return result;
    } finally {
      await session.endSession();
    }
  }
}
