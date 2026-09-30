# ADR-0001 — Monorepo with pnpm and Turborepo

Status: Accepted
Date: 2026-09-30

## Context

The product has three deployable units (terminal, api, worker) sharing contracts, configuration, database schema, Solana integration, and observability. Contracts must stay synchronized between terminal and api.

## Decision

Use a single repository managed by **pnpm workspaces** and **Turborepo**:

- `apps/terminal`, `apps/api`, `apps/worker`
- `packages/ui`, `packages/database`, `packages/solana`, `packages/validation`, `packages/config`, `packages/observability`, `packages/testing`
- Exact dependency versions pinned via `pnpm-lock.yaml`; pnpm version pinned via `packageManager`.
- Internal packages are consumed as TypeScript source (just-in-time transpilation) unless a package needs a build step.

## Alternatives considered

- **Polyrepo:** contract drift between terminal and api; more release overhead.
- **Nx:** more features than needed; heavier configuration.
- **npm/yarn workspaces:** pnpm offers stricter dependency isolation and faster installs.

## Consequences

- One PR can change a contract and both of its consumers atomically.
- Turborepo caching speeds up CI.
- Package boundaries must be enforced by lint rules to prevent a shared "junk drawer" package.
