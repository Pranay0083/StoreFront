import type { Migration } from '../migration';

export const experimentsIndexes: Migration = {
  id: '070-experiments',
  description: 'Index feature flags, experiments, sticky assignments and attributed conversions',
  async up(db) {
    await db.collection('feature_flags').createIndex({ key: 1 }, { unique: true });
    await db.collection('experiments').createIndex({ key: 1 }, { unique: true });
    await db.collection('experiments').createIndex({ status: 1 });
    const assignments = db.collection('experiment_assignments');
    await assignments.createIndex({ experimentKey: 1, subjectId: 1 }, { unique: true });
    await assignments.createIndex({ userId: 1 }, { sparse: true });
    await assignments.createIndex({ experimentKey: 1, variant: 1, exposures: 1 });
    const conversions = db.collection('experiment_conversions');
    await conversions.createIndex({ experimentKey: 1, orderId: 1 }, { unique: true });
    await conversions.createIndex({ experimentKey: 1, variant: 1 });
  },
};
