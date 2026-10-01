# SPEC-001 — Foundation

| Field | Value |
| --- | --- |
| Status | IMPLEMENTED |
| Iteration | 01 |
| Domain(s) | cross-cutting: monorepo, configuration, observability, database, jobs, CI |
| Criteria prefix | `FND` |
| Related | ADR-0001, ADR-0002, ADR-0006, ADR-0007, SPEC-005, SPEC-006 |

## 1. Problem and goal

Provide a monorepo, runtime configuration, infrastructure, observability, and quality gates that every later vertical slice builds on, without introducing premature abstraction.

## 2. Scope

In scope: pnpm + Turborepo workspace; `apps/terminal`, `apps/api`, `apps/worker`; packages `config`, `observability`, `database`, `solana`, `validation`, `ui`, `testing`; local PostgreSQL and Redis via Docker Compose; environment validation; structured logging; OpenTelemetry-compatible setup; linting, formatting, type checking, testing, and CI.

Out of scope: deployment to hosted environments; production observability backends.

## 3. Behavior

### 3.1 Workspace
- Root scripts orchestrate apps through Turborepo: `dev`, `build`, `lint`, `typecheck`, `test`, `test:unit`, `test:integration`, `test:e2e`, `test:devnet`, `infra:up`, `infra:down`, `db:generate`, `db:migrate`, `db:seed`.
- TypeScript strict mode everywhere, including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.

### 3.2 Configuration
- Each app parses its environment once at startup with a Zod schema from `packages/config`.
- Validation errors list the offending variable names and the reason, never the values of secret variables.
- Browser-exposed configuration is limited to `NEXT_PUBLIC_*` variables declared in a dedicated public schema.

### 3.3 Observability
- Logs are JSON with a stable field set (`level`, `time`, `msg`, `requestId`, `traceId`, `feature`, `operation`, `durationMs`, `result`, `organizationId`, `userId`).
- A central redaction list removes secrets (see SECURITY.md §10).
- Each HTTP request and each job execution has a request/trace context.

### 3.4 Database and Redis
- Migrations are committed and applied with `pnpm db:migrate` using the migration role.
- The application connects with a least-privilege role.
- Redis is used for rate limiting, cache, and BullMQ.

### 3.5 Worker
- The worker starts, registers queues, runs the `system.provider-health` repeatable job, and shuts down gracefully on `SIGTERM`/`SIGINT` (finishes in-flight jobs up to a timeout).

## 4. Security considerations

- `.env` is git-ignored; only `.env.example` is committed.
- pnpm lifecycle scripts restricted to an allowlist.
- Runtime code cannot import test code.

## 5. Acceptance criteria

### FND-AC-01 — Local startup
Given Docker, Node.js 24, and pnpm are installed and `.env` is filled from `.env.example`
When the developer runs `pnpm install`, `pnpm infra:up`, `pnpm db:migrate`, and `pnpm dev`
Then the terminal is served on port 3000, the API on port 4000, and the worker is running, with no errors in the logs.

### FND-AC-02 — Readiness
Given the stack is running
When `GET /api/v1/system/readiness` is called
Then it returns `200` only if PostgreSQL, Redis, and Solana cluster verification are all healthy, and `503` with per-dependency status otherwise (without internal hostnames or credentials).

### FND-AC-03 — Fail-fast configuration
Given a required variable is missing or invalid (e.g. `DATABASE_URL` not a URL, `AUTH_SECRET` shorter than 32 bytes)
When any app starts
Then it exits with a non-zero code and a message naming the variable and the rule violated, without printing secret values.

### FND-AC-04 — Structured logs with request context
Given an HTTP request to the API
When it completes
Then exactly one completion log line contains `requestId`, `traceId`, `operation`, `durationMs`, and `result`, and the `X-Request-Id` response header equals `requestId`.

### FND-AC-05 — Secret redaction
Given log calls containing fields named like `privateKey`, `secretKey`, `seed`, `mnemonic`, `passphrase`, `password`, `apiKey`, `authorization`, or `cookie`
When logs are emitted
Then those values appear as `[REDACTED]`.

### FND-AC-06 — Migrations
Given an empty database
When `pnpm db:migrate` runs
Then all committed migrations apply in order, and running it again is a no-op.

### FND-AC-07 — Least-privilege database role
Given the application role
When it attempts `UPDATE` or `DELETE` on `audit_events`, or any DDL statement
Then PostgreSQL denies the operation.

### FND-AC-08 — No test code in runtime
Given the dependency-boundary check
When any file under `apps/*/src` or `packages/*/src` (excluding test files) imports from `packages/testing`, `tests/`, or `__fixtures__/`
Then the check fails in CI.

### FND-AC-09 — Worker lifecycle
Given the worker is running
When it receives `SIGTERM`
Then it stops accepting new jobs, completes or releases in-flight jobs within the configured timeout, closes connections, and exits `0`.

### FND-AC-10 — Continuous integration
Given a pull request
When CI runs
Then it executes install (frozen lockfile), lint, typecheck, unit, integration (with PostgreSQL and Redis services), contract, e2e, boundary check, dependency audit, and build, and fails on any error.

### FND-AC-11 — Architecture is visible
Given the repository tree
When a reviewer lists `apps/api/src` and `apps/terminal/src`
Then the top-level folders are business domains (`wallets`, `system`, `auth`, `audit`, `network`, …), and no `utils.ts`, `helpers.ts`, `common.ts`, or `misc.ts` files exist (enforced by lint).

## 6. Test plan

| Criterion | Layer |
| --- | --- |
| FND-AC-01 | E2E smoke in CI (docker services) |
| FND-AC-02 | Integration (Fastify inject with dependency toggles) |
| FND-AC-03 | Unit (config schemas) |
| FND-AC-04, 05 | Unit + integration (log capture) |
| FND-AC-06, 07 | Integration (PostgreSQL) |
| FND-AC-08, 11 | CI static checks |
| FND-AC-09 | Integration (worker process) |
| FND-AC-10 | CI workflow |

## Amendments

- **2026-09-30 (Iteration 01):** Status set to IMPLEMENTED. FND-AC-01..11 pass (see checklist test evidence); FND-AC-10 is verified locally and awaits its first run on GitHub runners.
- **2026-09-30:** The cluster model lives in `packages/network` and outbound provider plumbing in `packages/providers` (two packages added to the §2 list) to avoid a dependency cycle between `solana`, `providers`, and `validation`.
