# SPEC-006 — Provider Health and Capability Status

| Field | Value |
| --- | --- |
| Status | IMPLEMENTED (Solana RPC provider) |
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

- **2026-09-30 (Iteration 01) — Small-sample rule:** error-rate thresholds apply only once the 5-minute window has at least 5 requests. Below that, 3 consecutive failures mean `UNAVAILABLE` and 1–2 consecutive failures mean `DEGRADED`. A provider with no requests in the window but a known last success or failure is `HEALTHY` unless another rule applies. Rationale: one failed call must not flip a lightly used provider to `UNAVAILABLE`.
- **2026-09-30:** a `429` or an exhausted internal budget keeps the provider `RATE_LIMITED` for 60 s, or until the reported reset time.
- **2026-10-01 (Iteration 02) — Fallback RPC provider.** `SOLANA_RPC_FALLBACK_URL`, parsed since Iteration 01, is now used. Added criteria PH-AC-07..09.
  - When set, the API and the worker register a second RPC provider, `solana-fallback-rpc` ("Solana fallback RPC"). It has its own descriptor, budget, health record, and provider-health snapshots; its endpoint is redacted wherever it appears.
  - A call goes to the primary first. When the primary call fails after its own retries with `UNAVAILABLE`, `TIMEOUT`, `RATE_LIMITED`, or `INVALID_RESPONSE`, the same call is attempted once through the fallback pipeline. The fallback is never used when the primary answered with a JSON-RPC error (the node understood and rejected the request, e.g. invalid parameters or a failed preflight): that answer is definitive. When both fail, the primary's classified error is reported.
  - A value served by the fallback carries `provider: "solana-fallback-rpc"` and `fallbackUsed: true` in its provenance.
  - The fallback's cluster is verified by genesis hash at startup and every 5 minutes, exactly like the primary. An unverified or mismatched fallback is never used; a mismatch reports `UNAVAILABLE` with the verification failure reason (the existing rule for failed cluster verification, §3) and is logged as a critical incident when it serves Mainnet.
  - Transaction sends may use the fallback, because re-sending the same signed transaction cannot create a second transfer (same signature).

  ### PH-AC-07 — Failover
  Given a configured and verified fallback RPC
  When the primary fails a call with a failover-eligible error after its retries
  Then the call is served by the fallback, the value's provenance has `fallbackUsed: true` and the fallback provider id, and both providers' health record the outcome.

  ### PH-AC-08 — Unverified fallback is never used
  Given a fallback RPC whose genesis hash does not match the configured cluster (or cannot be verified)
  When the primary fails
  Then the fallback is not called, a mismatch is reported as `UNAVAILABLE` with the verification failure reason, and the primary's error is returned.

  ### PH-AC-09 — Visible fallback health
  Given a configured fallback
  When provider health is listed (`/system/providers`, owner console)
  Then the fallback appears with its own status, latency, and redacted endpoint; without a fallback configured, nothing changes.
