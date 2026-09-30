# ADR-0007 — Redis and BullMQ for Cache, Rate Limits, and Jobs

Status: Accepted
Date: 2026-09-30

## Context

The system needs distributed rate limiting across processes (the public Devnet RPC is limited per IP), short-lived caching with provenance, and durable background jobs (sync, indexing, health probes, confirmation, reconciliation, alerts). The browser must never run long indexing tasks.

## Decision

- **Redis** (Redis-compatible) for cache, token-bucket rate limiters, idempotency keys, and queue storage.
- **BullMQ** for durable jobs with retries, backoff, repeatable schedules, and concurrency control, running in `apps/worker`.
- Queue names are domain-prefixed (`system.provider-health`, `wallets.sync`, …).

## Alternatives considered

- **pg-boss (PostgreSQL-backed queue):** fewer moving parts, but Redis is needed anyway for rate limiting and cache.
- **Cloud-specific queues:** premature vendor coupling.

## Consequences

- Redis becomes a readiness dependency.
- Job handlers must be idempotent; transaction-related queues are never purged in runbooks.
