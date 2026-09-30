# SPEC-006 — Provider Health and Capability Status

| Field | Value |
| --- | --- |
| Status | READY (Iteration 01 covers the Solana RPC provider) |
| Iteration | 01 |
| Domain(s) | `system` |
| Criteria prefix | `PH` |
| Related | SPEC-003, DATA_SOURCES.md §5, ARCHITECTURE.md §10 |

## 1. Problem and goal

External providers fail, throttle, and change. The system must know the health of each provider, degrade gracefully, and make stale or unavailable data obvious.

## 2. Model

| Field | Description |
| --- | --- |
| `providerId` | Registry id (e.g. `solana-public-rpc`) |
| `network` | Cluster the provider serves |
| `status` | `HEALTHY`, `DEGRADED`, `RATE_LIMITED`, `UNAVAILABLE`, `DISABLED`, `UNKNOWN` |
| `latencyMs` | p50 and p95 over the last 5 minutes |
| `lastSuccessAt` | Last successful request |
| `lastFailureAt`, `lastFailureReason` | Last failure (reason classified, message redacted) |
| `errorRate` | Failures / requests over the last 5 minutes |
| `rateLimitState` | Remaining budget, reset time, last 429 |
| `checkedAt` | Last evaluation time |

Capability status (`capabilityId`, `status: AVAILABLE | DEGRADED | UNAVAILABLE | DISABLED`, `reason`, `providers[]`) is derived from provider health and configuration, e.g. `wallets.overview`, `market-data.price`, `social.x`.

## 3. Status rules

| Status | Condition |
| --- | --- |
| `UNKNOWN` | No requests or probes yet |
| `HEALTHY` | Error rate < 5% and p95 latency below provider threshold (RPC: 2,000 ms) |
| `DEGRADED` | Error rate 5–25% or p95 above threshold |
| `RATE_LIMITED` | 429 received or internal budget exhausted within the last window |
| `UNAVAILABLE` | Error rate > 25%, 3 consecutive probe failures, or failed cluster verification |
| `DISABLED` | Disabled by configuration or by an administrator (audited) |

Health is updated by (a) every real call through the provider wrapper and (b) a `system.provider-health` probe job (RPC: `getSlot` every 60 s, `getGenesisHash` every 5 min), both within budget. Health is kept in Redis (live) and snapshotted to `provider_health_checks` in PostgreSQL once per minute for history.

## 4. Acceptance criteria

### PH-AC-01 — Health reflects real calls
Given a sequence of RPC calls with injected failures
When the error rate crosses the thresholds
Then the status transitions `HEALTHY → DEGRADED → UNAVAILABLE` and recovers to `HEALTHY` after successful calls.

### PH-AC-02 — Rate limiting detected
Given the RPC returns 429 or the internal token bucket is exhausted
When health is read
Then the status is `RATE_LIMITED` with the reset time.

### PH-AC-03 — Probe job respects budget
Given the worker is running
When the probe job executes
Then it performs no more than the configured probe calls per interval and never runs concurrently with itself.

### PH-AC-04 — Health endpoint
Given a user with `system.read`
When `GET /api/v1/system/providers` is called
Then each provider returns status, latency p50/p95, last success, last failure (redacted), error rate, and rate-limit state.

### PH-AC-05 — Visible in the terminal
Given any provider is not `HEALTHY`
When the user views the terminal
Then the status bar shows a provider health indicator with the affected provider(s), linking to the system health view.

### PH-AC-06 — Capability unavailable is explicit
Given a capability whose providers are all unavailable, disabled, or not configured
When a feature depending on it renders
Then it shows `Provider unavailable` with the reason, not a fabricated or empty-but-successful state.

## Amendments

_None._
