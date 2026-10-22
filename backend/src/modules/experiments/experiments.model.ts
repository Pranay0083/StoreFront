import type { Audience, ExperimentStatus, ExperimentVariant } from '@storefront/contracts';
import mongoose, { Schema } from 'mongoose';

const audience = { roles: [String], segments: [String] };

export interface FlagRecord {
  key: string;
  description: string;
  enabled: boolean;
  rolloutPercent: number;
  audience: Audience;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const flagSchema = new Schema<FlagRecord>(
  {
    key: { type: String, required: true, unique: true },
    description: { type: String, default: '' },
    enabled: { type: Boolean, default: false },
    rolloutPercent: { type: Number, default: 100 },
    audience: { type: audience, default: {} },
    updatedBy: { type: String, required: true },
  },
  { timestamps: true, versionKey: false, minimize: false },
);
export const FeatureFlagModel = mongoose.model<FlagRecord>('FeatureFlag', flagSchema, 'feature_flags');

export interface ExperimentRecord {
  key: string;
  name: string;
  hypothesis: string;
  status: ExperimentStatus;
  variants: ExperimentVariant[];
  audience: Audience;
  minSamplePerVariant: number;
  startedAt?: Date;
  endedAt?: Date;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const experimentSchema = new Schema<ExperimentRecord>(
  {
    key: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    hypothesis: { type: String, default: '' },
    status: { type: String, required: true },
    variants: [{ _id: false, key: String, weight: Number, description: { type: String, default: '' } }],
    audience: { type: audience, default: {} },
    minSamplePerVariant: { type: Number, default: 200 },
    startedAt: Date,
    endedAt: Date,
    updatedBy: { type: String, required: true },
  },
  { timestamps: true, versionKey: false, minimize: false },
);
export const ExperimentModel = mongoose.model<ExperimentRecord>('Experiment', experimentSchema, 'experiments');

/** Sticky assignment of one subject to one variant; `exposures` counts renders the client reported. */
export interface AssignmentRecord {
  experimentKey: string;
  subjectId: string;
  userId?: string;
  variant: string;
  exposures: number;
  assignedAt: Date;
  firstExposedAt?: Date;
  lastExposedAt?: Date;
}

const assignmentSchema = new Schema<AssignmentRecord>(
  {
    experimentKey: { type: String, required: true },
    subjectId: { type: String, required: true },
    userId: String,
    variant: { type: String, required: true },
    exposures: { type: Number, default: 0 },
    assignedAt: { type: Date, required: true },
    firstExposedAt: Date,
    lastExposedAt: Date,
  },
  { versionKey: false },
);
assignmentSchema.index({ experimentKey: 1, subjectId: 1 }, { unique: true });
assignmentSchema.index({ userId: 1 }, { sparse: true });
assignmentSchema.index({ experimentKey: 1, variant: 1, exposures: 1 });
export const ExperimentAssignmentModel = mongoose.model<AssignmentRecord>(
  'ExperimentAssignment',
  assignmentSchema,
  'experiment_assignments',
);

export interface ConversionRecord {
  experimentKey: string;
  variant: string;
  subjectId: string;
  orderId: string;
  revenue: number;
  convertedAt: Date;
}

const conversionSchema = new Schema<ConversionRecord>(
  {
    experimentKey: { type: String, required: true },
    variant: { type: String, required: true },
    subjectId: { type: String, required: true },
    orderId: { type: String, required: true },
    revenue: { type: Number, required: true },
    convertedAt: { type: Date, required: true },
  },
  { versionKey: false },
);
conversionSchema.index({ experimentKey: 1, orderId: 1 }, { unique: true });
conversionSchema.index({ experimentKey: 1, variant: 1 });
export const ExperimentConversionModel = mongoose.model<ConversionRecord>(
  'ExperimentConversion',
  conversionSchema,
  'experiment_conversions',
);
