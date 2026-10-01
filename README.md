# Solana Corporate Terminal

A corporate-grade operations, trading, and intelligence terminal for the Solana blockchain.

The MVP targets **Solana Devnet only**. No real-money Mainnet operation is permitted during the MVP phase. The architecture is designed so that Mainnet can be introduced later through configuration and controlled infrastructure changes, never through a rewrite and never through a single environment variable.

> **Project status:** Iteration 01 (Foundation and Wallet Overview vertical slice) is implemented and tested against the real Devnet RPC. It awaits two verifications: a manual run with a real browser wallet and the first CI run on GitHub. See [checklist.md](./checklist.md).

---

## Non-negotiable principles

1. **Real data only.** No mock balances, prices, holders, volume, social metrics, or transactions in any runtime path. When data cannot be obtained, the product shows `DATA UNAVAILABLE` with a reason, a source, the last successful retrieval, and the retry state.
2. **Provenance on every external data point.** Every financial number shown to a user is traceable to a source, an endpoint, a network, and a timestamp.
3. **Devnet first, Mainnet impossible by accident.** The cluster is a first-class concept, verified at startup against the RPC genesis hash.
4. **The backend is the source of truth for business rules and authorization.** Frontend permission checks are UX; backend checks are security.
5. **Spec-first, spec-anchored.** Specifications in [`docs/specs/`](./docs/specs/) define intended behavior. Code, tests, and documentation are kept in sync with them.
6. **Plain and correct beats beautiful and fake.** Visual sophistication grows only as the underlying engineering grows.

## Target repository layout

```
/
├── apps/
│   ├── terminal/        Next.js App Router terminal UI (feature-oriented)
│   ├── api/             Fastify backend: auth, authorization, domains, providers, audit
│   └── worker/          BullMQ workers: sync, indexing, provider health, alerts
├── packages/
│   ├── ui/              Accessible terminal-grade UI primitives (Radix-based)
│   ├── database/        Drizzle schema, migrations, seed, shared DB client
│   ├── network/         Pure cluster model: clusters, genesis hashes, wallet chains, explorer links
│   ├── providers/       Outbound provider pipeline: budgets, retries, health, provenance builders
│   ├── solana/          @solana/kit integration: RPC client and narrow on-chain readers
│   ├── validation/      Zod API contracts shared by terminal and api
│   ├── config/          Runtime environment schemas
│   ├── observability/   Structured logging, request context, OpenTelemetry setup
│   └── testing/         Test-only helpers and fixtures (never imported by runtime code)
├── docs/                Specifications, ADRs, domain model, threat model, UI guidelines
├── infra/               Docker Compose for local PostgreSQL/Redis, future deployment config
├── scripts/             Developer and operational scripts
├── tests/               Cross-app end-to-end and Devnet integration tests
└── *.md                 Persistent project state (see below)
```

Inside each application, code is organized by **business domain** (`wallets/`, `portfolio/`, `trading/`, `tokens/`, …), not by technical category. See [ARCHITECTURE.md](./ARCHITECTURE.md).

## Persistent project state

These files are read before any substantial change and updated after it.

| File | Purpose |
| --- | --- |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture, domain boundaries, data flow, Solana integration, ADR index |
| [SECURITY.md](./SECURITY.md) | Key management, signing, authorization, audit, threat model, external data trust |
| [DATA_SOURCES.md](./DATA_SOURCES.md) | Every external provider: URL, limits, auth, reliability, fallback, last verified |
| [API.md](./API.md) | API conventions, error format, error codes, endpoint catalog |
| [TESTING.md](./TESTING.md) | Test layers, tools, fixture policy, Devnet test policy |
| [OPERATIONS.md](./OPERATIONS.md) | Environments, environment variables, local setup, runbooks, Mainnet readiness gate |
| [checklist.md](./checklist.md) | Canonical implementation roadmap, newest iteration first |
| [changelog.md](./changelog.md) | All functional changes |
| [docs/](./docs/README.md) | Specifications, ADRs, domain model, database design, threat model, UI guidelines |
| [CLAUDE.md](./CLAUDE.md) | Operating rules for AI coding agents working in this repository |
| [prompt.md](./prompt.md) | Original master engineering brief (the product charter) |

## Getting started

Prerequisites (see [OPERATIONS.md](./OPERATIONS.md#2-tooling-versions)):

- Node.js 24 LTS
- pnpm (exact version pinned through the `packageManager` field in `package.json`)
- Docker Desktop running (for local PostgreSQL and Redis)
- A Wallet Standard compatible browser wallet (e.g. Phantom, Solflare, Backpack) switched to **Devnet**

```bash
pnpm install
cp .env.example .env              # set AUTH_SECRET (openssl rand -base64 32) and BOOTSTRAP_OWNER_WALLET_ADDRESS
pnpm infra:up                     # starts local PostgreSQL 18 and Redis 8 via Docker Compose
pnpm db:migrate                   # applies committed migrations (migration role)
pnpm db:seed                      # permission catalog, system roles, default organization
pnpm dev                          # terminal :3000, api :4000, worker
```

Open http://localhost:3000, connect your Devnet wallet, and sign in. The wallet set in `BOOTSTRAP_OWNER_WALLET_ADDRESS` becomes owner of the default organization on its first sign-in; other wallets can sign in but see no data until they are granted a role (organization management UI arrives in Iteration 08).

Quality gates:

```bash
pnpm format:check
pnpm lint                         # ESLint + architecture boundaries (dependency-cruiser)
pnpm typecheck
pnpm test                         # unit + integration (needs `pnpm infra:up`)
pnpm test:devnet                  # opt-in tests against the real Devnet RPC
pnpm test:e2e                     # builds the terminal, then Playwright (stop `pnpm dev` first)
pnpm build && pnpm check:bundle   # production build and test-code leak check
```

## Development workflow

Every substantial change follows the spec-first loop:

1. Read the persistent project state files listed above.
2. Locate or write the specification in `docs/specs/` with numbered acceptance criteria.
3. Identify the affected domain, dependencies, security implications, and external data dependencies.
4. Open (or continue) the iteration at the top of `checklist.md`.
5. Implement in vertical slices: UI → application → domain → infrastructure → external system → real data.
6. Test against the acceptance criteria (test names reference acceptance criterion IDs).
7. Update documentation, `changelog.md`, and `checklist.md`.

A feature is done only when it meets the [Definition of Done](./docs/specs/README.md#definition-of-done).

## Language policy

All code, comments, documentation, UI copy, logs, error messages, and commit messages in this repository are written in **American English**.

## License

To be determined.
