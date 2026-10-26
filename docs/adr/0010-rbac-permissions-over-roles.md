# ADR 0010: Permission-based RBAC instead of role checks

- **Status:** Accepted
- **Date:** 2026-10-31

## Context

Authorization was a single `role === 'admin'` check. Real stores have staff who should see orders but not edit the catalog (support), fulfil orders (fulfilment), or manage products and promotions (catalog managers).

## Decision

Roles (`customer`, `support`, `fulfillment`, `catalog_manager`, `admin`) map to permissions such as `orders:read`, `orders:manage`, `catalog:write`, `promotions:write`, `chats:read`, `audit:read`, `users:manage`, `jobs:manage` and `experiments:manage`. The map is defined once in `packages/contracts/src/rbac.ts` and shared by the API and UI. Routes declare `requirePermission(...)`, and authorization checks in services use permissions rather than role names. Every permission-guarded write is recorded in an audit log with actor, permission, route, targets and a redacted diff.

## Consequences

- **Positive:** least privilege per staff role, a UI that hides what a role cannot use, a permission-matrix test across roles, and a reviewable audit trail.
- **Negative:** new endpoints must pick the right permission. The matrix test and the OpenAPI metadata, which lists each route's permission, make omissions visible.

## Alternatives considered

- **Role checks in code:** brittle, because every new role edits many files.
- **Per-user permission grants or ABAC:** more flexible than needed; roles cover the staff structure.
