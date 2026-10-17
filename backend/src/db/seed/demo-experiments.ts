import type { mongo } from 'mongoose';

export const NEAR_MISS_EXPERIMENT = 'checkout-near-miss';

/** The demo experiment the cart/checkout pages read: are "add one more item" nudges worth showing? */
export async function seedDemoExperiments(db: mongo.Db): Promise<void> {
  const now = new Date();
  await db.collection('experiments').updateOne(
    { key: NEAR_MISS_EXPERIMENT },
    {
      $setOnInsert: {
        key: NEAR_MISS_EXPERIMENT,
        name: 'Near-miss offer suggestions in the bag',
        hypothesis: 'Showing "add one more item to unlock" nudges raises paid conversion without hurting revenue per visitor.',
        status: 'running',
        variants: [
          { key: 'shown', weight: 50, description: 'Near-miss suggestions are shown (control)' },
          { key: 'hidden', weight: 50, description: 'Near-miss suggestions are hidden' },
        ],
        audience: {},
        minSamplePerVariant: 200,
        startedAt: now,
        updatedBy: 'system:seed',
        createdAt: now,
        updatedAt: now,
      },
    },
    { upsert: true },
  );
}
