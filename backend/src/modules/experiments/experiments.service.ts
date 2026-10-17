import { randomUUID } from 'node:crypto';
import type {
  Evaluation,
  Experiment,
  ExperimentInput,
  ExperimentResults,
  ExperimentStatus,
  ExperimentUpdate,
  FeatureFlag,
  FlagInput,
  FlagUpdate,
  VariantComparison,
  VariantResult,
} from '@storefront/contracts';
import type { CacheObserver, CacheProvider } from '../../core/cache/cache';
import { CacheNamespace } from '../../core/cache/cache';
import { ConflictError, NotFoundError } from '../../core/errors';
import type { AuthUser } from '../../core/http/types';
import { inRollout, matchesAudience, pickVariant } from './bucketing';
import {
  ExperimentAssignmentModel,
  ExperimentConversionModel,
  ExperimentModel,
  FeatureFlagModel,
  type ExperimentRecord,
  type FlagRecord,
} from './experiments.model';
import { twoProportionZTest } from './stats';

export const ALPHA = 0.05;
const SRM_TOLERANCE = 0.05;
const SRM_MIN_VISITORS = 500;

const STATUS_TRANSITIONS: Record<ExperimentStatus, ExperimentStatus[]> = {
  draft: ['running'],
  running: ['paused', 'completed'],
  paused: ['running', 'completed'],
  completed: [],
};

interface Definitions {
  flags: FlagRecord[];
  experiments: ExperimentRecord[];
}

type Viewer = Pick<AuthUser, 'id' | 'role'> | undefined;

const toFlag = (f: FlagRecord): FeatureFlag => ({
  key: f.key,
  description: f.description,
  enabled: f.enabled,
  rolloutPercent: f.rolloutPercent,
  audience: f.audience ?? {},
  updatedBy: f.updatedBy,
  updatedAt: new Date(f.updatedAt).toISOString(),
});

const toExperiment = (e: ExperimentRecord): Experiment => ({
  key: e.key,
  name: e.name,
  hypothesis: e.hypothesis,
  status: e.status,
  variants: e.variants.map(v => ({ key: v.key, weight: v.weight, description: v.description ?? '' })),
  audience: e.audience ?? {},
  minSamplePerVariant: e.minSamplePerVariant,
  startedAt: e.startedAt ? new Date(e.startedAt).toISOString() : undefined,
  endedAt: e.endedAt ? new Date(e.endedAt).toISOString() : undefined,
  updatedBy: e.updatedBy,
  updatedAt: new Date(e.updatedAt).toISOString(),
});

export class ExperimentsService {
  private readonly definitionsCache: CacheNamespace;

  constructor(cache: CacheProvider, ttlSeconds = 30, observer?: CacheObserver) {
    this.definitionsCache = new CacheNamespace(cache, 'experiments', ttlSeconds, observer);
  }

  private definitions(): Promise<Definitions> {
    return this.definitionsCache.getOrLoad('definitions', async () => ({
      flags: await FeatureFlagModel.find().lean<FlagRecord[]>(),
      experiments: await ExperimentModel.find({ status: 'running' }).lean<ExperimentRecord[]>(),
    }));
  }

  invalidate(): Promise<void> {
    return this.definitionsCache.invalidate();
  }

  /**
   * Anonymous visitors are keyed on their client id; signing in links that id to the user so the
   * assignment survives login. Without a client id a signed-in user is keyed on their account.
   */
  private subjectFor(viewer: Viewer, anonymousId?: string): string {
    return anonymousId ?? (viewer ? `user:${viewer.id}` : `anon_${randomUUID().replace(/-/g, '')}`);
  }

  async evaluate(viewer: Viewer, anonymousId?: string): Promise<Evaluation> {
    const subjectId = this.subjectFor(viewer, anonymousId);
    const { flags, experiments } = await this.definitions();
    if (viewer && anonymousId) {
      await ExperimentAssignmentModel.updateMany({ subjectId: anonymousId, userId: { $exists: false } }, { $set: { userId: viewer.id } });
    }

    const rolloutSubject = viewer ? `user:${viewer.id}` : subjectId;
    const flagValues: Record<string, boolean> = {};
    for (const flag of flags) {
      flagValues[flag.key] =
        flag.enabled && matchesAudience(flag.audience, viewer ?? {}) && inRollout(flag.key, rolloutSubject, flag.rolloutPercent);
    }

    const eligible = experiments.filter(e => matchesAudience(e.audience, viewer ?? {}));
    const assignments: Record<string, string> = {};
    if (eligible.length) {
      const existing = await ExperimentAssignmentModel.find({
        experimentKey: { $in: eligible.map(e => e.key) },
        $or: [{ subjectId }, ...(viewer ? [{ userId: viewer.id }, { subjectId: `user:${viewer.id}` }] : [])],
      })
        .sort({ assignedAt: 1 })
        .lean();
      for (const a of existing) assignments[a.experimentKey] ??= a.variant;
      for (const experiment of eligible) {
        if (assignments[experiment.key]) continue;
        const variant = pickVariant(experiment.key, subjectId, experiment.variants);
        const stored = await ExperimentAssignmentModel.findOneAndUpdate(
          { experimentKey: experiment.key, subjectId },
          {
            $setOnInsert: { variant, assignedAt: new Date(), exposures: 0, ...(viewer && { userId: viewer.id }) },
          },
          { upsert: true, new: true },
        ).lean();
        assignments[experiment.key] = stored!.variant;
      }
    }
    return { subjectId, flags: flagValues, experiments: assignments };
  }

  /** Counts the subject as a visitor only once a variant was actually rendered to them. */
  async recordExposure(experimentKey: string, viewer: Viewer, anonymousId?: string): Promise<boolean> {
    const now = new Date();
    const subjects = [
      ...(anonymousId ? [{ subjectId: anonymousId }] : []),
      ...(viewer ? [{ userId: viewer.id }, { subjectId: `user:${viewer.id}` }] : []),
    ];
    if (!subjects.length) return false;
    const assignment = await ExperimentAssignmentModel.findOneAndUpdate(
      { experimentKey, $or: subjects },
      { $inc: { exposures: 1 }, $set: { lastExposedAt: now }, $min: { firstExposedAt: now } },
      { sort: { assignedAt: 1 } },
    ).lean();
    return assignment !== null;
  }

  /** Attributes a paid order to every running experiment the buyer was exposed to before paying. Idempotent per order. */
  async recordConversion(order: { orderId: string; userId: string; total: number }, at: Date): Promise<number> {
    const running = (await this.definitions()).experiments.map(e => e.key);
    if (!running.length) return 0;
    const exposed = await ExperimentAssignmentModel.find({
      experimentKey: { $in: running },
      exposures: { $gt: 0 },
      firstExposedAt: { $lte: at },
      $or: [{ userId: order.userId }, { subjectId: `user:${order.userId}` }],
    })
      .sort({ firstExposedAt: 1 })
      .lean();
    const firstPerExperiment = new Map(exposed.reverse().map(a => [a.experimentKey, a]));
    let recorded = 0;
    for (const a of firstPerExperiment.values()) {
      const res = await ExperimentConversionModel.updateOne(
        { experimentKey: a.experimentKey, orderId: order.orderId },
        { $setOnInsert: { variant: a.variant, subjectId: a.subjectId, revenue: order.total, convertedAt: at } },
        { upsert: true },
      );
      recorded += res.upsertedCount;
    }
    return recorded;
  }

  async results(key: string): Promise<ExperimentResults> {
    const experiment = await this.requireExperiment(key);
    const [visitorRows, conversionRows] = await Promise.all([
      ExperimentAssignmentModel.aggregate<{ _id: string; visitors: number }>([
        { $match: { experimentKey: key, exposures: { $gt: 0 } } },
        { $group: { _id: '$variant', visitors: { $sum: 1 } } },
      ]),
      ExperimentConversionModel.aggregate<{ _id: string; subjects: string[]; revenue: number }>([
        { $match: { experimentKey: key } },
        { $group: { _id: '$variant', subjects: { $addToSet: '$subjectId' }, revenue: { $sum: '$revenue' } } },
      ]),
    ]);
    const visitors = new Map(visitorRows.map(r => [r._id, r.visitors]));
    const conversions = new Map(conversionRows.map(r => [r._id, r]));

    const variants: VariantResult[] = experiment.variants.map(v => {
      const n = visitors.get(v.key) ?? 0;
      const c = conversions.get(v.key);
      const converted = Math.min(n, c?.subjects.length ?? 0);
      const revenue = c?.revenue ?? 0;
      return {
        variant: v.key,
        visitors: n,
        conversions: converted,
        conversionRate: n ? converted / n : 0,
        revenue,
        revenuePerVisitor: n ? Math.round(revenue / n) : 0,
      };
    });

    const warnings: string[] = [];
    const underpowered = variants.filter(v => v.visitors < experiment.minSamplePerVariant);
    if (underpowered.length) {
      warnings.push(
        `Below the minimum sample of ${experiment.minSamplePerVariant} visitors per variant: ${underpowered.map(v => `${v.variant} (${v.visitors})`).join(', ')}. Results are not conclusive yet.`,
      );
    }
    const total = variants.reduce((s, v) => s + v.visitors, 0);
    if (total >= SRM_MIN_VISITORS) {
      for (const v of experiment.variants) {
        const observed = (visitors.get(v.key) ?? 0) / total;
        if (Math.abs(observed - v.weight / 100) > SRM_TOLERANCE) {
          warnings.push(
            `Sample ratio mismatch: ${v.key} received ${(observed * 100).toFixed(1)}% of visitors but is weighted ${v.weight}%.`,
          );
        }
      }
    }

    const [control, ...treatments] = variants;
    const comparisons: VariantComparison[] = treatments.map(t => {
      const { zScore, pValue } = twoProportionZTest(control.conversions, control.visitors, t.conversions, t.visitors);
      const absoluteLift = t.conversionRate - control.conversionRate;
      return {
        variant: t.variant,
        control: control.variant,
        absoluteLift,
        relativeLift: control.conversionRate > 0 ? absoluteLift / control.conversionRate : null,
        zScore,
        pValue,
        significant: pValue !== null && pValue < ALPHA && underpowered.length === 0,
      };
    });

    return { experiment: key, status: experiment.status, variants, comparisons, warnings, alpha: ALPHA };
  }

  async listFlags(): Promise<FeatureFlag[]> {
    return (await FeatureFlagModel.find().sort({ key: 1 }).lean<FlagRecord[]>()).map(toFlag);
  }

  async createFlag(input: FlagInput, actor: string): Promise<FeatureFlag> {
    if (await FeatureFlagModel.exists({ key: input.key })) throw new ConflictError(`Flag ${input.key} already exists`);
    const flag = await FeatureFlagModel.create({ ...input, updatedBy: actor });
    await this.invalidate();
    return toFlag(flag.toObject());
  }

  async updateFlag(key: string, patch: FlagUpdate, actor: string): Promise<FeatureFlag> {
    const flag = await FeatureFlagModel.findOneAndUpdate(
      { key },
      { $set: { ...patch, updatedBy: actor } },
      { new: true },
    ).lean<FlagRecord>();
    if (!flag) throw new NotFoundError('Flag not found');
    await this.invalidate();
    return toFlag(flag);
  }

  async deleteFlag(key: string): Promise<void> {
    const { deletedCount } = await FeatureFlagModel.deleteOne({ key });
    if (!deletedCount) throw new NotFoundError('Flag not found');
    await this.invalidate();
  }

  async listExperiments(): Promise<Experiment[]> {
    return (await ExperimentModel.find().sort({ createdAt: -1 }).lean<ExperimentRecord[]>()).map(toExperiment);
  }

  async getExperiment(key: string): Promise<Experiment> {
    return toExperiment(await this.requireExperiment(key));
  }

  async createExperiment(input: ExperimentInput, actor: string): Promise<Experiment> {
    if (await ExperimentModel.exists({ key: input.key })) throw new ConflictError(`Experiment ${input.key} already exists`);
    if (input.status !== 'draft' && input.status !== 'running') throw new ConflictError('New experiments start as draft or running');
    const experiment = await ExperimentModel.create({
      ...input,
      ...(input.status === 'running' && { startedAt: new Date() }),
      updatedBy: actor,
    });
    await this.invalidate();
    return toExperiment(experiment.toObject());
  }

  async updateExperiment(key: string, patch: ExperimentUpdate, actor: string): Promise<Experiment> {
    const current = await this.requireExperiment(key);
    const set: Record<string, unknown> = { ...patch, updatedBy: actor };
    if (patch.variants && current.startedAt) {
      const before = current.variants.map(v => `${v.key}:${v.weight}`).join(',');
      const after = patch.variants.map(v => `${v.key}:${v.weight}`).join(',');
      if (before !== after) throw new ConflictError('Variants and weights are locked once an experiment has started');
    }
    if (patch.status && patch.status !== current.status) {
      if (!STATUS_TRANSITIONS[current.status].includes(patch.status)) {
        throw new ConflictError(`Illegal experiment transition: ${current.status} → ${patch.status}`);
      }
      if (patch.status === 'running' && !current.startedAt) set.startedAt = new Date();
      if (patch.status === 'completed') set.endedAt = new Date();
    }
    const updated = await ExperimentModel.findOneAndUpdate({ key }, { $set: set }, { new: true }).lean<ExperimentRecord>();
    await this.invalidate();
    return toExperiment(updated!);
  }

  async deleteExperiment(key: string): Promise<void> {
    const current = await this.requireExperiment(key);
    if (current.status !== 'draft') throw new ConflictError('Only draft experiments can be deleted; complete it instead');
    await ExperimentModel.deleteOne({ key });
    await this.invalidate();
  }

  private async requireExperiment(key: string): Promise<ExperimentRecord> {
    const experiment = await ExperimentModel.findOne({ key }).lean<ExperimentRecord>();
    if (!experiment) throw new NotFoundError('Experiment not found');
    return experiment;
  }
}
