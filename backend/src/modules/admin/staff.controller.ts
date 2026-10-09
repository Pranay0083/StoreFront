import type { AdminUsersQuery, AuditLogQuery, UpdateUserRoleInput } from '@storefront/contracts';
import type { Response } from 'express';
import type { AuthedReq, IdParams, Req } from '../../core/http/types';
import type { AdminUsersService } from './admin-users.service';
import type { AuditAnnotation } from './audit-trail';
import type { AuditService } from './audit.service';

export class StaffController {
  constructor(
    private readonly audit: AuditService,
    private readonly adminUsers: AdminUsersService,
  ) {}

  auditLog = async (req: Req<unknown, AuditLogQuery>, res: Response) => {
    res.json(await this.audit.list(req.query));
  };

  users = async (req: Req<unknown, AdminUsersQuery>, res: Response) => {
    res.json(await this.adminUsers.list(req.query));
  };

  updateRole = async (req: AuthedReq<UpdateUserRoleInput, unknown, IdParams>, res: Response) => {
    const { user, previous } = await this.adminUsers.changeRole(req.user, req.params.id, req.body.role);
    const audit: AuditAnnotation = { targets: [user.id], changes: { role: { from: previous, to: user.role }, email: user.email } };
    res.locals.audit = audit;
    res.json({ user });
  };
}
