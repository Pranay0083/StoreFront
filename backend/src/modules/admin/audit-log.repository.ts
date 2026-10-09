import type { Role } from '@storefront/contracts';
import type { FilterQuery } from 'mongoose';
import { AuditLogModel, type AuditLogRecord } from './audit-log.model';

export interface NewAuditLog {
  actorId: string;
  actorEmail: string;
  actorRole: Role;
  permissions: string[];
  method: string;
  path: string;
  status: number;
  targets: string[];
  summary: string;
  changes?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

export interface AuditLogFilter {
  actorId?: string;
  target?: string;
  before?: string;
}

export class AuditLogRepository {
  async create(entry: NewAuditLog): Promise<void> {
    await AuditLogModel.create(entry);
  }

  /** Newest first, keyset-paginated on _id so pages stay stable while new entries arrive. */
  list(filter: AuditLogFilter, limit: number): Promise<AuditLogRecord[]> {
    const query: FilterQuery<AuditLogRecord> = {};
    if (filter.actorId) query.actorId = filter.actorId;
    if (filter.target) query.targets = filter.target;
    if (filter.before) query._id = { $lt: filter.before };
    return AuditLogModel.find(query).sort({ _id: -1 }).limit(limit).lean<AuditLogRecord[]>();
  }
}
