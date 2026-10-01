# Operations

Status: **Baseline (Iteration 00).** Environments, configuration, local development, runbooks, and the Mainnet readiness gate.

---

## 1. Environments

| Environment | `APP_ENV` | Cluster | Database | Purpose |
| --- | --- | --- | --- | --- |
| Local | `local` | `devnet` (default) or `localnet` | Docker PostgreSQL | Development |
| CI | `ci` | `localnet` / stubbed RPC; `devnet` for nightly suite | Docker PostgreSQL service | Automated verification |
| Staging | `staging` | `devnet` | Supabase PostgreSQL | Shared Devnet deployment *(planned)* |
| Production | `production` | **Not permitted in MVP** | — | Requires the Mainnet readiness gate |

## 2. Tooling versions

Versions observed on 2026-09-30. Exact versions are pinned in `package.json` (`packageManager`, `engines`) and `pnpm-lock.yaml` during Iteration 01; always prefer the latest stable compatible release at initialization.

| Tool | Version observed | Notes |
| --- | --- | --- |
| Node.js | 24.x LTS (24.19.0 on the primary dev machine) | Pinned via `.nvmrc` and `engines` |
| pnpm | 12.x (12.8.1 latest; 12.6.0 installed locally) | Pinned via `packageManager` + Corepack |
| Docker | 29.x | Local PostgreSQL and Redis |
| Git | 2.55 | — |

Key libraries observed on npm (2026-09-30), to be re-checked at install time:

| Package | Version |
| --- | --- |
| `@solana/kit`, `@solana/react` | 8.4.0 |
| `@solana/kit-plugin-rpc`, `@solana/kit-plugin-signer` | 0.19.0 |
| `@solana/kit-plugin-wallet` | 0.20.0 |
| `@solana/keychain` | 1.4.0 |
| `@solana-program/system` / `token` / `token-2022` | 0.15.0 / 0.17.0 / 0.19.0 |
| `next` / `react` | 16.3.8 / 19.3.0 |
| `fastify` | 5.12.5 |
| `zod` | 4.6.5 |
| `drizzle-orm` / `drizzle-kit` | 0.45.3 / 0.31.11 |
| `bullmq` / `ioredis` | 6.3.10 / 6.0.0 |
| `pino` | 10.3.1 |
| `turbo` | 2.11.5 |
| `typescript` | 6.0.3 pinned (7.0.2 is the latest stable, but it ships no classic compiler API and typescript-eslint supports `<6.1.0`) |
| `vitest` / `@playwright/test` | 5.0.3 / 1.63.0 |
| `tailwindcss` | 4.3.3 |
| `@tanstack/react-query` | 5.104.0 |
| `@orca-so/whirlpools` | 8.0.1 |
| `litesvm` | 1.5.0 |

## 3. Environment variables

All variables are validated at startup by Zod schemas in `packages/config`. Invalid or missing required values stop the process with a clear message (never printing secret values). See [.env.example](./.env.example).

| Variable | Required | Used by | Description |
| --- | --- | --- | --- |
| `NODE_ENV` | yes | all | `development`, `test`, `production` |
| `APP_ENV` | yes | all | `local`, `ci`, `staging`, `production` |
| `SOLANA_CLUSTER` | yes | api, worker, terminal | `localnet`, `devnet`, `testnet`; `mainnet-beta` rejected in the MVP |
| `SOLANA_RPC_URL` | yes | api, worker | HTTP JSON-RPC URL for the cluster |
| `SOLANA_WS_URL` | no | api, worker | PubSub URL; derived from `SOLANA_RPC_URL` if omitted |
| `SOLANA_RPC_FALLBACK_URL` | no | api, worker | Optional keyed fallback RPC (secret if it embeds a key). Parsed but not used until Iteration 02 |
| `SOLANA_EXPECTED_GENESIS_HASH` | localnet only | api, worker | Required for `localnet`; built-in constants are used for public clusters |
| `NEXT_PUBLIC_SOLANA_CLUSTER` | yes | terminal | Must equal `SOLANA_CLUSTER`; checked at build and at runtime against `/api/v1/system/network` |
| `API_INTERNAL_URL` | yes | terminal | Server-side URL used by Next.js rewrites and Server Components (e.g. `http://localhost:4000`) |
| `API_PORT` | yes | api | Listening port |
| `API_HOST` | no | api | Bind address (default `127.0.0.1`; use `0.0.0.0` only inside containers) |
| `PUBLIC_APP_ORIGIN` | yes | api, terminal | Canonical origin used for SIWS domain/URI and CSRF origin checks |
| `DATABASE_URL` | yes | api, worker | PostgreSQL connection string (application role) |
| `DATABASE_MIGRATION_URL` | migrations | scripts | Connection string for the migration role (DDL privileges) |
| `REDIS_URL` | yes | api, worker | Redis connection string |
| `AUTH_SECRET` | yes | api | ≥ 32 random bytes (base64); signs CSRF tokens and internal tokens |
| `ENCRYPTION_KEY` | yes (from Iteration 02) | api | 32 random bytes (base64) for server-side encryption of sensitive, non-key application data |
| `SESSION_TTL_SECONDS` | no | api | Absolute session lifetime (default 43200) |
| `SESSION_IDLE_TIMEOUT_SECONDS` | no | api | Idle timeout (default 1800) |
| `AUTH_RATE_LIMIT_PER_MINUTE` | no | api | Sign-in requests (challenge + verify) per client per minute (default 20, range 5–1000). The e2e suite raises it to 500 |
| `BOOTSTRAP_OWNER_WALLET_ADDRESS` | no | api | Public address that becomes owner of the default organization on first sign-in while it has no owner (SPEC-007) |
| `DEFAULT_MEMBER_ROLE` | no | api | Temporary: system role (`admin`, `operator`, `trader`, `analyst`, `auditor`, `viewer`) granted in the default organization to users without a membership on sign-in; rejected when `APP_ENV=production` (SPEC-007 RBAC-AC-05) |
| `LOG_LEVEL` | no | all | `debug`, `info`, `warn`, `error` (default `info`) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no | all | Enables OpenTelemetry export when set |
| `RUN_DEVNET_TESTS` | no | tests | `true` enables `@devnet` tests |
| `JUPITER_API_KEY` | no (Iteration 03/04) | api, worker | Backend-only |
| `HELIUS_API_KEY` | no | api, worker | Backend-only |

## 4. Local setup

1. Install Node.js 24 LTS. pnpm manages its own pinned version (`packageManager`), or use `corepack enable`.
2. `pnpm install`. pnpm 12 enforces a minimum release age for new packages; the exact versions pinned at initialization are listed under `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` and should be removed from that list at the next dependency update. Build scripts are allowed only for packages under `allowBuilds`.
3. `cp .env.example .env` and set `AUTH_SECRET` (`openssl rand -base64 32`) and `BOOTSTRAP_OWNER_WALLET_ADDRESS` (your Devnet wallet's public address).
4. Start Docker Desktop, then `pnpm infra:up` — Docker Compose (`infra/docker/compose.yaml`) starts:
   - PostgreSQL 18.6 on `127.0.0.1:5432` with the local-only roles `sct_migrator` (DDL) and `sct_app` (runtime) from `infra/docker/postgres/init/01-roles.sql`, plus a `solana_terminal_test` database;
   - Redis 8.8.3 on `127.0.0.1:6379` (AOF persistence, `noeviction`).
5. `pnpm db:migrate` then `pnpm db:seed` (seeds **only** the permission catalog, system roles, and a default organization — never financial data). Re-run both after pulling changes that add migrations or permissions (Iteration 01.5 added `user_preferences`, `platform_settings`, and the owner-only `platform.administer` permission).
6. `pnpm dev` — terminal on `http://localhost:3000`, API on `http://localhost:4000`, worker in the background.
7. Switch your browser wallet to **Devnet**, connect, and sign in.

Production-style local run: `pnpm build`, then `pnpm --filter @sct/api start`, `pnpm --filter @sct/worker start`, and `pnpm --filter @sct/terminal start`. The API and worker build to self-contained bundles (tsup) and `start` forces `NODE_ENV=production` (JSON logs, no pretty printer).

Tests use the `solana_terminal_test` database and Redis logical database 1; the integration and e2e global setup rebuilds that database from the migrations. `pnpm test:e2e` starts its own API and terminal on ports 4000 and 3000, so stop `pnpm dev` first.

Localnet (optional, Iteration 02+): run `solana-test-validator` in WSL2 or Docker; set `SOLANA_CLUSTER=localnet`, `SOLANA_RPC_URL=http://127.0.0.1:8899`, and `SOLANA_EXPECTED_GENESIS_HASH`.

## 5. Database operations

- Migrations are generated by Drizzle Kit, reviewed by a human, and committed to `packages/database/migrations`.
- Forward-only. Use expand → migrate → contract for changes to populated tables.
- **Destructive migrations (dropping columns/tables, narrowing types, deleting data) require explicit human approval** and a backup.
- The application role has no DDL privileges and no `UPDATE`/`DELETE` on `audit_events`. It may only `SELECT` from `drizzle.__drizzle_migrations`, so the owner console can report applied vs. committed migrations.
- Hosted (staging): Supabase PostgreSQL with point-in-time recovery enabled before any shared use.

## 6. Jobs and queues

- Queues and schedules are documented in [ARCHITECTURE.md §13](./ARCHITECTURE.md#13-job-architecture).
- Failed jobs after max retries move to a dead-letter state and raise a provider/queue health signal.
- Queue backlog and failure rate are exported as metrics.

## 7. Health and observability

| Endpoint / signal | Meaning |
| --- | --- |
| `GET /api/v1/system/health` | Process is alive |
| `GET /api/v1/system/readiness` | PostgreSQL, Redis reachable and Solana cluster verified |
| `GET /api/v1/system/network` | Cluster identity and verification status |
| `GET /api/v1/system/providers` | Provider health (`HEALTHY`, `DEGRADED`, `RATE_LIMITED`, `UNAVAILABLE`, `DISABLED`, `UNKNOWN`) |
| Owner console (`/settings/console`) | Owner-only live view of readiness, cluster, provider history, PostgreSQL/Redis facts, BullMQ queues, sessions, and the audit log (SPEC-026) |
| Logs | JSON (`pino`) to stdout; pretty-printed locally |
| Traces / metrics | OpenTelemetry; exported only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set |

## 8. Runbooks

### 8.1 RPC rate limited
Symptoms: provider health `RATE_LIMITED`, UI shows "RPC rate limited". Actions: confirm internal budget metrics; reduce polling schedules; enable `SOLANA_RPC_FALLBACK_URL` if configured; never raise internal budgets above documented provider limits.

### 8.2 RPC unavailable or cluster verification failed
Symptoms: readiness `503`, `CLUSTER_VERIFICATION_FAILED` or `RPC_UNAVAILABLE`. Actions: check `GET /system/network`; verify `SOLANA_RPC_URL` points at the configured cluster; check status.solana.com; switch to fallback RPC. Never override the genesis check.

### 8.3 External provider unavailable
Actions: confirm in `/system/providers`; check the provider's status page and docs for API changes; if schema changed, disable the provider (audited) and open an iteration item. The UI must already show `Provider unavailable`.

### 8.4 Queue backlog
Actions: inspect failing job type and error; pause the scheduler for the affected queue; fix, then resume. Do not purge queues containing transaction confirmation or reconciliation jobs.

### 8.5 Migration failure
Actions: stop deployment; do not hand-edit production schema; restore from backup only with human approval; fix migration forward.

### 8.6 Secret rotation
Rotate `AUTH_SECRET` (invalidates CSRF tokens; sessions remain valid because only hashes are stored), provider keys, and database passwords per environment. `ENCRYPTION_KEY` rotation requires a re-encryption job with key versioning (Iteration 02 design).

### 8.7 Suspected key or session compromise
Revoke all sessions for the affected user/organization (owner console → Members → Revoke sessions, or Disable account); rotate secrets; review audit events by `requestId` and actor (owner console → Audit log); document the incident.

## 9. Incident response (baseline)

1. Detect (health, metrics, user report). 2. Triage severity. 3. Contain (disable provider, revoke sessions, pause queues). 4. Communicate. 5. Recover. 6. Blameless post-incident review recorded in `docs/operations/incidents/`.

## 10. Mainnet readiness gate

Mainnet may be enabled only when **all** of the following are complete and a human owner explicitly approves:

- [ ] Production RPC provider with SLA, separate credentials, and failover
- [ ] Separate production database, Redis, encryption keys, secrets store, and monitoring
- [ ] Institutional signing architecture (KMS/HSM/MPC/multisig via `@solana/keychain`) reviewed
- [ ] Transaction policy engine (limits, allowlists, approvals) implemented and tested
- [ ] Priority fee and compute budget strategy; transaction landing and retry policy
- [ ] Reconciliation proven on Devnet under failure scenarios
- [ ] Rate limits and provider budgets sized for production traffic
- [ ] Backups, point-in-time recovery, and restore drills
- [ ] Incident response procedures and on-call ownership
- [ ] Complete audit coverage verified; audit retention policy
- [ ] External security review / penetration test
- [ ] Legal and compliance review of trading and data features
- [ ] Explicit configuration change removing the MVP `mainnet-beta` rejection, reviewed and audited
