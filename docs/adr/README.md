# Architecture decision records

Short records of the decisions that shape StoreFront: the context, the decision, its consequences and the alternatives considered.

| ADR | Decision |
|---|---|
| [0001](0001-modular-monolith.md) | Modular monolith over microservices |
| [0002](0002-integer-paise.md) | Store money as integer paise |
| [0003](0003-transactional-outbox.md) | Transactional outbox for domain events |
| [0004](0004-stock-reservation-at-checkout.md) | Reserve stock at checkout, commit on payment |
| [0005](0005-pricing-as-data-with-branch-and-bound.md) | Promotions as data, optimised with branch-and-bound |
| [0006](0006-redis-optional-with-in-memory-fallbacks.md) | Redis is optional; every dependency has an in-memory fallback |
| [0007](0007-refresh-token-families-and-csrf-double-submit.md) | Rotating refresh-token families and signed double-submit CSRF |
| [0008](0008-llm-provider-abstraction-and-confirmed-agent-actions.md) | LLM provider abstraction and confirm-before-write agent actions |
| [0009](0009-isr-with-event-driven-revalidation.md) | ISR with event-driven tag revalidation |
| [0010](0010-rbac-permissions-over-roles.md) | Permission-based RBAC instead of role checks |
