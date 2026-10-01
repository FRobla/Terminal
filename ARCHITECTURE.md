# Architecture

Status: **As built through Iteration 01.** Sections marked *(planned)* are not yet implemented. Each section is updated when the implementation changes.

### As-built notes (Iteration 01)

- **Packages.** In addition to the packages listed in §4, `packages/network` holds the pure cluster model (clusters, genesis hashes, Wallet Standard chains, explorer links, cluster verification) and `packages/providers` holds the outbound provider pipeline (token-bucket budgets, retries, timeouts, health store, provenance builders). Both exist to keep the dependency graph acyclic: `validation` and `config` depend on `network`; `solana` depends on `providers`.
- **API layout.** `apps/api/src/{auth,audit,organizations,system,wallets}` plus `platform/` (error format, request context, envelope, unit of work). `services.ts` is the composition root; `server.ts` registers plugins and routes.
- **Solana access.** `createSolanaRpc` from `@solana/kit` with per-call `AbortSignal`s, wrapped by `SolanaRpcClient` and four narrow readers. `@solana/kit-plugin-rpc` is deferred to Iteration 02 (transaction sending).
- **Terminal wallet client.** `createClient().use(walletWithoutSigner({ chain }))` from `@solana/kit-plugin-wallet`; discovery lists only wallets that support the configured chain. No signer is attached in Iteration 01.
- **Builds.** The terminal builds with Next.js (Turbopack). The API and worker build to self-contained ESM bundles with tsup (workspace packages ship TypeScript source).
- **Toolchain.** TypeScript 6.0.3 (see changelog); Next.js 16 uses `proxy.ts` (formerly `middleware.ts`) for the per-request CSP nonce.

Related: [SECURITY.md](./SECURITY.md) · [DATA_SOURCES.md](./DATA_SOURCES.md) · [API.md](./API.md) · [Domain model](./docs/architecture/domain-model.md) · [Database](./docs/architecture/database.md) · [ADRs](./docs/architecture/adr/README.md)

---

## 1. Context and goals

The Solana Corporate Terminal is an internal operations platform for organizations that manage wallets, tokens, and trading activity on Solana. The MVP runs on **Devnet**.

Quality attributes, in priority order (from the product charter):

1. Security
2. Correctness
3. Data integrity
4. Architecture
5. Testability
6. Observability
7. Maintainability
8. Performance
9. UX
10. Visual polish

## 2. System overview

```
                       ┌──────────────────────────────────────────────┐
  Browser              │ apps/terminal (Next.js App Router)           │
  ┌─────────────┐      │  - Server Components for read views          │
  │ Wallet      │◄────►│  - Client islands: wallet connection,        │
  │ (Wallet     │ sign │    signing, live data (TanStack Query)       │
  │  Standard)  │      │  - Rewrites /api/v1/* → apps/api (same-origin)│
  └─────────────┘      └──────────────────┬───────────────────────────┘
                                          │ HTTPS, session cookie, CSRF token
                       ┌──────────────────▼───────────────────────────┐
                       │ apps/api (Fastify)                            │
                       │  auth · authorization · validation · audit    │
                       │  domain modules: wallets, system, audit, ...  │
                       │  provider ports ─► adapters                   │
                       └───┬──────────────┬───────────────┬────────────┘
                           │              │               │
                 ┌─────────▼───┐   ┌──────▼─────┐  ┌──────▼─────────────┐
                 │ PostgreSQL  │   │ Redis      │  │ External providers │
                 │ (Drizzle)   │   │ cache,     │  │ Solana RPC (Devnet)│
                 │ app state,  │   │ rate limit,│  │ market / metadata  │
                 │ audit       │   │ BullMQ     │  │ (see DATA_SOURCES) │
                 └─────────▲───┘   └──────▲─────┘  └──────▲─────────────┘
                           │              │               │
                       ┌───┴──────────────┴───────────────┴───────────┐
                       │ apps/worker (BullMQ)                          │
                       │  provider health probes, wallet sync,         │
                       │  indexing, alert evaluation, reconciliation   │
                       └───────────────────────────────────────────────┘
```

## 3. Deployable units

| Unit | Technology | Responsibility |
| --- | --- | --- |
| `apps/terminal` | Next.js (App Router), React, TypeScript, Tailwind CSS, Radix primitives, TanStack Query | Presentation, wallet connection, client-side signing, UX-level permission hints. Never the source of truth for business rules. |
| `apps/api` | Node.js, Fastify, Zod, Drizzle | Authentication, authorization, domain services, provider adapters, Solana RPC access, transaction preparation and simulation, audit logging, rate limiting. |
| `apps/worker` | Node.js, BullMQ | Long-running and scheduled work: synchronization, indexing, provider health, alert evaluation, notification dispatch, reconciliation. |
| PostgreSQL | Supabase PostgreSQL (hosted), Docker PostgreSQL (local) | Off-chain application state, caches with provenance, audit log. Never a replacement for blockchain state. |
| Redis | Redis-compatible | Short-lived cache, distributed rate limiters, BullMQ queues, idempotency keys. |

The browser never runs long indexing tasks and never talks directly to paid or keyed providers. The browser talks to the Solana RPC only when the connected wallet requires it for signing flows.

## 4. Repository structure

Screaming Architecture: top-level folders inside each app are **business domains**.

```
apps/api/src/
├── wallets/
│   ├── domain/            entities, value objects, invariants, pure calculations
│   ├── application/       use cases (queries/commands), orchestration
│   ├── infrastructure/    repositories, provider-backed readers
│   ├── http/              Fastify routes, request/response mapping
│   └── index.ts           module registration (public surface)
├── system/                health, readiness, network identity, provider health
├── auth/                  sessions, Sign-In With Solana challenge/verify
├── organizations/
├── users/
├── audit/
├── market-data/           (planned)
├── portfolio/             (planned)
├── trading/               (planned)
├── tokens/                (planned)
├── intelligence/          (planned)
├── alerts/                (planned)
└── server.ts              composition root (wires ports to adapters)

apps/terminal/src/
├── app/                   thin route files only (layouts, pages, loading/error boundaries)
├── wallets/               components/, hooks/, api/ (typed client), index.ts
├── network/               cluster banner, cluster verification, wallet-cluster mismatch UI
├── system/                system health and provider status views
├── auth/
└── shell/                 terminal frame: navigation, status bar, command palette (planned)

apps/worker/src/
├── system/                provider health probe jobs
├── wallets/               wallet synchronization jobs (Iteration 02+)
└── worker.ts              queue registration and composition root
```

Rules:

- Features contain only the sub-folders they need. No empty scaffolding.
- No `utils.ts`, `helpers.ts`, `common.ts`, or `misc.ts` grab-bags. Functions live in the domain they belong to. Truly cross-cutting code goes into a named package with a clear purpose.
- No god objects (`SolanaService`, `DataService`). Ports are narrow and capability-shaped.
- Backend domain code starts inside `apps/api`. It is extracted into a package only when a second consumer (usually `apps/worker`) needs it — see [ADR-0002](./docs/architecture/adr/0002-screaming-architecture-and-layering.md).

## 5. Domain boundaries

| Domain | Responsibility | On-chain / off-chain | First iteration |
| --- | --- | --- | --- |
| `network` | Cluster model, cluster verification, explorer links | Both | 01 |
| `system` | Health, readiness, provider health, capability status | Off-chain | 01 |
| `auth` | Sessions, Sign-In With Solana, CSRF | Off-chain | 01 |
| `wallets` | Wallet overview, registry, metadata, balances, history, connections | Both | 01 (overview) / 02 |
| `audit` | Immutable audit events | Off-chain | 01 |
| `organizations`, `users`, `roles` | Tenancy, membership, RBAC | Off-chain | 01 (foundation) / 08 |
| `transactions` | Transaction lifecycle state machine, simulation, reconciliation | Both | 02 |
| `portfolio` | Aggregation, valuation with price provenance, snapshots | Both | 03 |
| `market-data` | Prices, freshness, provider selection | Off-chain (external) | 03 |
| `trading` | Quotes, routes, slippage, swap execution | Both | 04 |
| `token-studio` | SPL / Token-2022 creation wizard, authority management | Both | 05 |
| `tokens` | Token metadata, authority visualization | Both | 05 |
| `intelligence` | Structured facts, derived metrics, versioned models, relationship graph | Both | 06 / 09 |
| `alerts`, `notifications` | Rule evaluation, in-app notifications | Off-chain | 07 |
| `watchlists` | User-curated sets of wallets/tokens | Off-chain | 07 |
| `social-intelligence` | Social providers where legally and technically available | Off-chain (external) | 09 |
| `developer` | Developer tooling, API credentials | Off-chain | 08+ |

Detailed entities and value objects: [docs/architecture/domain-model.md](./docs/architecture/domain-model.md).

## 6. Layering rules

| Layer | May depend on | Must not depend on |
| --- | --- | --- |
| Domain | Nothing outside the domain except small value-object libraries (e.g. `@solana/kit` address type) | React, Fastify, HTTP, Drizzle, Redis, browser APIs, specific providers |
| Application | Domain, ports (interfaces) | Concrete adapters, HTTP frameworks |
| Infrastructure | Application ports, domain, external SDKs | UI |
| HTTP / UI | Application, validation contracts | Infrastructure internals |

Enforcement (Iteration 01): ESLint `no-restricted-imports` boundaries plus a dependency-graph check (dependency-cruiser or equivalent) run in CI. Imports from `packages/testing` or any `tests/` directory are forbidden in runtime code.

## 7. Data flow

### 7.1 Read path — Wallet Overview (Iteration 01 vertical slice)

```
User connects wallet (Wallet Standard, @solana/kit-plugin-wallet)
  → terminal reads account address and wallet chain (e.g. "solana:devnet")
  → terminal compares wallet chain with app cluster (mismatch = blocking warning)
  → GET /api/v1/wallets/{address}/overview                (same-origin via Next rewrite)
  → api: validate address + cluster, authorize, create request context
  → application: GetWalletOverview use case
  → ports: SolBalanceReader, TokenAccountReader, SignatureHistoryReader
  → infrastructure: Solana RPC adapter (rate-limited, timed, retried, instrumented)
  → Devnet RPC: getBalance, getTokenAccountsByOwner (Token + Token-2022), getSignaturesForAddress
  → domain: WalletOverview with Sourced<T> values (provenance, freshness, availability)
  → response DTO validated by Zod
  → terminal renders balances, token accounts, recent signatures, freshness, explorer links
  → audit event where applicable (wallet.connected)
```

Specification: [SPEC-002](./docs/specs/SPEC-002-wallet-overview.md).

### 7.2 Write path — transactions *(planned, Iteration 02+)*

```
Intent (UI) → api: prepare (build instructions, fee payer, blockhash, expected effects)
  → api: simulate (simulateTransaction) → decoded summary → terminal review screen
  → user explicit confirmation → wallet signs in browser (non-custodial)
  → api: submit (idempotency key) → worker: monitor confirmation
  → worker: reconcile resulting on-chain state vs. expected effects → final state
```

Specification: [SPEC-004](./docs/specs/SPEC-004-transaction-lifecycle.md).

## 8. Solana integration

- **SDK:** `@solana/kit` with the official plugins (`@solana/kit-plugin-rpc`, `@solana/kit-plugin-signer`, `@solana/kit-plugin-wallet`), `@solana/react` for React bindings, and generated program clients (`@solana-program/system`, `@solana-program/token`, `@solana-program/token-2022`, `@solana-program/compute-budget`, `@solana-program/memo`). Legacy `@solana/web3.js` is not used. See [ADR-0003](./docs/architecture/adr/0003-solana-kit-as-sdk.md).
- **Cluster model:** `localnet | devnet | testnet | mainnet-beta` is a typed value carried through every request, record, job, cache key, and transaction. See [SPEC-005](./docs/specs/SPEC-005-network-safety.md).
- **Cluster verification:** at startup and periodically, the API calls `getGenesisHash` and compares it with the expected hash for the configured cluster. A mismatch makes the service not ready and blocks all Solana operations.
- **Commitment:** reads for display use `confirmed`; reconciliation and "final" transaction state use `finalized`. The commitment used is recorded in provenance.
- **Amounts:** lamports and raw token amounts are `bigint` in the domain and decimal strings in API contracts. Floating-point numbers are never used for on-chain amounts.
- **Token programs:** every token query covers both the SPL Token program and the Token-2022 program.
- **Narrow ports:** the Solana package exposes capability-shaped readers (`SolBalanceReader`, `TokenAccountReader`, `SignatureHistoryReader`, `ClusterIdentityReader`, …), not a single Solana service.
- **Explorer links:** generated by the `network` domain with the cluster query parameter; never hardcoded.

## 9. Transaction lifecycle *(planned, Iteration 02)*

Explicit state machine, never a boolean:

```
DRAFT → SIMULATING → SIMULATED → AWAITING_SIGNATURE → SIGNING → SUBMITTED → CONFIRMING → CONFIRMED → RECONCILED
Failure: SIMULATION_FAILED · SIGNING_FAILED · SUBMISSION_FAILED · EXPIRED · CONFIRMATION_FAILED · RECONCILIATION_FAILED
Divergence: RECONCILIATION_REQUIRED
```

A successful `sendTransaction` is never treated as proof that the business operation completed. Details: [SPEC-004](./docs/specs/SPEC-004-transaction-lifecycle.md).

## 10. Provider architecture

- **Ports** (owned by the consuming domain): `BlockchainDataProvider` capabilities, `MarketDataProvider`, `TokenMetadataProvider`, `TokenDiscoveryProvider`, `DexProvider`, `SocialDataProvider`.
- **Adapters** (infrastructure): `SolanaRpcAdapter`, `JupiterAdapter`, `OrcaWhirlpoolsAdapter`, `DexScreenerAdapter`, `HeliusAdapter`, …
- **Provider client wrapper:** every outbound call goes through one wrapper that applies timeout, retry with exponential backoff and jitter, a concurrency limit, a provider-specific distributed rate limiter (Redis), response schema validation (Zod), latency measurement, health recording, and credential redaction.
- **Provider registry:** a typed configuration of each provider (id, network(s), base URL, auth mode, budget, capabilities). Enabling or disabling a provider is a configuration change and an audited action.
- **Capability status:** each product capability (e.g. `market-data.price`, `social.x`) exposes `AVAILABLE | DEGRADED | UNAVAILABLE | DISABLED` with a reason. The UI renders unavailable capabilities explicitly.
- **Fallback:** only between providers that deliver the same metric for the same network; the fallback is recorded in provenance.

Details: [SPEC-006](./docs/specs/SPEC-006-provider-health.md) and [DATA_SOURCES.md](./DATA_SOURCES.md).

## 11. Data provenance and availability

Every externally sourced value is wrapped in a `Sourced<T>` envelope with `status` (`AVAILABLE | STALE | UNAVAILABLE`), `value`, and `provenance` (`source`, `sourceType`, `endpoint` (redacted), `network`, `retrievedAt`, `observedAt`, `requestId`, `dataVersion`, `confidence`, and optionally `provider`, `providerVersion`, `latencyMs`, `responseStatus`, `commitment`, `slot`). Unavailable values carry a reason, the last successful retrieval, and retry state.

Source-of-truth hierarchy when data conflicts: blockchain state → authoritative protocol/API source → verified provider → indexed application data → cached data. Conflicts are surfaced, never hidden.

Specification: [SPEC-003](./docs/specs/SPEC-003-data-provenance.md).

## 12. Database architecture

- PostgreSQL with Drizzle ORM; migrations are generated, reviewed, and committed in `packages/database/migrations`.
- Relational modeling with foreign keys, indexes, constraints, `created_at`/`updated_at`, and explicit enums. JSON only for provider payload snapshots, extensible metadata, raw external data, and versioned configuration.
- Every row that relates to chain data carries `cluster`.
- On-chain authoritative facts are never overwritten by application metadata.
- Multi-organization from day one: tenant-scoped tables carry `organization_id`.

Details: [docs/architecture/database.md](./docs/architecture/database.md).

## 13. Job architecture

- BullMQ on Redis. Queues are named by domain: `system.provider-health`, `wallets.sync` (02), `transactions.confirmation` (02), `transactions.reconciliation` (02), `market-data.refresh` (03), `alerts.evaluate` (07), `notifications.dispatch` (07).
- Every job has an idempotent handler, a deterministic job id where duplicates are possible, bounded retries with exponential backoff, and a dead-letter policy.
- Scheduled jobs use repeatable jobs with intervals derived from the provider budget in `DATA_SOURCES.md`. No tight polling loops.
- Job state relevant to users (e.g. indexing progress) is persisted in PostgreSQL and exposed via the API.

## 14. Caching

- Redis for short-lived external data. Every cached record stores `retrievedAt`, `expiresAt`, and `source`; the cache key includes the cluster.
- A cache hit is presented with its original `retrievedAt`, never as fresh data.
- Financial data shows freshness ("Updated 12 s ago" / "Stale — last update 4 m 17 s ago").

## 15. Security model (summary)

Non-custodial signing in the browser; the API never receives private keys. Server-side authorization on every protected operation using explicit permissions. Audit events for every sensitive action. External data is untrusted. Full details: [SECURITY.md](./SECURITY.md).

## 16. Observability

- `pino` structured JSON logs with `requestId`, `traceId`, `organizationId`, `userId`, `feature`, `operation`, `durationMs`, `result`. Secret redaction is configured centrally.
- OpenTelemetry-compatible tracing and metrics (OTLP exporter optional; disabled when no collector is configured).
- Metrics: RPC latency/failures by method, provider failures and rate-limit events, simulation and submission failures, queue failures and backlog, database latency, API latency by route.

## 17. Frontend architecture

- Next.js App Router. Server Components for read views where no wallet interaction is needed. Client Components for wallet connection, signing, and live-updating data.
- TanStack Query for server state in client components. Local UI state stays local. No global client store unless a real need appears.
- The browser calls the API on the same origin (`/api/v1/*` rewritten by Next.js to `apps/api`), which keeps cookies `SameSite=Strict` and avoids CORS.
- API contracts are imported from `packages/validation`; responses are validated at runtime.
- Every data view implements loading, empty, error, stale, and unavailable states. See [docs/design/ui-guidelines.md](./docs/design/ui-guidelines.md).
- A persistent **SOLANA DEVNET** network indicator is always visible.

## 18. AI layer *(planned, Iteration 09)*

Optional. The core platform works without it. Pipeline: external sources → validation → normalization → domain model → derived metrics → AI context builder (external content delimited as untrusted) → AI analysis → structured output (`summary`, `observations[]`, `derived_metrics[]`, `risks[]`, `unknowns[]`, `evidence[]`, `confidence`, `model_version`, `generated_at`) → evidence references. Outputs classify every statement as Observed, Derived, Inference, Hypothesis, or Unknown.

## 19. Path to Mainnet *(not in MVP scope)*

Mainnet requires: production RPC with SLAs, separate credentials, database, encryption keys, wallet infrastructure and monitoring, a transaction policy engine, institutional signing (`@solana/keychain` backends: KMS/HSM/MPC/multisig), incident response, backups, and a documented readiness review. See [OPERATIONS.md](./OPERATIONS.md#mainnet-readiness-gate). The configuration layer rejects `mainnet-beta` in the MVP.

## 20. Architecture Decision Records

| ADR | Title | Status |
| --- | --- | --- |
| [0001](./docs/architecture/adr/0001-monorepo-pnpm-turborepo.md) | Monorepo with pnpm and Turborepo | Accepted |
| [0002](./docs/architecture/adr/0002-screaming-architecture-and-layering.md) | Screaming architecture and layering | Accepted |
| [0003](./docs/architecture/adr/0003-solana-kit-as-sdk.md) | `@solana/kit` as the Solana SDK | Accepted |
| [0004](./docs/architecture/adr/0004-non-custodial-signing-first.md) | Non-custodial signing first; keychain boundary | Accepted |
| [0005](./docs/architecture/adr/0005-authentication.md) | Authentication: Sign-In With Solana + server sessions | Accepted |
| [0006](./docs/architecture/adr/0006-postgresql-drizzle-supabase.md) | PostgreSQL, Drizzle, Supabase hosting | Accepted |
| [0007](./docs/architecture/adr/0007-redis-bullmq-jobs.md) | Redis and BullMQ for cache, rate limits, and jobs | Accepted |
| [0008](./docs/architecture/adr/0008-devnet-dex-strategy.md) | Devnet DEX strategy (Jupiter is Mainnet-only) | Proposed |
| [0009](./docs/architecture/adr/0009-devnet-valuation-policy.md) | Valuation policy for Devnet assets | Proposed |

## 21. Known architecture risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Public Devnet RPC is rate-limited (100 req/10 s per IP, 40 req/10 s per method) | Wallet overview failures under load | Distributed rate limiter, caching with provenance, optional keyed fallback RPC, explicit `RPC_RATE_LIMITED` state |
| Jupiter, DexScreener, pump.fun and most market/social data are Mainnet-only | DEX, valuation, and intelligence features have no Devnet data | ADR-0008 (Orca Whirlpools on Devnet), ADR-0009 (explicit valuation policy), capability status `UNAVAILABLE` on Devnet |
| TypeScript 7 (native compiler) is the current stable major | Tooling incompatibility (Next.js, ESLint, Drizzle Kit) | Resolved in Iteration 01: pinned TypeScript 6.0.3; re-evaluate when typescript-eslint supports 7.x |
| Kit plugin packages are pre-1.0 (`0.x`) | Breaking changes between minors | Exact pins via lockfile, thin wrappers in `packages/solana`, upgrade notes in changelog |
| Solana CLI / `solana-test-validator` is not native on Windows | Localnet tests harder on Windows dev machines | Run the validator in WSL2 or Docker; Devnet remains the default |
| X/Twitter and pump.fun lack free official read APIs | Social and new-token features may be unavailable | Capability status `UNAVAILABLE`; on-chain decoding of public program IDLs where possible |
