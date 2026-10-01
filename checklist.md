# Checklist

Canonical implementation roadmap. The newest iteration always appears first. Historical iterations are never rewritten; acceptance criteria are never silently changed (amendments are appended with a date and reason).

Status values: `NOT STARTED` · `IN PROGRESS` · `BLOCKED` · `COMPLETE`

---

# Current Iteration

## Iteration 01.5 — User Settings and Owner Console

Status: IN PROGRESS — implementation complete and tested; awaiting owner verification in a real browser (started and implemented 2026-10-01, owner request)

Goal:
Give every signed-in user a Settings section to manage their profile, functional usability preferences, and sessions; give the owner a console inside Settings to operate the platform at administrator and developer level (people and access, sessions, audit log, organization, announcement, runtime and infrastructure state, jobs, developer tooling), with real data only.

Inserted between Iteration 01 and 02 at the owner's request. It brings forward, for the owner only, part of Iteration 08 (membership management, audit viewer); teams, invitations, custom roles, ownership transfer, and API credentials stay in Iteration 08.

Specifications:
- [SPEC-025 User settings](./docs/specs/SPEC-025-user-settings.md)
- [SPEC-026 Owner console](./docs/specs/SPEC-026-owner-console.md)
- Amendments (2026-10-01): SPEC-002 (refresh preference, explorer, time zone), SPEC-005 (explorer choice), SPEC-007 (`platform.administer`, disabled accounts, configurable sign-in limit), SPEC-008 (new audit actions)

Acceptance Criteria (summary; full criteria in the specs):
- Every signed-in user has `Settings` with Profile, Preferences, and Sessions (SET-AC-01..03, 07..09).
- Preferences persist per user server-side, are read tolerantly, and change real behavior: time zone, density, reduced motion, explorer, overview refresh (≥ 30 s or off), shortcuts, address display (SET-AC-04..06).
- Only the owner (`platform.administer`) sees and can call the console; `admin` is refused and audited (OWN-AC-01).
- The console shows live counters, members, sessions, audit log, organization and role matrix, announcement, runtime facts without secrets, cluster re-verification, provider history, queues, and the route catalog, and its state changes are audited and reversible (OWN-AC-02..16).

Dependencies:
- Iteration 01 foundation (sessions, RBAC, audit, provider health snapshots, worker queue).
- `pnpm db:migrate && pnpm db:seed` on every environment (two new tables, migration-log read grant, new permission).

Risks:
- Platform-wide views (all users, all sessions) are correct for the single default organization; when several organizations exist, a platform-operator role distinct from organization owner is needed (Iteration 08).
- The permission cache is per API process: role, membership, and account changes apply immediately in the process that handled them and within 60 s elsewhere (SPEC-007 §7).

Verification:
- Unit, integration, and e2e tests reference SET-AC and OWN-AC ids (evidence below).
- Owner check in a real browser: sign in as the bootstrap owner, open Settings → Owner console, and exercise each section.

### Work breakdown

#### 1.5.1 Specifications
- [x] SPEC-025 User settings and SPEC-026 Owner console with numbered acceptance criteria
- [x] Dated amendments to SPEC-002, SPEC-005, SPEC-007, SPEC-008

#### 1.5.2 Contracts, configuration, and data
- [x] `platform.administer` (owner only); `admin` holds every other permission; `OPERATION_NOT_ALLOWED` and `ACCOUNT_DISABLED` error codes
- [x] Zod contracts: profile, preferences (versioned, tolerant reader), session listings, members, organization, role matrix, announcement, overview, runtime, provider history, queues, route catalog, cache purge
- [x] Migrations `0002` (`user_preferences`, `platform_settings`) and `0003` (read-only access to the migration log)
- [x] Queue names shared through `@sct/config`; `AUTH_RATE_LIMIT_PER_MINUTE` (default 20)

#### 1.5.3 API
- [x] `/me/profile`, `/me/preferences`, `/me/sessions` (+ revoke one / others), `/announcements/current`
- [x] `/admin/overview`, `/admin/users` (+ role, membership, status, revoke sessions), `/admin/sessions` (+ revoke), `/admin/organization`, `/admin/roles`, `/admin/announcement`
- [x] `/admin/system/runtime`, `/admin/system/cluster/verify`, `/admin/system/provider-history`, `/admin/jobs` (+ run probe), `/admin/developer/routes`, `/admin/developer/cache/purge`
- [x] Protection rule (self, owners, no ownership grants), audit events for every change, disabled accounts refused at sign-in

#### 1.5.4 Terminal
- [x] `Settings` navigation entry, settings frame with Personal and Owner console groups
- [x] Profile, Preferences, Sessions views; preferences applied globally (density, motion, time zone, address display, explorer links, refresh interval, shortcuts)
- [x] Owner console: Overview, Members, Sessions, Audit log, Organization (+ role matrix), Announcement (+ preview), System, Jobs, Developer
- [x] Announcement banner under the status bar; display name in the status bar
- [x] Accessible confirmations for sensitive actions, focusable scroll regions, loading/empty/error/unavailable states

#### 1.5.5 Tests and documentation
- [x] Unit, integration, and e2e tests mapped to SET-AC / OWN-AC
- [x] API.md, ARCHITECTURE.md, SECURITY.md, OPERATIONS.md, TESTING.md, database design, spec index, changelog
- [ ] Owner verification in a real browser with a Devnet wallet
- [ ] Mark iteration COMPLETE — after owner verification

### Test evidence (2026-10-01)

| Suite | Result |
| --- | --- |
| Unit (`pnpm test:unit`) | 74 passed |
| Integration (`pnpm test:integration`: PostgreSQL + Redis + stub RPC) | 65 passed |
| End-to-end (Chromium desktop + mobile, real Devnet RPC; run on ports 3100/4100 because local dev servers held 3000/4000) | 24 passed |
| Lint, boundaries, typecheck, format, build, bundle check | Passing |

### Self-review (prompt §111, 2026-10-01)

**Architecture.** New code lives in domain folders (`users`, `announcements`, `developer`, and extensions of `auth`, `organizations`, `system`); application services depend on ports; the protection rule is a pure domain function. dependency-cruiser passes.

**Security.** Owner-only routes are enforced in the API (generated test over every `/admin` route) and denials are audited. No secret reaches a response (tested by scanning the runtime response). User-supplied text (display names, organization name, announcement) is validated against control and format characters and rendered as text. Sensitive actions are reversible and confirmed in the UI.

**Data.** Every console figure comes from PostgreSQL, Redis, BullMQ, the API process, or the RPC; an unreadable dependency renders `DATA UNAVAILABLE` with a reason. Preferences only change presentation.

**Testing.** Every SET-AC and OWN-AC criterion has a test; the e2e suite runs axe on the new pages (it found and drove a fix for unfocusable scroll regions).

**Documentation.** Specs, amendments, API, architecture, security, operations, testing, and database docs updated.

**UX.** Loading states name the operation; empty states state what is true; errors show request ids; console navigation appears only for the owner.

---

## Iteration 01 — Foundation and Wallet Overview Vertical Slice

Status: IN PROGRESS — implementation complete and tested; awaiting owner verification with a real browser wallet and the first CI run (started 2026-09-30)

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
- Docker available locally (verified: Docker 29.8.0; Docker Desktop must be running).
- Node.js 24 LTS (verified: 24.19.0) and pnpm 12 (verified: 12.6.0 local).
- Public Devnet RPC (verified reachable 2026-09-30).
- A Wallet Standard browser wallet supporting Devnet for manual verification.
- ADR-0005 (authentication): resolved 2026-09-30 — SIWS + server-side sessions.

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
- [x] Re-verify latest stable versions of every dependency listed in OPERATIONS.md §2 (npm registry, 2026-09-30)
- [x] Verify TypeScript 7 compatibility with Next.js, ESLint (typescript-eslint), Vitest, Drizzle Kit; record the pinned version and rationale in changelog — TypeScript 7.0.2 ships no classic JS compiler API (exports only `unstable/*`) and typescript-eslint 8.71 requires `>=4.8.4 <6.1.0`; pinned TypeScript 6.0.3.
- [x] Re-read official `@solana/kit` docs: client assembly with plugins, `@solana/react`, `@solana/kit-plugin-wallet` hooks, SIWS support (package README and type declarations 0.20.0)
- [x] Confirm Wallet Standard chain identifiers (`solana:devnet`, …) used by `@solana/kit-plugin-wallet` — the plugin filters discovered wallets by the configured chain

#### 1.1 Monorepo
- [x] Root `package.json` with `packageManager`, `engines`, workspace scripts (`dev`, `build`, `lint`, `typecheck`, `test*`, `infra:*`, `db:*`, `check:bundle`)
- [x] `pnpm-workspace.yaml`, `turbo.json`, `.nvmrc`, `.gitignore`, `.editorconfig`, `.gitattributes`
- [x] `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) and per-package tsconfigs
- [x] ESLint flat config + Prettier; import boundary rules; `utils`/`helpers`/`common`/`misc` modules banned (dependency-cruiser)
- [x] Dependency-boundary check (runtime code cannot import `packages/testing` or `tests/`; domain/application layering; no cycles)
- [x] pnpm build-script allowlist — pnpm 12 uses `allowBuilds` (replaces `onlyBuiltDependencies`)

#### 1.2 Configuration (`packages/config`)
- [x] Zod env schemas per app (api, worker, terminal-server, terminal-public)
- [x] Cluster enum and rules (`mainnet-beta` rejected with the readiness-gate message)
- [x] `.env.example` kept in sync (test asserts every schema key is documented)

#### 1.3 Observability (`packages/observability`)
- [x] `pino` logger with central redaction list
- [x] Request context (`requestId`, `traceId`, `organizationId`, `userId`, `feature`, `operation`)
- [x] OpenTelemetry setup (no-op when no exporter configured) — the export path has not yet been exercised against a collector
- [x] Test: known secret shapes never appear in log output

#### 1.4 Database (`packages/database`)
- [x] Drizzle setup; migration and application roles
- [x] Iteration 01 schema (12 tables; see docs/architecture/database.md)
- [x] Revoke `UPDATE`/`DELETE`/`TRUNCATE` on `audit_events` from the application role
- [x] Seed: permission catalog, system roles, and one default organization (no financial data)
- [x] Integration tests for migrations, privileges, and repositories

#### 1.5 Infrastructure and worker
- [x] `infra/docker/compose.yaml` (PostgreSQL 18.6, Redis 8.8.3) with health checks
- [x] `apps/worker` bootstrap with BullMQ, graceful shutdown
- [x] `system.provider-health` repeatable job probing Solana RPC (`getSlot` every minute, `getGenesisHash` every 5 minutes) within budget, with snapshots to PostgreSQL

#### 1.6 API foundation (`apps/api`)
- [x] Fastify bootstrap, Zod type provider, error handler emitting the standard error format
- [x] `@fastify/helmet`, `@fastify/rate-limit` (Redis), cookie handling, CSRF protection (origin check + synchronizer token)
- [x] Permission declaration per route with default deny and a startup check
- [x] `/api/v1/system/health`, `/readiness`, `/network`, `/providers`
- [x] OpenAPI generation from Zod contracts (non-production, `/api/v1/openapi.json`)

#### 1.7 Solana package (`packages/solana`)
- [x] Cluster constants (genesis hashes verified 2026-09-30) and explorer link builder — moved to `packages/network` (pure, shared by config, validation, and terminal)
- [x] RPC client assembly via `@solana/kit` (`createSolanaRpc`) — Amendment 2026-09-30: `@solana/kit-plugin-rpc` is not needed for read-only calls with per-call abort signals; it is deferred to Iteration 02, where transaction sending starts
- [x] Provider call wrapper (`packages/providers`): timeout, retry (exponential backoff + full jitter), concurrency limit, Redis token bucket (total + per method), latency, health recording, endpoint redaction
- [x] Narrow readers: `ClusterIdentityReader`, `SolBalanceReader`, `TokenAccountReader` (SPL Token + Token-2022), `SignatureHistoryReader`
- [x] RPC error classification: `RPC_RATE_LIMITED`, `RPC_TIMEOUT`, `RPC_UNAVAILABLE`, `RPC_INVALID_RESPONSE`
- [x] Devnet integration tests (`@devnet`, compared against raw JSON-RPC calls)
- [ ] Fallback RPC (`SOLANA_RPC_FALLBACK_URL`) — the variable is parsed but not used; deferred to Iteration 02

#### 1.8 Authentication foundation (`apps/api/src/auth`)
- [x] SIWS challenge/verify endpoints, single-use challenges, Ed25519 verification via Web Crypto (`solana:signIn` and `signMessage` fallback)
- [x] Session creation (hashed ids), cookie flags, idle/absolute expiry, logout
- [x] Provisioning — Amendment 2026-09-30: replaced by SPEC-007 RBAC-AC-04 (bootstrap owner via `BOOTSTRAP_OWNER_WALLET_ADDRESS`; no automatic membership for other users), which takes precedence over the earlier "viewer by default" note
- [x] Audit: `user.login`, `user.login_failed`, `user.logout`, `authorization.denied`, `role.assigned`
- [x] Temporary default member role `DEFAULT_MEMBER_ROLE` for unaffiliated users, rejected in production (RBAC-AC-05, owner request 2026-10-01; remove once Iteration 08 membership management ships)

#### 1.9 Wallet Overview backend (`apps/api/src/wallets`)
- [x] Domain mappings: lamports, token amounts (exact integer arithmetic), token accounts, signature summaries, untrusted-text sanitizer
- [x] `Sourced<T>` implementation and availability rules (SPEC-003)
- [x] Application: `GetWalletOverview` use case with partial-failure semantics and a 10 s section cache
- [x] Route `GET /api/v1/wallets/{address}/overview` (`wallet.read`)
- [x] Route `POST /api/v1/wallets/connections` + audit `wallet.connected` / `wallet.connection_rejected`
- [x] Unit, integration, and Devnet tests mapped to WO-AC ids

#### 1.10 Terminal shell (`apps/terminal`)
- [x] Next.js 16 App Router, Tailwind CSS 4, design tokens from docs/design/ui-guidelines.md
- [x] Nonce-based CSP (`proxy.ts`) and security headers; rewrites `/api/v1/*` → API
- [x] Shell: navigation (only existing capabilities), status bar with `SOLANA DEVNET`, cluster verification status, provider health, organization, sign out
- [x] `@solana/kit-plugin-wallet` connection (`walletWithoutSigner`, chain-filtered discovery) in a client island
- [x] Sign-in flow (SIWS) and session handling
- [x] Wallet connection moved to the status bar (`Connect <wallet>` on every page); connecting while signed out also signs in (AUTH-AC-07, added 2026-10-01)
- [x] Fix: wallet client disposed by StrictMode in development; development CSP allows Next.js `<style>` elements (2026-10-01)

#### 1.11 Wallet Overview UI (`apps/terminal/src/wallets`)
- [x] Address (copy, explorer link), SOL balance with freshness and a provenance popover
- [x] Token accounts table with empty state
- [x] Recent transactions table with empty state
- [x] Loading skeletons with operation text, error states, `DATA UNAVAILABLE`, stale indicator, retry action
- [x] Wallet disconnected and cluster mismatch states; watch view with client-side address validation
- [x] Keyboard shortcuts (`/`, `R`), screen-reader labels, axe checks (no serious or critical violations)

#### 1.12 Testing foundation
- [x] Vitest projects (unit, integration, devnet); Playwright config; axe integration
- [x] `packages/testing`: test Wallet Standard wallet, keypair helpers, stub RPC server for failure modes
- [x] Production bundle check: test-only markers absent (`pnpm check:bundle`)

#### 1.13 CI
- [x] GitHub Actions workflow: frozen install, format, lint, boundaries, typecheck, `pnpm audit --audit-level high`, secret scan, unit, integration (PostgreSQL + Redis services), build, bundle check, e2e
- [x] Nightly workflow for `@devnet` tests
- [x] Dependabot configuration
- [ ] First CI run on GitHub — pending the next push to the remote (the workflows have not run on GitHub runners yet)

#### 1.14 Close-out
- [x] Update ARCHITECTURE.md, API.md, DATA_SOURCES.md, TESTING.md, OPERATIONS.md, SECURITY.md with as-built details
- [x] changelog.md entry for Iteration 01
- [x] Self-review against prompt §111 recorded below
- [ ] Manual verification with a real browser wallet (e.g. Phantom, Solflare, Backpack) on Devnet — requires the owner (see Verification)
- [ ] Mark iteration COMPLETE — after the two pending owner/CI verifications above

### Test evidence (2026-09-30)

| Suite | Result |
| --- | --- |
| Unit (`pnpm test:unit`) | 55 passed |
| Integration (`pnpm test:integration`: PostgreSQL + Redis + stub RPC) | 40 passed |
| Devnet (`pnpm test:devnet`: real public RPC) | 5 passed (rate-limited runs are reported as explicit skips) |
| End-to-end (`pnpm test:e2e`: Chromium desktop + mobile, real Devnet RPC) | 14 passed |
| Lint, boundaries, typecheck, build, bundle check | Passing |
| `pnpm audit --audit-level high` | Passing (2 dev-only esbuild advisories, low/moderate; see SECURITY.md §13) |

### Open Decisions

| # | Decision | Blocking? | Proposed default |
| --- | --- | --- | --- |
| D-01 | Authentication approach ([ADR-0005](./docs/architecture/adr/0005-authentication.md)) | RESOLVED 2026-09-30 | SIWS + server-side sessions (confirmed by owner) |
| D-02 | Hosted database for staging: Supabase project (requires account/credentials) | No (local Docker first) | Supabase, created when staging is needed |
| D-03 | Devnet valuation policy ([ADR-0009](./docs/architecture/adr/0009-devnet-valuation-policy.md)) | Blocks Iteration 03 | Show `UNAVAILABLE` for Devnet USD value; optional labeled Mainnet reference price |
| D-04 | Devnet DEX strategy ([ADR-0008](./docs/architecture/adr/0008-devnet-dex-strategy.md)) | Blocks Iteration 04 | Orca Whirlpools on Devnet; Jupiter read-only Mainnet quotes |
| D-05 | Deployment target for staging (e.g. Vercel + container host) | No | Decide before staging |
| D-06 | Jupiter / Helius API keys (free tiers require keys) | Blocks Iteration 03/04 providers | Owner creates keys; stored as secrets only |

### Self-review (prompt §111, 2026-09-30)

**Architecture.** Top-level folders in `apps/api/src` and `apps/terminal/src` are domains (`wallets`, `auth`, `audit`, `system`, `network`, `organizations`, `shell`), plus a small `platform` folder for HTTP plumbing. dependency-cruiser enforces domain/application isolation, no test code in runtime, no cycles, and no utils graveyards. The Solana RPC is isolated behind narrow readers in `packages/solana`; all outbound calls go through `packages/providers`.

**Security.** No private key reaches the API; sign-in signs a text message only. Every route declares access, and default deny is enforced at startup. Sessions are server-side with hashed tokens, `HttpOnly`/`SameSite=Strict` cookies, and CSRF origin + token checks. The audit table is append-only for the application role. External strings (memos) are sanitized and rendered as text; CSP is nonce-based. Known gap: SIWS challenge issuance is limited per IP (auth rate limit) but not per wallet address.

**Data.** Every on-chain value is a `Sourced<T>` with provenance (source, method, network, commitment, slot, retrieval time, latency, request id). Data older than 60 s is shown as stale; unavailable data renders `DATA UNAVAILABLE` with reason, source, last success, and retry state. No USD value is shown for Devnet SOL.

**Solana.** The configured cluster is verified by genesis hash at startup and every 5 minutes (API) and by the worker probe; Mainnet is rejected by configuration and treated as a critical incident if an RPC serves it. Transactions, simulation, and reconciliation are out of scope for this iteration (SPEC-004, Iteration 02).

**Testing.** Domain rules, adapters, failure modes (outage, 429, timeout, invalid payload, partial failure), the authorization matrix, audit immutability, and UI states are covered; real Devnet data is verified against raw JSON-RPC calls. Gap: UI failure rendering uses test-only response interception; the API failure behavior itself is covered by integration tests.

**Documentation.** Specs were amended where the implementation clarified behavior (dated amendments); ARCHITECTURE, API, DATA_SOURCES, SECURITY, TESTING, OPERATIONS, the database design, and the changelog were updated.

**UX.** Loading states name the running operation; empty states state what is true; errors show request ids. Only implemented capabilities appear in navigation. The mobile layout turns tables into rows and keeps the network indicator visible.

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
