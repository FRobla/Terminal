# Checklist

Canonical implementation roadmap. The newest iteration always appears first. Historical iterations are never rewritten; acceptance criteria are never silently changed (amendments are appended with a date and reason).

Status values: `NOT STARTED` · `IN PROGRESS` · `BLOCKED` · `COMPLETE`

---

# Current Iteration

## Iteration 01 — Foundation and Wallet Overview Vertical Slice

Status: NOT STARTED

Goal:
Initialize the monorepo and infrastructure, and prove the architecture end-to-end with a real, read-only Wallet Overview on Solana Devnet:
User → Terminal → API → Solana adapter → Devnet RPC → real blockchain data → domain model → API response → Terminal UI.

Specifications:
- [SPEC-001 Foundation](./docs/specs/SPEC-001-foundation.md)
- [SPEC-002 Wallet Overview](./docs/specs/SPEC-002-wallet-overview.md)
- [SPEC-003 Data provenance and availability](./docs/specs/SPEC-003-data-provenance.md)
- [SPEC-005 Network safety](./docs/specs/SPEC-005-network-safety.md)
- [SPEC-006 Provider health](./docs/specs/SPEC-006-provider-health.md) (RPC provider only)
- [SPEC-007 Authentication and RBAC](./docs/specs/SPEC-007-auth-and-rbac.md) (foundation scope)
- [SPEC-008 Audit logging](./docs/specs/SPEC-008-audit-logging.md) (foundation scope)

Acceptance Criteria (summary; full, numbered criteria live in the specs):
- `pnpm install && pnpm infra:up && pnpm db:migrate && pnpm dev` starts terminal, api, and worker locally (FND-AC-01).
- Invalid or missing environment configuration fails fast with a clear message; `mainnet-beta` is rejected (FND-AC-03, NET-AC-01).
- The API verifies the Devnet genesis hash at startup and exposes it at `/api/v1/system/network` (NET-AC-02).
- A user can sign in with a Devnet wallet (SIWS), and the session is server-side and audited (AUTH-AC-01..06).
- A connected wallet's real SOL balance, SPL Token and Token-2022 accounts, and recent signatures are displayed from Devnet with provenance and freshness (WO-AC-01..08).
- RPC failure, rate limiting, empty token accounts, wallet disconnection, and cluster mismatch each produce a specific, actionable UI state (WO-AC-09..17).
- No mock or fixture data is reachable from runtime code (FND-AC-08).
- The terminal permanently displays `SOLANA DEVNET` (NET-AC-05).
- CI runs lint, typecheck, unit, integration, contract, e2e, boundary, and audit checks (FND-AC-10).

Dependencies:
- Docker available locally (verified: Docker 29.8.0).
- Node.js 24 LTS (verified: 24.19.0) and pnpm 12 (verified: 12.6.0 local).
- Public Devnet RPC (verified reachable 2026-09-30).
- A Wallet Standard browser wallet supporting Devnet for manual verification.
- Decision on ADR-0005 (authentication) — see Open Decisions.

Risks:
- TypeScript 7 toolchain compatibility (Next.js, ESLint, Drizzle Kit). Mitigation: verify first; pin the newest compatible version and document it.
- Kit plugins are `0.x`; APIs may shift. Mitigation: wrap in `packages/solana`, pin exact versions.
- Public Devnet RPC rate limits (100 req/10 s per IP; 40 req/10 s per method). Mitigation: Redis token bucket, caching with provenance, explicit `RPC_RATE_LIMITED` state.
- Wallet Standard `solana:signIn` support varies by wallet. Mitigation: `signMessage` fallback with an identical, server-built message.
- `getSignaturesForAddress` history on Devnet may be pruned. Mitigation: show "No indexed transactions are available" rather than implying none occurred.

Verification:
- All acceptance criteria in the listed specs have passing tests referencing their IDs.
- Manual run against Devnet with a real wallet: balance matches Solana Explorer for the same address and slot range.
- Self-review (prompt §111) recorded at the bottom of this iteration before marking COMPLETE.

### Work breakdown

#### 1.0 Pre-flight verification
- [ ] Re-verify latest stable versions of every dependency listed in OPERATIONS.md §2
- [ ] Verify TypeScript 7 compatibility with Next.js, ESLint (typescript-eslint), Vitest, Drizzle Kit; record the pinned version and rationale in changelog
- [ ] Re-read official `@solana/kit` docs: client assembly with plugins, `@solana/react` `ClientProvider`, `@solana/kit-plugin-wallet` hooks, SIWS support
- [ ] Confirm Wallet Standard chain identifiers (`solana:devnet`, …) used by `@solana/kit-plugin-wallet`

#### 1.1 Monorepo
- [ ] Root `package.json` with `packageManager`, `engines`, workspace scripts (`dev`, `build`, `lint`, `typecheck`, `test*`, `infra:*`, `db:*`)
- [ ] `pnpm-workspace.yaml`, `turbo.json` (pipelines with correct `dependsOn`/outputs), `.nvmrc`, `.gitignore`, `.editorconfig`
- [ ] `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) and per-package tsconfigs
- [ ] ESLint flat config + Prettier; import boundary rules; ban `utils.ts`/`helpers.ts`/`common.ts`/`misc.ts` filenames
- [ ] Dependency-boundary check (runtime code cannot import `packages/testing` or `tests/`)
- [ ] pnpm `onlyBuiltDependencies` allowlist

#### 1.2 Configuration (`packages/config`)
- [ ] Zod env schemas per app (api, worker, terminal-server, terminal-public)
- [ ] Cluster enum and rules (`mainnet-beta` rejected with `NETWORK_NOT_PERMITTED` message)
- [ ] `.env.example` kept in sync (test asserts every schema key is documented)

#### 1.3 Observability (`packages/observability`)
- [ ] `pino` logger with central redaction list
- [ ] Request context (`requestId`, `traceId`, `organizationId`, `userId`, `feature`, `operation`)
- [ ] OpenTelemetry setup (no-op when no exporter configured)
- [ ] Test: known secret shapes never appear in log output

#### 1.4 Database (`packages/database`)
- [ ] Drizzle setup; migration and application roles
- [ ] Iteration 01 schema: `organizations`, `users`, `user_wallet_identities`, `organization_memberships`, `roles`, `permissions`, `role_permissions`, `membership_roles`, `auth_challenges`, `sessions`, `audit_events`, `provider_health_checks` (see docs/architecture/database.md)
- [ ] Revoke `UPDATE`/`DELETE` on `audit_events` from application role
- [ ] Seed: system roles/permissions and one local development organization (no financial data)
- [ ] Integration tests for migrations and repositories

#### 1.5 Infrastructure and worker
- [ ] `infra/docker/compose.yaml` (PostgreSQL, Redis) with health checks
- [ ] `apps/worker` bootstrap with BullMQ, graceful shutdown
- [ ] `system.provider-health` repeatable job probing Solana RPC (`getGenesisHash`/`getSlot`) within budget

#### 1.6 API foundation (`apps/api`)
- [ ] Fastify bootstrap, Zod type provider, error handler emitting the standard error format
- [ ] `@fastify/helmet`, `@fastify/rate-limit` (Redis), cookie handling, CSRF protection
- [ ] Permission declaration per route with default deny and a startup check
- [ ] `/api/v1/system/health`, `/readiness`, `/network`, `/providers`
- [ ] OpenAPI generation from Zod contracts (non-production)

#### 1.7 Solana package (`packages/solana`)
- [ ] Cluster constants (genesis hashes verified 2026-09-30) and explorer link builder
- [ ] RPC client assembly via `@solana/kit` + `@solana/kit-plugin-rpc`
- [ ] Provider call wrapper: timeout, retry (exponential backoff + jitter), concurrency limit, Redis token bucket, latency metrics, health recording, endpoint redaction
- [ ] Narrow readers: `ClusterIdentityReader`, `SolBalanceReader`, `TokenAccountReader` (SPL Token + Token-2022), `SignatureHistoryReader`
- [ ] RPC error classification: `RPC_RATE_LIMITED`, `RPC_TIMEOUT`, `RPC_UNAVAILABLE`, `RPC_INVALID_RESPONSE`
- [ ] Devnet integration tests (`@devnet`)

#### 1.8 Authentication foundation (`apps/api/src/auth`)
- [ ] SIWS challenge/verify endpoints, single-use challenges, Ed25519 verification via Web Crypto
- [ ] Session creation (hashed ids), cookie flags, idle/absolute expiry, logout
- [ ] First-login provisioning into the local development organization with the `viewer` role (configurable)
- [ ] Audit: `user.login`, `user.login_failed`, `user.logout`

#### 1.9 Wallet Overview backend (`apps/api/src/wallets`)
- [ ] Domain: `WalletAddress`, `Lamports`, `TokenAmount`, `TokenAccountSnapshot`, `TransactionSignatureSummary`, `WalletOverview`
- [ ] `Sourced<T>` implementation and availability rules (SPEC-003)
- [ ] Application: `GetWalletOverview` use case with partial-failure semantics
- [ ] Route `GET /api/v1/wallets/{address}/overview` (`wallet.read`)
- [ ] Route `POST /api/v1/wallets/connections` + audit `wallet.connected` / `wallet.connection_rejected`
- [ ] Unit, integration, and Devnet tests mapped to WO-AC ids

#### 1.10 Terminal shell (`apps/terminal`)
- [ ] Next.js App Router, Tailwind CSS, design tokens from docs/design/ui-guidelines.md
- [ ] CSP with nonces and security headers; rewrites `/api/v1/*` → API
- [ ] Shell: persistent navigation, status bar with `SOLANA DEVNET` indicator, cluster verification status, provider health indicator
- [ ] `@solana/react` client provider + `@solana/kit-plugin-wallet` connection (client component island)
- [ ] Sign-in flow (SIWS) and session handling

#### 1.11 Wallet Overview UI (`apps/terminal/src/wallets`)
- [ ] Overview panel: address (copy, explorer link), SOL balance with freshness and provenance tooltip
- [ ] Token accounts table (mint, program, amount, decimals, state) with empty state
- [ ] Recent transactions table (signature, slot, block time, status, explorer link) with empty state
- [ ] Loading skeletons, error states, `DATA UNAVAILABLE` component, stale indicator, retry action
- [ ] Wallet disconnected and cluster mismatch states
- [ ] Keyboard navigation and screen-reader labels; axe checks

#### 1.12 Testing foundation
- [ ] Vitest workspace config; Playwright config; axe integration
- [ ] `packages/testing`: test Wallet Standard wallet, keypair helpers, stub RPC server for failure modes
- [ ] Production bundle check: test wallet identifier absent

#### 1.13 CI
- [ ] GitHub Actions: install (frozen lockfile), lint, typecheck, unit, integration (PostgreSQL + Redis services), contract, e2e, boundary check, `pnpm audit`, build
- [ ] Nightly workflow for `@devnet` tests
- [ ] Dependabot or Renovate configuration

#### 1.14 Close-out
- [ ] Update ARCHITECTURE.md, API.md, DATA_SOURCES.md, TESTING.md, OPERATIONS.md with as-built details
- [ ] changelog.md entry for Iteration 01
- [ ] Self-review against prompt §111 recorded below
- [ ] Mark iteration COMPLETE only when every acceptance criterion passes

### Open Decisions

| # | Decision | Blocking? | Proposed default |
| --- | --- | --- | --- |
| D-01 | Authentication approach ([ADR-0005](./docs/architecture/adr/0005-authentication.md)) | Blocks 1.8 | SIWS + server-side sessions; email identity deferred to Iteration 08 |
| D-02 | Hosted database for staging: Supabase project (requires account/credentials) | No (local Docker first) | Supabase, created when staging is needed |
| D-03 | Devnet valuation policy ([ADR-0009](./docs/architecture/adr/0009-devnet-valuation-policy.md)) | Blocks Iteration 03 | Show `UNAVAILABLE` for Devnet USD value; optional labeled Mainnet reference price |
| D-04 | Devnet DEX strategy ([ADR-0008](./docs/architecture/adr/0008-devnet-dex-strategy.md)) | Blocks Iteration 04 | Orca Whirlpools on Devnet; Jupiter read-only Mainnet quotes |
| D-05 | Deployment target for staging (e.g. Vercel + container host) | No | Decide before staging |
| D-06 | Jupiter / Helius API keys (free tiers require keys) | Blocks Iteration 03/04 providers | Owner creates keys; stored as secrets only |

### Self-review (to be completed before closing)

_Pending._

---

## Iteration 00 — Specification Baseline

Status: COMPLETE (2026-09-30)

Goal:
Establish the persistent project state, specifications, architecture decisions, and roadmap required to start implementation, before any application code is written.

Acceptance Criteria:
- [x] Persistent state files exist: README.md, ARCHITECTURE.md, SECURITY.md, DATA_SOURCES.md, API.md, TESTING.md, OPERATIONS.md, checklist.md, changelog.md, .env.example
- [x] Specifications with numbered acceptance criteria exist for Iteration 01 scope (SPEC-001, 002, 003, 005, 006, 007, 008) and for the transaction lifecycle (SPEC-004)
- [x] ADRs record the major architectural decisions and open decisions
- [x] Domain model, database design, threat model, and UI guidelines are documented
- [x] External providers were checked against current public documentation and live endpoints where possible; unverified information is labeled `UNVERIFIED`
- [x] All repository documentation is written in American English

Dependencies:
- None.

Risks:
- Provider facts change over time. Mitigation: every provider entry records a "Last verified" date and is re-verified before implementation.

Verification:
- Devnet, testnet, and mainnet genesis hashes retrieved live from the public RPC endpoints on 2026-09-30.
- Dependency versions retrieved from the npm registry on 2026-09-30.
- Solana, Jupiter, DEX Screener, and Helius documentation pages consulted on 2026-09-30.

---

# Planned Iterations

Each planned iteration becomes a full iteration entry (goal, acceptance criteria, dependencies, risks, verification) at the top of this file when it starts, with its specification written first.

| Iteration | Theme | Scope | Key specs to write |
| --- | --- | --- | --- |
| 02 | Wallet subsystem | Wallet registry, metadata (label, purpose, category, organization), watch-only wallets, client-side wallet generation with encrypted export, transaction history indexing, wallet sync jobs, transaction lifecycle state machine and SOL transfer as the first write flow, audit events | SPEC-009 Wallet registry, SPEC-010 Local wallet generation, SPEC-004 (implementation) |
| 03 | Portfolio | Token account aggregation, on-chain metadata, valuation with price provenance (per ADR-0009), historical snapshots, charts from real data | SPEC-011 Portfolio, SPEC-012 Market data |
| 04 | DEX | Token selection, quotes, routes, slippage, price impact, simulation, signing, lifecycle, reconciliation (per ADR-0008) | SPEC-013 Trading |
| 05 | Token Studio | SPL and Token-2022 creation wizard (12 steps), verified extensions only, authority visualization (Present/Absent/Revoked/Unknown/Not applicable), metadata | SPEC-014 Token Studio, SPEC-015 Token authorities |
| 06 | Token Intelligence | Structured facts, holder distribution, liquidity, activity, authority analysis, creator/funding relationships (Mainnet read-only where applicable) | SPEC-016 Token facts, SPEC-017 Risk model v1 (versioned, decomposable) |
| 07 | Alerts | Wallet, token, liquidity, transaction, and provider-health alerts; in-app notifications; watchlists | SPEC-018 Alerts, SPEC-019 Notifications |
| 08 | Corporate organization | Users, teams, roles management UI, wallet assignment, audit viewer, organization dashboard, API credentials | SPEC-020 Organizations, SPEC-007 (full scope) |
| 09 | Advanced intelligence | Verified social providers, new-token monitoring, wallet relationship graph, AI evidence-based analysis | SPEC-021 Social, SPEC-022 New tokens, SPEC-023 Relationship graph, SPEC-024 AI analysis |
