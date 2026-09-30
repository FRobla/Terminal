# ADR-0002 — Screaming Architecture and Layering

Status: Accepted
Date: 2026-09-30

## Context

The repository must immediately communicate that it is a Solana corporate terminal, and business rules must be testable independently of frameworks and providers.

## Decision

- Inside each app, top-level folders are **business domains** (`wallets/`, `trading/`, `tokens/`, `portfolio/`, `intelligence/`, `system/`, `audit/`, …).
- Within a domain, use only the layers it needs: `domain/` (entities, value objects, invariants, pure calculations), `application/` (use cases, orchestration, ports), `infrastructure/` (adapters, repositories), `http/` (api) or `components/` + `hooks/` (terminal).
- Dependencies point inward: infrastructure → application → domain. Domain code does not import React, Fastify, Drizzle, Redis, browser APIs, or specific providers.
- Backend domain modules start inside `apps/api`. A module is extracted into a `packages/<domain>` package only when a second consumer (typically `apps/worker`) needs it.
- Ports are capability-shaped and narrow (e.g. `SolBalanceReader`), never god services.
- No `utils.ts` / `helpers.ts` / `common.ts` / `misc.ts`.

## Alternatives considered

- **Technical layering at the top level** (`controllers/`, `services/`, `components/`): hides the domain.
- **All domains as packages from day one:** premature abstraction and build overhead before a second consumer exists.

## Consequences

- Lint and dependency-graph checks enforce boundaries.
- Some duplication between api and worker may exist briefly until extraction; extraction is a normal refactor recorded in the changelog.
