# SPEC-003 — Data Provenance and Availability

| Field | Value |
| --- | --- |
| Status | READY |
| Iteration | 01 |
| Domain(s) | cross-cutting (`packages/validation` contracts, domain value objects) |
| Criteria prefix | `PRV` |
| Related | SPEC-002, SPEC-006, DATA_SOURCES.md, API.md §2 |

## 1. Problem and goal

Every financial or on-chain number shown to a user must be traceable to a source, and missing data must never be disguised. This spec defines the `Sourced<T>` envelope, availability states, freshness, and the no-fake-data rules.

## 2. Model

```ts
type Availability = "AVAILABLE" | "STALE" | "UNAVAILABLE";

type Confidence =
  | "AUTHORITATIVE"      // read directly from the chain via RPC
  | "PROVIDER_REPORTED"  // third-party provider value (e.g. market price)
  | "DERIVED"            // computed by this system from other sourced values
  | "CACHED";            // served from cache; original provenance preserved

interface Provenance {
  source: string;              // stable source id, e.g. "solana-rpc-devnet"
  sourceType: "rpc" | "rest" | "websocket" | "sdk-onchain" | "derived";
  provider: string;            // provider registry id
  providerVersion?: string;    // e.g. solana-core version, API version
  endpoint: string;            // redacted: no credentials, no query-string keys
  method?: string;             // e.g. "getBalance"
  network: Cluster;
  commitment?: "processed" | "confirmed" | "finalized";
  slot?: string;               // context slot as decimal string
  retrievedAt: string;         // when this system received the data
  observedAt: string | null;   // when the fact was true on-chain / at provider, if known
  requestId: string;
  dataVersion: string;         // contract version of the normalized shape
  confidence: Confidence;
  latencyMs?: number;
  responseStatus?: number;
  fallbackUsed: boolean;
  derivedFrom?: Provenance[];  // for DERIVED values
}

interface UnavailableInfo {
  reason: UnavailableReason;   // e.g. RPC_UNAVAILABLE, RPC_TIMEOUT, RPC_RATE_LIMITED,
                               // RPC_INVALID_RESPONSE, PROVIDER_UNAVAILABLE,
                               // PROVIDER_NOT_CONFIGURED, NOT_SUPPORTED_ON_NETWORK,
                               // CLUSTER_UNVERIFIED
  message: string;
  source: string;
  lastSuccessfulRetrievalAt: string | null;
  retry: { retryable: boolean; retryAfterMs?: number; attempts: number };
}

type Sourced<T> =
  | { status: "AVAILABLE"; value: T; provenance: Provenance }
  | { status: "STALE"; value: T; provenance: Provenance; staleSince: string }
  | { status: "UNAVAILABLE"; value: null; provenance: null; unavailable: UnavailableInfo };
```

## 3. Rules

1. A value from an external system enters the domain only inside `Sourced<T>`.
2. `UNAVAILABLE` has `value: null`. There is no default, placeholder, zero, or estimated value.
3. A previously retrieved value may be shown only as `STALE` (with its original `retrievedAt`) and only when the consuming spec defines a staleness threshold.
4. A cache hit returns the original provenance with `confidence: "CACHED"` preserved alongside the original source; `retrievedAt` is never rewritten.
5. Fallback providers may only substitute the **same metric for the same network**, and set `fallbackUsed: true`.
6. A metric is never silently substituted by a different metric (e.g. last trade price for mid price).
7. Derived values carry `derivedFrom` with the provenance of every input; if any required input is unavailable, the derived value is unavailable.
8. Endpoints are redacted before storage or display.
9. Values from different networks are never combined into one aggregate.
10. Every staleness threshold is defined per metric in its spec (Wallet Overview: 60 s).

## 4. UI requirements

- A reusable `SourcedValue` presentation primitive renders the value, a freshness label, and a provenance detail (popover/panel, keyboard accessible).
- A reusable `DataUnavailable` primitive renders: the literal heading `DATA UNAVAILABLE`, reason, source, last successful retrieval ("Never" if null), retry state, and a Retry action when retryable.
- Stale values use the warning semantic color and the text "Stale — last update {duration} ago".

## 5. Acceptance criteria

### PRV-AC-01 — Envelope completeness
Given any API response field carrying external data
When it is validated against the contract
Then it is a `Sourced<T>` with the required provenance fields populated for `AVAILABLE`/`STALE` and `unavailable` populated for `UNAVAILABLE`.

### PRV-AC-02 — No fabricated fallback
Given a provider failure with no same-metric fallback
When the value is requested
Then the result is `UNAVAILABLE` with `value: null`, and no code path returns zero, a default, or a previously cached value presented as fresh.

### PRV-AC-03 — Cache preserves provenance
Given a value served from cache
When it is returned
Then its `retrievedAt` equals the original retrieval time.

### PRV-AC-04 — Fallback is recorded
Given the primary provider fails and a configured fallback provides the same metric for the same network
When the value is returned
Then `fallbackUsed` is `true` and `provider` names the fallback.

### PRV-AC-05 — Redaction
Given a provider endpoint containing an API key in the query string or path
When provenance is built
Then the stored and returned `endpoint` contains no key material.

### PRV-AC-06 — Derived value dependency
Given a derived value with one unavailable input
When it is computed
Then the derived value is `UNAVAILABLE` with reason referencing the missing input.

### PRV-AC-07 — Unavailable UI
Given an `UNAVAILABLE` value
When it is rendered
Then the UI shows `DATA UNAVAILABLE`, the reason, the source, the last successful retrieval, and the retry state.

## 6. Test plan

Unit tests for the builder functions, redaction, derived-value propagation, and contract schemas; component tests for `SourcedValue` and `DataUnavailable`; a lint rule or code review checklist item forbidding numeric literals as fallbacks in adapters.

## Amendments

_None._
