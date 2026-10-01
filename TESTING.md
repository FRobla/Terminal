# Testing

Status: **Baseline (Iteration 00).** Testing strategy and conventions. Tooling is installed in Iteration 01.

---

## 1. Principles

- Tests verify **specifications**. Each acceptance criterion has a stable ID (e.g. `WO-AC-03`) and at least one test that references it in its name.
- Do not rely exclusively on mocked blockchain responses. Adapters are verified against real Devnet or a local validator.
- Mock data exists **only** in `tests/`, `**/*.test.ts`, `**/__fixtures__/`, or `packages/testing`. Runtime code may never import them (enforced by lint and dependency checks).
- Failure paths are first-class: RPC down, rate-limited, malformed responses, wallet disconnected, cluster mismatch.

## 2. Test layers

| Layer | Scope | Tooling | Location | Runs in CI |
| --- | --- | --- | --- | --- |
| Unit | Domain rules, calculations, parsers, validation schemas, permission logic, state machines | Vitest | Next to source: `*.test.ts` | Every push |
| Integration | PostgreSQL repositories and migrations, Redis rate limiter, BullMQ workers, Fastify routes (`inject`), provider adapters with recorded HTTP fixtures | Vitest + Docker services (PostgreSQL, Redis) | `apps/*/src/**/*.integration.test.ts` | Every push |
| Contract | Zod contracts shared by terminal and API; generated OpenAPI snapshot | Vitest | `packages/validation` | Every push |
| Blockchain (localnet) | Transaction builders, token creation, simulation, reconciliation | `solana-test-validator` (WSL2/Docker) or LiteSVM where compatible | `tests/localnet/` | From Iteration 02 |
| Blockchain (Devnet) | Real RPC adapters, cluster verification, wallet overview against real accounts | Vitest, tag `@devnet` | `tests/devnet/` | Nightly + manual; opt-in locally |
| End-to-end | Login, wallet connection, wallet overview, empty/error states, authorization | Playwright | `tests/e2e/` | Every PR |
| Accessibility | Automated axe checks on key views; keyboard navigation flows | Playwright + axe-core | `tests/e2e/` | Every PR |
| Security | Secret redaction in logs, headers/CSP presence, authorization matrix (every route × role) | Vitest / Playwright | `apps/api/src/**/security.test.ts` | Every push |

## 3. Commands

```bash
pnpm test                # unit + integration (Vitest projects)
pnpm test:unit
pnpm test:integration    # requires `pnpm infra:up`; rebuilds the solana_terminal_test database
pnpm test:devnet         # opt-in; hits https://api.devnet.solana.com
pnpm test:e2e            # builds the terminal, then Playwright starts API + terminal on 4000/3000
pnpm check:bundle        # after a build: no test-only code in the terminal bundle
pnpm coverage
```

`pnpm test:localnet` arrives with Iteration 02.

### As-built layout (Iteration 01)

- Unit tests sit next to the code (`*.test.ts`). Integration tests sit next to the code as `*.integration.test.ts`; the API harness is `apps/api/test/harness.ts` (real PostgreSQL and Redis, stub JSON-RPC server for failure modes).
- Devnet tests live in `tests/devnet/`. A public-RPC `429` makes a test **skip with an explicit reason** ("SKIPPED: public Devnet RPC rate limited"); it never passes silently.
- End-to-end tests live in `tests/e2e/`. `tests/e2e/support.ts` injects the test wallet and grants roles directly in the test database (there is no admin UI until Iteration 08). UI rendering of provider failures uses test-only response interception; the API behavior for those failures is covered by integration tests.
- Contract coverage: API responses are validated by the same Zod schemas the terminal uses, and `/api/v1/openapi.json` is generated from them (integration test).

## 4. Coverage targets

| Area | Target |
| --- | --- |
| Domain and application layers | ≥ 90% lines and branches |
| Infrastructure adapters | Every success path and every documented failure mode covered |
| HTTP routes | Every route: success, validation failure, unauthenticated, forbidden |
| UI | Every data view: loading, empty, error, unavailable, stale states |

Coverage is a guide, not a goal; a missing failure-mode test is a defect even at 100% coverage.

## 5. Fixtures and recorded responses

- Recorded provider responses are stored under `__fixtures__/` next to the adapter test, with a header comment recording provider, endpoint, network, and capture date.
- Recorded fixtures are refreshed when a provider's schema changes; the Devnet test suite detects drift.
- Fixtures must not contain real API keys or private keys. Test keypairs are generated per run.

## 6. Devnet test policy

- Devnet tests are opt-in (`RUN_DEVNET_TESTS=true`) and tagged `@devnet`.
- They respect the internal RPC budget; they run sequentially with a small concurrency limit.
- Read-only tests use well-known public Devnet accounts (e.g. program ids and the SOL/devUSDC test pool) and accounts created by the test itself.
- Write tests (Iteration 02+) use a dedicated, disposable test keypair funded from the official faucet (`https://faucet.solana.com`) or `requestAirdrop`; airdrops are rate-limited and may fail — tests must report `SKIPPED: faucet unavailable` rather than silently pass.
- Test keypairs are never reused for anything else and never committed.

## 7. End-to-end wallet strategy

- Browser extensions are not automated. Instead, a **test-only Wallet Standard wallet** in `packages/testing` registers itself in the page during Playwright runs, backed by a per-run keypair.
- The test wallet is injected by Playwright (`page.addInitScript`) only; production bundles do not include it (verified by a build check that searches the production output for its identifier).
- E2E runs against the real Devnet RPC for the wallet overview happy path (tagged `@devnet`), and against a stubbed RPC server only for failure-mode scenarios (rate limit, timeout, malformed response).

## 8. Naming convention

```
describe("GetWalletOverview", () => {
  it("WO-AC-04: returns token accounts from both SPL Token and Token-2022 programs", …)
})
```

## 9. CI gates (Iteration 01)

A pull request can merge only when: lint, typecheck, unit, integration, contract, and e2e suites pass; the dependency-boundary check passes; `pnpm audit` has no high/critical findings without a documented exception; and the build succeeds.
