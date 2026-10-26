# Security model

Sessions, CSRF, throttling, authorization and audit. See also [ADR 0007](adr/0007-refresh-token-families-and-csrf-double-submit.md) and [ADR 0010](adr/0010-rbac-permissions-over-roles.md).

| Concern | Mechanism |
| --- | --- |
| Sessions | 15-min access JWT + 7-day refresh JWT signed with **separate keys**. Each login is a refresh-token **family** stored only as SHA-256 fingerprints; every refresh atomically rotates it. Replaying a rotated token (outside a 10 s multi-tab grace window) revokes the whole family. `logout` revokes the family, `logout-all` every family plus outstanding access tokens; `/auth/sessions` lists and revokes devices. |
| CSRF | Cookie-authenticated writes must echo an HMAC-signed token in `X-CSRF-Token` (signed double-submit). Tokens come from `GET /auth/csrf` and auth responses, so a cross-site frontend never needs to read the cookie; they rotate on login/logout. Bearer clients, the webhook and MCP are exempt. |
| Cookies | `SameSite=None; Secure` in production (separate frontend/API sites), `Lax` locally; refresh cookie scoped to `/api/v1/auth`. Overridable via `COOKIE_*`. |
| Brute force | Exponential backoff keyed on **IP + email** (owner is never locked out from another network) plus a looser per-email policy against distributed stuffing; `Retry-After` on 429. Unknown emails still pay for a bcrypt compare so timing does not reveal accounts. |
| Rate limits | Declarative policy table — global, sign-in, session, checkout/payments, AI chat, catalog reads, MCP — stacked per request behind a pluggable counter store (per-process memory, or Redis via `rate-limit-redis` when `REDIS_URL` is set). |
| Trust boundary | Carts persist only `{productId, size, qty}`; titles, prices and stock are always read from the catalog. Reviews require a delivered order (verified purchase); ratings update atomically and incrementally. |
| Authorization | Roles (`support`, `fulfillment`, `catalog_manager`, `admin`) map to permissions (`orders:manage`, `catalog:write`, `audit:read`…) defined once in `@storefront/contracts`; `requirePermission()` guards routes and the UI hides what a role cannot use. |
| Audit | Every permission-guarded write is logged after the response (actor, permission, route, targets, redacted diff, status) and browsable at `/admin/audit` with keyset pagination. |
| Headers & CORS | Deny-all CSP, no-referrer, same-site CORP, HSTS in production; credentialed CORS only for `CORS_ORIGINS`. CodeQL and grouped Dependabot updates run in CI. |
