# Changelog

All functional changes to this project are recorded here: new features, changed or removed behavior, API changes, schema changes, security changes, transaction behavior, provider and data-source changes, architecture changes, and breaking changes.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow [Semantic Versioning](https://semver.org/) once the first release is tagged.

## [Unreleased]

### Added — Iteration 01.5: User Settings and Owner Console
- `Settings` for every signed-in user (SPEC-025): Profile (display name, sign-in wallets, organization, roles, effective permissions), Preferences, and Sessions (list active sessions, revoke one or all others).
- Server-side, per-user preferences that change real behavior: timestamp time zone (browser or UTC, always labeled), density, reduced motion, block explorer (Solana Explorer or Solscan, always with the cluster), Wallet Overview auto-refresh (30/60/120 s or off; never faster than 30 s), keyboard shortcuts, and short or full addresses.
- Owner console inside Settings (SPEC-026), visible and callable only with the new owner-only permission `platform.administer`: Overview (users, members, sessions, 24 h audit outcomes, readiness, cluster, providers, last worker snapshot), Members (set role, suspend/reactivate membership, disable/enable account, revoke sessions), platform Sessions, Audit log viewer with filters, Organization (rename, role and permission matrix), platform Announcement with preview, System (allowlisted configuration, API process, PostgreSQL migrations and table statistics, Redis facts, on-demand cluster verification, provider health history), Jobs (BullMQ counts, schedulers, recent jobs, run the provider probe), and Developer (live route catalog with access requirements, OpenAPI link, cache purge).
- Platform announcement banner under the status bar for every signed-in user; the status bar shows the user's display name (or short wallet address) linking to the profile.
- API endpoints `/api/v1/me/*`, `/api/v1/announcements/current`, and `/api/v1/admin/*` (API.md §4.5–4.6); error codes `OPERATION_NOT_ALLOWED` and `ACCOUNT_DISABLED`.
- Audit actions `user.profile_updated`, `session.revoked`, `role.revoked`, `member.suspended`, `member.reactivated`, `user.disabled`, `user.enabled`, `organization.updated`, `announcement.updated`, `system.cluster_verification_requested`, `system.job_enqueued`, `system.cache_purged`.
- Database: `user_preferences` and `platform_settings` tables (migration `0002`), read-only access to the migration log for the application role (migration `0003`). Run `pnpm db:migrate && pnpm db:seed`.
- `AUTH_RATE_LIMIT_PER_MINUTE` (default 20) makes the sign-in rate limit configurable.
- Shared UI: `Timestamp`, `DisplaySettingsProvider`, `ConfirmAction`, form controls, `ScrollRegion`.

### Changed — Iteration 01.5
- The `admin` role no longer holds every permission: it lacks the new owner-only `platform.administer`.
- Disabled accounts are refused at sign-in with `ACCOUNT_DISABLED` (previously a session was created and immediately treated as revoked).
- Wallet Overview block times render in the user's time zone with its label (previously always UTC); explorer links are built in the terminal for the chosen explorer.
- Queue names moved to `@sct/config` so the API can inspect the worker's queues.

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
- Wallet connection moved to the status bar: `Connect <wallet>` buttons on every page; while signed out, connecting also signs in with that wallet (AUTH-AC-07). The Wallet panel no longer lists wallets.
- Temporary default member role (`DEFAULT_MEMBER_ROLE`, non-production only): users without any membership receive the configured system role in the default organization on sign-in, audited as `role.assigned` (RBAC-AC-05). Bridges the gap until organization management in Iteration 08.

### Fixed — Iteration 01
- Wallet connection did nothing in development: React StrictMode's simulated unmount disposed the wallet client, which then ignored every connection. The client is no longer disposed (it lives as long as the page).
- Development CSP blocked Next.js hot-reload and overlay `<style>` elements; development now uses `style-src 'unsafe-inline'` without a nonce. Production is unchanged.

### Changed — Iteration 01
- TypeScript pinned to 6.0.3: TypeScript 7.0.2 ships no classic compiler API and typescript-eslint supports `<6.1.0`.
- The cluster model moved to its own pure package, `@sct/network`, to avoid a dependency cycle.
- `@solana/kit-plugin-rpc` is deferred to Iteration 02; read-only calls use `createSolanaRpc` with per-call abort signals.
- Server apps build to self-contained bundles (tsup) and start with `NODE_ENV=production`.

### Fixed — Iteration 01
- Hydration mismatch on the Wallet Overview: `@solana/kit-plugin-wallet/react` hooks reuse the browser snapshot as the server snapshot, so wallet state is now ignored until hydration completes (`useIsHydrated`).

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
