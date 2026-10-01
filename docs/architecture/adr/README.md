# Architecture Decision Records

Each ADR records one significant decision: context, decision, alternatives, and consequences. ADRs are immutable once `Accepted`; a changed decision is recorded in a new ADR that supersedes the old one.

Statuses: `Proposed` · `Accepted` · `Superseded by ADR-NNNN` · `Rejected`

| ADR | Title | Status |
| --- | --- | --- |
| [0001](./0001-monorepo-pnpm-turborepo.md) | Monorepo with pnpm and Turborepo | Accepted |
| [0002](./0002-screaming-architecture-and-layering.md) | Screaming architecture and layering | Accepted |
| [0003](./0003-solana-kit-as-sdk.md) | `@solana/kit` as the Solana SDK | Accepted |
| [0004](./0004-non-custodial-signing-first.md) | Non-custodial signing first; keychain boundary | Accepted |
| [0005](./0005-authentication.md) | Authentication: Sign-In With Solana + server sessions | Accepted |
| [0006](./0006-postgresql-drizzle-supabase.md) | PostgreSQL, Drizzle, Supabase hosting | Accepted |
| [0007](./0007-redis-bullmq-jobs.md) | Redis and BullMQ for cache, rate limits, and jobs | Accepted |
| [0008](./0008-devnet-dex-strategy.md) | Devnet DEX strategy | Proposed |
| [0009](./0009-devnet-valuation-policy.md) | Valuation policy for Devnet assets | Proposed |
| [0010](./0010-shared-audit-and-transaction-packages.md) | Shared audit and transaction lifecycle packages | Accepted |

Template:

```
# ADR-NNNN — Title
Status: Proposed | Accepted | Superseded | Rejected
Date: YYYY-MM-DD
## Context
## Decision
## Alternatives considered
## Consequences
```
