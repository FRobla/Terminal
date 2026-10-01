# ADR-0005 — Authentication: Sign-In With Solana + Server Sessions

Status: Accepted (confirmed by the owner on 2026-09-30)
Date: 2026-09-30

## Context

Users are people in organizations who operate wallets. Iteration 01 needs an authentication foundation so that audit events have an actor and authorization can be enforced. Options range from wallet-based sign-in to email/OIDC providers.

## Decision

- Primary identity proof in the MVP: **Sign-In With Solana (SIWS)** via the Wallet Standard `solana:signIn` feature, with a `signMessage` fallback using an identical server-built message.
- **Server-side sessions** owned by `apps/api` (opaque id, hashed in PostgreSQL, `__Host-` cookie, `SameSite=Strict`), not JWTs in browser storage.
- Users, wallet identities, organizations, memberships, and roles are modeled in our PostgreSQL schema (SPEC-007), independent of any identity vendor.
- An identity-provider abstraction allows adding email/OIDC (e.g. Supabase Auth or a corporate IdP) in Iteration 08 without changing authorization.

## Alternatives considered

- **Supabase Auth (email/magic link/OAuth):** fast to start, but couples identity to the hosting vendor, and local development requires the Supabase stack; wallet sign-in would still be needed for wallet ownership proof.
- **Auth.js / Better Auth:** capable libraries, but centered on the Next.js app, while our source of truth for authorization is the Fastify API.
- **JWT-only stateless sessions:** harder revocation; revocation is a security requirement.

## Consequences

- No passwords stored in the MVP.
- A user who loses their sign-in wallet needs an administrator to link a new identity (Iteration 08 flow).
- Corporate SSO requires a later ADR.

## Resolution

The owner confirmed SIWS as the MVP authentication method on 2026-09-30.
