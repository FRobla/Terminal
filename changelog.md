# Changelog

All functional changes to this project are recorded here: new features, changed or removed behavior, API changes, schema changes, security changes, transaction behavior, provider and data-source changes, architecture changes, and breaking changes.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow [Semantic Versioning](https://semver.org/) once the first release is tagged.

## [Unreleased]

### Added — Iteration 01: Foundation and Wallet Overview
- pnpm + Turborepo monorepo: `apps/terminal` (Next.js 16), `apps/api` (Fastify 5), `apps/worker` (BullMQ 6) and packages `network`, `config`, `validation`, `observability`, `providers`, `solana`, `database`, `ui`, `testing`.
- Runtime configuration validated with Zod at startup; `mainnet-beta` is rejected with the readiness-gate message.
- Solana cluster verification by genesis hash at startup and every 5 minutes (API) and in the worker probe; Mainnet served behind a non-Mainnet configuration is logged as a critical incident and disables Solana operations.
- Provider pipeline for every outbound call: timeout, retries with exponential backoff and full jitter, per-process concurrency limit, distributed Redis token bucket (total and per method), classified errors, endpoint redaction, and live health tracking (`HEALTHY`, `DEGRADED`, `RATE_LIMITED`, `UNAVAILABLE`, `DISABLED`, `UNKNOWN`).
- `Sourced<T>` provenance envelope and `DATA UNAVAILABLE` semantics for every externally sourced value.
- Sign-In With Solana (`solana:signIn` with a `signMessage` fallback), server-side sessions with hashed tokens, CSRF protection, default-deny RBAC with seven seeded system roles, and a one-time bootstrap owner (`BOOTSTRAP_OWNER_WALLET_ADDRESS`).
- Append-only audit log (`user.login`, `user.login_failed`, `user.logout`, `wallet.connected`, `wallet.connection_rejected`, `role.assigned`, `authorization.denied`) with per-action metadata schemas and a secret-key denylist.
- API endpoints: `/api/v1/system/{health,readiness,network,providers}`, `/api/v1/auth/{siws/challenge,siws/verify,session,logout}`, `/api/v1/wallets/{address}/overview`, `/api/v1/wallets/connections`, `/api/v1/audit/events`, and `/api/v1/openapi.json` (non-production).
- Wallet Overview vertical slice: real Devnet SOL balance, SPL Token and Token-2022 accounts, and recent signatures with provenance, freshness, stale, unavailable, empty, disconnected, and cluster-mismatch states; read-only watch view for any address.
- Worker job `system.provider-health`: one `getSlot` probe per minute, a genesis check every 5 minutes, and health snapshots in PostgreSQL.
- PostgreSQL schema (12 tables) with a least-privilege application role; migrations and seed scripts.
- Terminal shell with a permanent `SOLANA DEVNET` indicator, cluster and provider status, nonce-based CSP, and same-origin API rewrites.
- Tests: unit, integration (real PostgreSQL and Redis, stub RPC for failure modes), opt-in Devnet tests against the public RPC, and Playwright end-to-end tests with a test-only Wallet Standard wallet and axe accessibility checks.
- CI workflows (quality gates, nightly Devnet), Dependabot, dependency-boundary rules, and a production bundle check for test-only code.

### Changed — Iteration 01
- TypeScript pinned to 6.0.3: TypeScript 7.0.2 ships no classic compiler API and typescript-eslint supports `<6.1.0`.
- The cluster model moved to its own pure package, `@sct/network`, to avoid a dependency cycle.
- `@solana/kit-plugin-rpc` is deferred to Iteration 02; read-only calls use `createSolanaRpc` with per-call abort signals.
- Server apps build to self-contained bundles (tsup) and start with `NODE_ENV=production`.

### Security — Iteration 01
- Invisible Unicode characters that the editor had written literally into source files were replaced with explicit `\u` escapes.
- `pnpm audit` reports two development-only esbuild advisories (low, moderate) in `drizzle-kit` and `tsup` dev-server code paths that the project does not use; accepted and tracked (SECURITY.md §13).

### Added — Iteration 00
- Specification baseline (Iteration 00): README, ARCHITECTURE, SECURITY, DATA_SOURCES, API, TESTING, OPERATIONS, checklist, changelog, and `.env.example`.
- Specifications SPEC-001 through SPEC-008 with numbered acceptance criteria (`docs/specs/`).
- Architecture Decision Records ADR-0001 through ADR-0009 (`docs/architecture/adr/`).
- Domain model, database design, threat model, provider verification template, and UI guidelines.
- Agent operating rules (`CLAUDE.md`).
- `.gitignore` excluding environment files, build output, and local keypair files.

### Architecture
- Defined the target architecture: pnpm + Turborepo monorepo with `apps/terminal` (Next.js), `apps/api` (Fastify), `apps/worker` (BullMQ), PostgreSQL (Drizzle), and Redis.
- Selected `@solana/kit` and its official plugins as the Solana SDK; legacy `@solana/web3.js` is excluded.
- Defined Solana Devnet as the only permitted MVP cluster, verified by genesis hash.

### Data sources
- Documented Solana public Devnet RPC limits and cluster genesis hashes (verified 2026-09-30).
- Documented that Jupiter hosted APIs are Mainnet-only and require an API key on the free plan; the legacy `public.jupiterapi.com` endpoint must not be used.
- Marked X/Twitter data and an official pump.fun data API as `UNAVAILABLE`.
