# SPEC-005 — Network Safety

| Field | Value |
| --- | --- |
| Status | IMPLEMENTED |
| Iteration | 01 |
| Domain(s) | `network`, `system` |
| Criteria prefix | `NET` |
| Related | SECURITY.md §4, DATA_SOURCES.md §4.1–4.2, OPERATIONS.md §10 |

## 1. Problem and goal

Make it impossible to accidentally operate against the wrong Solana cluster — above all, Mainnet — and make the active network unmistakable to users.

## 2. Model

```ts
type Cluster = "localnet" | "devnet" | "testnet" | "mainnet-beta";

const KNOWN_GENESIS_HASHES = {
  devnet:        "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  testnet:       "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
  "mainnet-beta": "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
} as const; // verified live 2026-09-30; localnet uses SOLANA_EXPECTED_GENESIS_HASH

const WALLET_STANDARD_CHAINS = {
  devnet: "solana:devnet",
  testnet: "solana:testnet",
  "mainnet-beta": "solana:mainnet",
  localnet: "solana:localnet",
} as const; // confirm against @solana/kit-plugin-wallet during Iteration 01 pre-flight
```

## 3. Rules

1. `SOLANA_CLUSTER` is required; there is no implicit default in code (the `.env.example` default is `devnet`).
2. The MVP configuration schema **rejects `mainnet-beta`** with the message: "Mainnet is not permitted in this release. See OPERATIONS.md — Mainnet readiness gate."
3. `NEXT_PUBLIC_SOLANA_CLUSTER` must equal `SOLANA_CLUSTER`; the terminal compares its build-time value with `/api/v1/system/network` at runtime and blocks blockchain features on mismatch.
4. At startup, and every 5 minutes, the API and worker call `getGenesisHash` and compare with the expected hash. On mismatch, Solana operations are disabled, readiness fails, provider health is `UNAVAILABLE`, and a critical log is emitted. There is no override flag.
5. A known Mainnet genesis hash observed while configured for any other cluster is treated as a critical incident.
6. Every Solana-related record, cache key, job payload, and API response carries `cluster`.
7. The wallet's account must support the Wallet Standard chain for the configured cluster before any signing request.
8. The terminal permanently shows a network indicator: `SOLANA DEVNET` (high-contrast, non-dismissible, present in every layout including mobile).

## 4. Acceptance criteria

### NET-AC-01 — Mainnet rejected by configuration
Given `SOLANA_CLUSTER=mainnet-beta`
When the api, worker, or terminal starts
Then startup fails with the "Mainnet is not permitted in this release" message.

### NET-AC-02 — Genesis verification
Given `SOLANA_CLUSTER=devnet` and `SOLANA_RPC_URL` pointing to a Devnet RPC
When the API starts
Then `GET /api/v1/system/network` reports `verified: true`, `observedGenesisHash` equal to the Devnet hash, and `verifiedAt`.

### NET-AC-03 — Wrong RPC blocked
Given `SOLANA_CLUSTER=devnet` and an RPC that returns a different genesis hash
When the API starts or re-verifies
Then Solana-dependent endpoints return `503 CLUSTER_VERIFICATION_FAILED`, readiness is `503`, and the terminal shows the cluster-unverified banner.

### NET-AC-04 — Terminal/API cluster agreement
Given the terminal was built with a different `NEXT_PUBLIC_SOLANA_CLUSTER` than the API cluster
When the terminal loads
Then blockchain features are disabled and a configuration error is displayed.

### NET-AC-05 — Persistent indicator
Given any terminal view at any viewport width
When it renders
Then the text `SOLANA DEVNET` is visible without interaction and exposed to assistive technology.

### NET-AC-06 — Wallet chain check
Given a connected wallet account that does not support `solana:devnet`
When any signing flow is attempted
Then it is blocked with `CLUSTER_MISMATCH` (see WO-AC-15).

### NET-AC-07 — Explorer links carry cluster
Given any explorer link
When it is generated
Then it includes `cluster=devnet` (and never omits the parameter for non-Mainnet clusters).

## 5. Test plan

Unit (config schema, explorer links, genesis comparison), integration (stub RPC returning wrong hash), Devnet (`@devnet` real genesis), E2E (indicator at desktop/tablet/mobile widths).

## Amendments

- **2026-09-30 (Iteration 01):** Status set to IMPLEMENTED. `WALLET_STANDARD_CHAINS` were confirmed against `@solana/kit-plugin-wallet` 0.20.0. The worker probe also re-verifies the genesis hash every 5 minutes.
- **2026-10-01 (Iteration 01.5) — Explorer choice (SPEC-025):** users may choose Solana Explorer or Solscan. NET-AC-07 holds for both: every link carries the cluster parameter; localnet always uses Solana Explorer with the local RPC because Solscan cannot show a local validator.
