# ADR 0001: Modular monolith over microservices

- **Status:** Accepted
- **Date:** 2026-10-31

## Context

StoreFront has around twenty business capabilities (catalog, pricing, orders, payments, inventory, agent, experiments and more) built and run by one developer. Several flows need atomicity across capabilities: a checkout prices the cart, reserves stock, records promotion usage and writes the order together.

## Decision

Ship one deployable backend (plus a worker process from the same codebase) split into modules under `backend/src/modules/<name>`. Each module is routes, controller, service and repository classes. A module owns its collections, collaborators are injected through constructors in a single composition root (`core/container.ts`), and modules react to each other through domain events rather than calling back up the dependency graph.

## Consequences

- **Positive:** cross-module invariants use MongoDB transactions instead of distributed sagas; there is one build, one deploy and one trace; refactoring across boundaries is a compiler-checked change.
- **Positive:** boundaries are explicit enough that a module can be extracted later. Its inputs are injected interfaces and its outputs are events.
- **Negative:** all modules scale together. The API and worker split, plus Redis-backed shared state, covers the scaling that is actually needed today.
- **Negative:** boundaries are enforced by convention and review, not by the network. A lint rule or package split would make them stricter.

## Alternatives considered

- **Microservices per capability:** independent scaling and deploys, but every checkout would become a distributed transaction (sagas or two-phase commit) plus service discovery and contract versioning. That cost is not justified at this scale.
- **Layered monolith (controllers/, services/, models/ folders):** the original layout. Simple, but nothing stopped any file from reaching into any collection.
