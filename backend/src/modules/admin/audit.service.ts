import type { AuditLogEntry, AuditLogPage, AuditLogQuery } from '@storefront/contracts';
import type { AuditLogRecord } from './audit-log.model';
import type { AuditLogRepository, NewAuditLog } from './audit-log.repository';

const toEntry = (r: AuditLogRecord): AuditLogEntry => ({
  id: String(r._id),
  actor: { id: String(r.actorId), email: r.actorEmail, role: r.actorRole },
  permissions: r.permissions,
  method: r.method,
  path: r.path,
  status: r.status,
  targets: r.targets,
  summary: r.summary,
  ...(r.changes && { changes: r.changes as Record<string, unknown> }),
  ...(r.ip && { ip: r.ip }),
  ...(r.userAgent && { userAgent: r.userAgent }),
  at: r.createdAt.toISOString(),
});

export class AuditService {
  constructor(private readonly logs: AuditLogRepository) {}

  record(entry: NewAuditLog): Promise<void> {
    return this.logs.create(entry);
  }

  async list(query: AuditLogQuery): Promise<AuditLogPage> {
    const rows = await this.logs.list({ actorId: query.actorId, target: query.target, before: query.before }, query.limit + 1);
    const page = rows.slice(0, query.limit);
    return {
      entries: page.map(toEntry),
      nextCursor: rows.length > query.limit ? String(page.at(-1)!._id) : null,
    };
  }
}
