import { z } from 'zod';
import type { Paise } from './money';
import { ROLES } from './rbac';

const key = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{1,48}$/, 'Keys are 2-49 lowercase letters, digits or dashes');

export const AUDIENCE_SEGMENTS = ['guest', 'signedIn', 'staff'] as const;
export type AudienceSegment = (typeof AUDIENCE_SEGMENTS)[number];

export const AudienceSchema = z
  .object({
    roles: z.array(z.enum(ROLES)).max(ROLES.length).optional(),
    segments: z.array(z.enum(AUDIENCE_SEGMENTS)).max(AUDIENCE_SEGMENTS.length).optional(),
  })
  .strict();
export type Audience = z.infer<typeof AudienceSchema>;

export const FlagInputSchema = z
  .object({
    key,
    description: z.string().trim().max(300).default(''),
    enabled: z.boolean().default(false),
    rolloutPercent: z.number().min(0).max(100).default(100),
    audience: AudienceSchema.default({}),
  })
  .strict();
export type FlagInput = z.infer<typeof FlagInputSchema>;
export const FlagUpdateSchema = FlagInputSchema.omit({ key: true }).partial().strict();
export type FlagUpdate = z.infer<typeof FlagUpdateSchema>;

export interface FeatureFlag extends FlagInput {
  updatedAt: string;
  updatedBy: string;
}

export const EXPERIMENT_STATUSES = ['draft', 'running', 'paused', 'completed'] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

export const VariantSchema = z
  .object({
    key,
    weight: z.number().int().min(0).max(100),
    description: z.string().trim().max(200).default(''),
  })
  .strict();
export type ExperimentVariant = z.infer<typeof VariantSchema>;

const experimentFields = {
  key,
  name: z.string().trim().min(3).max(80),
  hypothesis: z.string().trim().max(500).default(''),
  status: z.enum(EXPERIMENT_STATUSES).default('draft'),
  variants: z
    .array(VariantSchema)
    .min(2, 'An experiment needs a control and at least one treatment')
    .max(5)
    .refine(vs => new Set(vs.map(v => v.key)).size === vs.length, 'Variant keys must be unique')
    .refine(vs => vs.reduce((s, v) => s + v.weight, 0) === 100, 'Variant weights must add up to 100'),
  audience: AudienceSchema.default({}),
  minSamplePerVariant: z.number().int().min(10).max(1_000_000).default(200),
};

/** The first variant is the control every other variant is compared against. */
export const ExperimentInputSchema = z.object(experimentFields).strict();
export type ExperimentInput = z.infer<typeof ExperimentInputSchema>;
export const ExperimentUpdateSchema = z.object(experimentFields).omit({ key: true }).partial().strict();
export type ExperimentUpdate = z.infer<typeof ExperimentUpdateSchema>;

export interface Experiment extends ExperimentInput {
  startedAt?: string;
  endedAt?: string;
  updatedAt: string;
  updatedBy: string;
}

export const AnonymousIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Invalid anonymous id');

export const EvaluateQuerySchema = z.object({ anonymousId: AnonymousIdSchema.optional() });
export type EvaluateQuery = z.infer<typeof EvaluateQuerySchema>;

export interface Evaluation {
  /** Subject the assignments are keyed on; clients persist it to stay in the same bucket. */
  subjectId: string;
  flags: Record<string, boolean>;
  experiments: Record<string, string>;
}

export const ExposureInputSchema = z.object({ experiment: key, anonymousId: AnonymousIdSchema.optional() }).strict();
export type ExposureInput = z.infer<typeof ExposureInputSchema>;

export interface VariantResult {
  variant: string;
  visitors: number;
  conversions: number;
  conversionRate: number;
  revenue: Paise;
  revenuePerVisitor: Paise;
}

export interface VariantComparison {
  variant: string;
  control: string;
  absoluteLift: number;
  relativeLift: number | null;
  zScore: number | null;
  pValue: number | null;
  significant: boolean;
}

export interface ExperimentResults {
  experiment: string;
  status: ExperimentStatus;
  variants: VariantResult[];
  comparisons: VariantComparison[];
  warnings: string[];
  alpha: number;
}
