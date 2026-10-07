import { describe, expect, it } from 'vitest';
import { hasPermission, isStaff, PERMISSIONS, permissionsFor, ROLE_PERMISSIONS, ROLES, STAFF_ROLES } from './rbac';

describe('rbac', () => {
  it('gives admins every permission and customers none', () => {
    expect(permissionsFor('admin')).toEqual([...PERMISSIONS]);
    expect(permissionsFor('customer')).toEqual([]);
  });

  it('keeps staff roles least-privileged', () => {
    expect(hasPermission('support', 'chats:read')).toBe(true);
    expect(hasPermission('support', 'orders:manage')).toBe(false);
    expect(hasPermission('fulfillment', 'orders:manage')).toBe(true);
    expect(hasPermission('fulfillment', 'catalog:write')).toBe(false);
    expect(hasPermission('catalog_manager', 'promotions:write')).toBe(true);
    expect(hasPermission('catalog_manager', 'users:manage')).toBe(false);
    for (const role of STAFF_ROLES.filter(r => r !== 'admin')) {
      expect(hasPermission(role, 'users:manage')).toBe(false);
      expect(hasPermission(role, 'audit:read')).toBe(false);
    }
  });

  it('maps every role and only known permissions', () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...ROLES].sort());
    for (const perms of Object.values(ROLE_PERMISSIONS)) for (const p of perms) expect(PERMISSIONS).toContain(p);
    expect(ROLES.filter(isStaff)).toEqual(STAFF_ROLES);
  });
});
