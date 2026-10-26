# ADR 0007: Rotating refresh-token families and signed double-submit CSRF

- **Status:** Accepted
- **Date:** 2026-10-31

## Context

Auth used one JWT secret for 7-day refresh tokens that could not be revoked, and cookies with `SameSite=None` and no CSRF defence. The frontend and API can be on different sites (Vercel and Render), so cookies must be cross-site in production.

## Decision

- **Separate access and refresh keys.** Access tokens last 15 minutes and refresh tokens 7 days. A legacy single secret is HKDF-split into both.
- **Refresh-token families.** Each login is a family stored only as SHA-256 fingerprints, and every refresh rotates it atomically. Reusing a rotated token (outside a 10-second multi-tab grace window) revokes the whole family. Logout revokes the family; logout-all revokes everything.
- **CSRF.** Cookie-authenticated writes must send an HMAC-signed token in `X-CSRF-Token` (signed double-submit), obtained from `GET /auth/csrf` or auth responses. Bearer clients, the payment webhook and MCP are exempt.
- **Login throttling** uses exponential backoff keyed on IP + email, plus timing-equalised responses for unknown users.

## Consequences

- **Positive:** stolen refresh tokens are detected on reuse, sessions are revocable per device, and cross-site cookies are safe against CSRF.
- **Negative:** session state lives in MongoDB, so a refresh needs a database round trip, and clients must handle CSRF tokens. `lib/api.ts` does this centrally.

## Alternatives considered

- **Stateless long-lived JWTs:** no revocation.
- **SameSite=Strict cookies only:** breaks the cross-site deployment.
- **Opaque server sessions for everything:** a database hit on every request instead of only on refresh.
