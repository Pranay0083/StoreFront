import type { ConditionSpec } from '@storefront/contracts';
import { buildCondition } from '../pricing/domain/condition.factory';
import { GUEST } from '../pricing/domain/pricing-line';

const HOUR_MS = 3_600_000;
/** IST is UTC+05:30 all year, so store-clock hours turn at half past every UTC hour. */
const IST_OFFSET_MS = 5.5 * HOUR_MS;
/** How far ahead boundaries are looked for; a later boundary is found again when this one passes. */
export const SCHEDULE_HORIZON_MS = 8 * 24 * HOUR_MS;

export interface Scheduled {
  status?: string;
  startsAt?: Date | null;
  endsAt?: Date | null;
  conditions?: ConditionSpec | null;
}

const isTemporal = (spec: ConditionSpec): boolean => {
  switch (spec.type) {
    case 'dateWindow':
      return true;
    case 'all':
    case 'any':
      return spec.conditions.every(isTemporal);
    case 'not':
      return isTemporal(spec.condition);
    default:
      return false;
  }
};

/**
 * The time parts of a condition tree at `now`. Other leaves (spend, segment, payment) depend on the
 * shopper's bag, so they count as satisfiable: an offer is shown unless the clock alone rules it out.
 */
export function scheduleAllows(spec: ConditionSpec | null | undefined, now: Date): boolean {
  if (!spec) return true;
  switch (spec.type) {
    case 'all':
      return spec.conditions.every(c => scheduleAllows(c, now));
    case 'any':
      return spec.conditions.some(c => scheduleAllows(c, now));
    case 'not':
      return isTemporal(spec.condition) ? !scheduleAllows(spec.condition, now) : true;
    case 'dateWindow':
      return buildCondition(spec).isSatisfiedBy({ now, lines: [], merchandiseSubtotal: 0, customer: GUEST });
    default:
      return true;
  }
}

/** Live by the clock alone: inside startsAt/endsAt and every date window. */
export function liveByTime(p: Scheduled, now: Date): boolean {
  if (p.startsAt && now < p.startsAt) return false;
  if (p.endsAt && now >= p.endsAt) return false;
  return scheduleAllows(p.conditions, now);
}

function windows(spec: ConditionSpec | null | undefined): Array<Extract<ConditionSpec, { type: 'dateWindow' }>> {
  if (!spec) return [];
  switch (spec.type) {
    case 'dateWindow':
      return [spec];
    case 'all':
    case 'any':
      return spec.conditions.flatMap(windows);
    case 'not':
      return windows(spec.condition);
    default:
      return [];
  }
}

function nextStoreHour(after: Date): number {
  const shifted = after.getTime() + IST_OFFSET_MS;
  return Math.floor(shifted / HOUR_MS) * HOUR_MS + HOUR_MS - IST_OFFSET_MS;
}

/**
 * The first moment after `now` (within the horizon) at which the promotion starts or stops being
 * live by the clock: its start or end, a date window's edge, or the turn of a store hour inside a
 * recurring window (days of the week, hours of the day). Undefined when nothing changes in time.
 */
export function nextBoundary(p: Scheduled, now: Date, horizonMs = SCHEDULE_HORIZON_MS): Date | undefined {
  if (p.status !== undefined && p.status !== 'active') return undefined;
  const limit = now.getTime() + horizonMs;
  const dated = windows(p.conditions);
  const candidates = new Set<number>();
  for (const d of [p.startsAt, p.endsAt, ...dated.flatMap(w => [w.from, w.to].map(v => (v ? new Date(v) : undefined)))]) {
    if (d && d.getTime() > now.getTime() && d.getTime() <= limit) candidates.add(d.getTime());
  }
  if (dated.some(w => w.daysOfWeek || w.hours)) {
    for (let t = nextStoreHour(now); t <= limit; t += HOUR_MS) candidates.add(t);
  }
  const current = liveByTime(p, now);
  for (const t of [...candidates].sort((a, b) => a - b)) {
    if (liveByTime(p, new Date(t)) !== current) return new Date(t);
  }
  return undefined;
}
