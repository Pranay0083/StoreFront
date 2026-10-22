import { createHash } from 'node:crypto';
import { isStaff, type Audience, type ExperimentVariant, type Role } from '@storefront/contracts';

/** Uniform, deterministic position in [0, 1) for a subject under a salt; the same inputs always land in the same bucket. */
export function bucket(salt: string, subjectId: string): number {
  const digest = createHash('sha256').update(`${salt}:${subjectId}`).digest();
  return digest.readUInt32BE(0) / 0x1_0000_0000;
}

/** Percentage rollout: the subject is in when its bucket falls below the rollout share. */
export function inRollout(flagKey: string, subjectId: string, rolloutPercent: number): boolean {
  if (rolloutPercent >= 100) return true;
  if (rolloutPercent <= 0) return false;
  return bucket(`flag:${flagKey}`, subjectId) * 100 < rolloutPercent;
}

/** Weighted variant pick; a separate salt from flags so rollouts and experiments are independent. */
export function pickVariant(experimentKey: string, subjectId: string, variants: readonly ExperimentVariant[]): string {
  const total = variants.reduce((s, v) => s + v.weight, 0);
  if (total <= 0) return variants[0].key;
  const point = bucket(`experiment:${experimentKey}`, subjectId) * total;
  let cumulative = 0;
  for (const v of variants) {
    cumulative += v.weight;
    if (point < cumulative) return v.key;
  }
  return variants[variants.length - 1].key;
}

export interface Viewer {
  role?: Role;
}

export function matchesAudience(audience: Audience | undefined, viewer: Viewer): boolean {
  if (!audience) return true;
  if (audience.roles?.length && (!viewer.role || !audience.roles.includes(viewer.role))) return false;
  if (audience.segments?.length) {
    const segments = new Set<string>([viewer.role ? 'signedIn' : 'guest', ...(viewer.role && isStaff(viewer.role) ? ['staff'] : [])]);
    if (!audience.segments.some(s => segments.has(s))) return false;
  }
  return true;
}
