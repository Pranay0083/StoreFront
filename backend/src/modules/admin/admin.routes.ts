import { Router } from 'express';
import { handler } from '../../core/http/handler';
import { validate } from '../../core/http/validate';
import type { AuthGuards } from '../auth/auth.guards';
import type { AdminController } from './admin.controller';
import {
  AdminOrdersQuerySchema,
  AdminUsersQuerySchema,
  AuditLogQuerySchema,
  BulkTransitionSchema,
  LowStockQuerySchema,
  RevenueQuerySchema,
  UpdateUserRoleSchema,
  UserIdParamsSchema,
} from './admin.schemas';
import type { StaffController } from './staff.controller';

export function adminRoutes(controller: AdminController, staff: StaffController, guards: AuthGuards): Router {
  const router = Router();
  const dashboard = guards.requirePermission('dashboard:read');
  router.use(guards.requireStaff);
  router.get('/stats', dashboard, handler(controller.stats));
  router.get('/revenue-by-day', dashboard, validate({ query: RevenueQuerySchema }), handler(controller.revenueByDay));
  router.get('/funnel', dashboard, handler(controller.funnel));
  router.get('/top-products', dashboard, handler(controller.topProducts));
  router.get('/low-stock', dashboard, validate({ query: LowStockQuerySchema }), handler(controller.lowStock));
  router.get('/orders', guards.requirePermission('orders:read'), validate({ query: AdminOrdersQuerySchema }), handler(controller.orders));
  router.post(
    '/orders/bulk-transition',
    guards.requirePermission('orders:manage'),
    validate({ body: BulkTransitionSchema }),
    handler(controller.bulkTransition),
  );
  router.get('/conversations', guards.requirePermission('chats:read'), handler(controller.conversations));
  router.get('/audit-log', guards.requirePermission('audit:read'), validate({ query: AuditLogQuerySchema }), handler(staff.auditLog));
  router.get('/users', guards.requirePermission('users:manage'), validate({ query: AdminUsersQuerySchema }), handler(staff.users));
  router.patch(
    '/users/:id/role',
    guards.requirePermission('users:manage'),
    validate({ params: UserIdParamsSchema, body: UpdateUserRoleSchema }),
    handler(staff.updateRole),
  );
  return router;
}
