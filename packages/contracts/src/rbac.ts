export const ROLES = ['customer', 'support', 'fulfillment', 'catalog_manager', 'admin'] as const;
export type Role = (typeof ROLES)[number];
export type StaffRole = Exclude<Role, 'customer'>;
export const STAFF_ROLES = ROLES.filter((r): r is StaffRole => r !== 'customer');

export const PERMISSIONS = [
  'dashboard:read',
  'catalog:write',
  'orders:read',
  'orders:manage',
  'promotions:write',
  'chats:read',
  'audit:read',
  'users:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Single source of truth for who may do what; the API enforces it and the UI hides what you cannot use. */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  customer: [],
  support: ['dashboard:read', 'orders:read', 'chats:read'],
  fulfillment: ['dashboard:read', 'orders:read', 'orders:manage'],
  catalog_manager: ['dashboard:read', 'catalog:write', 'promotions:write'],
  admin: PERMISSIONS,
};

export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  customer: 'Customer',
  support: 'Support',
  fulfillment: 'Fulfillment',
  catalog_manager: 'Catalog manager',
  admin: 'Admin',
};

export const permissionsFor = (role: Role): Permission[] => [...(ROLE_PERMISSIONS[role] ?? [])];
export const hasPermission = (role: Role, permission: Permission): boolean => ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
export const isStaff = (role: Role): role is StaffRole => role !== 'customer';
