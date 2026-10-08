import { z } from 'zod';
import { ROLES, type Role } from './rbac';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export interface AuditLogEntry {
  id: string;
  actor: { id: string; email: string; role: Role };
  permissions: string[];
  method: string;
  path: string;
  status: number;
  targets: string[];
  summary: string;
  changes?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  at: string;
}

export interface AuditLogPage {
  entries: AuditLogEntry[];
  /** Pass as `before` to fetch the next (older) page; null when there are no more entries. */
  nextCursor: string | null;
}

export const AuditLogQuerySchema = z.object({
  actorId: objectId.optional().catch(undefined),
  target: z.string().max(64).optional().catch(undefined),
  before: objectId.optional().catch(undefined),
  limit: z.coerce
    .number()
    .int()
    .catch(25)
    .transform(n => Math.min(100, Math.max(1, n))),
});
export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: string;
}

export interface AdminUserPage {
  users: AdminUser[];
  total: number;
  page: number;
  pages: number;
}

export const AdminUsersQuerySchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  role: z.enum(ROLES).optional().catch(undefined),
  page: z.coerce
    .number()
    .int()
    .catch(1)
    .transform(n => Math.max(1, n)),
});
export type AdminUsersQuery = z.infer<typeof AdminUsersQuerySchema>;

export const UpdateUserRoleSchema = z.object({ role: z.enum(ROLES, { required_error: 'Role is required' }) }).strict();
export type UpdateUserRoleInput = z.infer<typeof UpdateUserRoleSchema>;
