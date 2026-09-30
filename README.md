# Solana Corporate Terminal

A corporate-grade operations, trading, and intelligence terminal for the Solana blockchain.

The MVP targets **Solana Devnet only**. No real-money Mainnet operation is permitted during the MVP phase. The architecture is designed so that Mainnet can be introduced later through configuration and controlled infrastructure changes, never through a rewrite and never through a single environment variable.

> **Project status:** Specification baseline complete (Iteration 00). No application code exists yet.
> **Next:** Iteration 01 — Foundation and Wallet Overview vertical slice. See [checklist.md](./checklist.md).

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
│   ├── database/        Drizzle schema, migrations, repositories' shared DB client
│   ├── solana/          @solana/kit integration: cluster model, RPC adapters, address rules
│   ├── validation/      Zod API contracts shared by terminal and api
│   ├── config/          Runtime environment schemas and cluster configuration
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

> These commands become valid once Iteration 01 is complete. Until then they describe the target developer experience.

Prerequisites (see [OPERATIONS.md](./OPERATIONS.md#tooling-versions)):

- Node.js 24 LTS
- pnpm (exact version pinned through the `packageManager` field in `package.json`)
- Docker (for local PostgreSQL and Redis)
- A Wallet Standard compatible browser wallet configured for **Devnet**

```bash
pnpm install
cp .env.example .env              # then fill in local values; never commit .env
pnpm infra:up                     # starts local PostgreSQL and Redis via Docker Compose
pnpm db:migrate                   # applies committed migrations
pnpm dev                          # runs terminal, api, and worker through Turborepo
```

Quality gates:

```bash
pnpm lint
pnpm typecheck
pnpm test                         # unit + integration
pnpm test:e2e                     # Playwright end-to-end
pnpm test:devnet                  # opt-in tests against the real Devnet RPC
pnpm build
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
