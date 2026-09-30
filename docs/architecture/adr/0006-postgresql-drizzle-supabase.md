# ADR-0006 — PostgreSQL, Drizzle, Supabase Hosting

Status: Accepted
Date: 2026-09-30

## Context

The system needs relational modeling for organizations, permissions, wallet metadata, transaction records, caches with provenance, and an append-only audit log. Blockchain state remains authoritative for on-chain facts.

## Decision

- **PostgreSQL** as the only relational store.
- **Drizzle ORM** for typed schema and queries; **Drizzle Kit** for migrations committed to the repository.
- **Local:** PostgreSQL in Docker Compose. **Hosted (staging):** Supabase PostgreSQL, used as plain PostgreSQL (no dependency on Supabase-specific APIs in the MVP). Hosted project creation requires the owner's account and credentials (open decision D-02).
- Least-privilege roles: migration role vs. application role; audit table append-only for the application role.

## Alternatives considered

- **Prisma:** heavier runtime, less direct SQL control.
- **Kysely:** good query builder, but Drizzle also provides schema-as-code and migrations.
- **Managed PostgreSQL other than Supabase:** equivalent; Supabase is preferred by the product brief.

## Consequences

- No reliance on Supabase Row Level Security in the MVP; authorization is enforced by the API. RLS may be added later as defense in depth.
- Portability to any PostgreSQL host is preserved.
