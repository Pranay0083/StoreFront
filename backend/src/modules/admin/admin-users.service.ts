import type { AdminUser, AdminUserPage, AdminUsersQuery, Role } from '@storefront/contracts';
import { ConflictError, NotFoundError } from '../../core/errors';
import type { AuthUser } from '../../core/http/types';
import { logger } from '../../core/logger';
import type { UserRecord } from '../auth/user.model';
import type { UserRepository } from '../auth/user.repository';

const PAGE_SIZE = 20;

const toAdminUser = (u: UserRecord): AdminUser => ({
  id: String(u._id),
  email: u.email,
  name: u.name,
  role: u.role,
  createdAt: (u as UserRecord & { createdAt: Date }).createdAt.toISOString(),
});

export class AdminUsersService {
  constructor(private readonly users: UserRepository) {}

  async list(query: AdminUsersQuery): Promise<AdminUserPage> {
    const { users, total } = await this.users.search({ q: query.q, role: query.role }, query.page, PAGE_SIZE);
    return { users: users.map(toAdminUser), total, page: query.page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
  }

  async changeRole(actor: AuthUser, userId: string, role: Role): Promise<{ user: AdminUser; previous: Role }> {
    if (actor.id === userId) throw new ConflictError('You cannot change your own role');
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError('User not found');
    if (user.role === role) return { user: toAdminUser(user), previous: role };
    if (user.role === 'admin' && (await this.users.countByRole('admin')) <= 1) {
      throw new ConflictError('At least one admin is required');
    }
    const updated = await this.users.setRole(userId, role);
    if (!updated) throw new NotFoundError('User not found');
    logger.info({ actorId: actor.id, userId, from: user.role, to: role }, 'User role changed');
    return { user: toAdminUser(updated), previous: user.role };
  }
}
