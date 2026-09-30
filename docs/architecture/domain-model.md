# Domain Model

Ubiquitous language for the Solana Corporate Terminal. Terms here are used identically in code, API contracts, UI copy, and documentation.

## 1. Core distinctions

| Distinction | Rule |
| --- | --- |
| On-chain vs. off-chain | On-chain facts (address, balances, token accounts, signatures, authorities, slot, block time) are authoritative and never overwritten by application metadata (labels, notes, assignments, permissions, alert configuration). |
| Application wallet roles vs. protocol authorities | `Creator`, `Funder`, `Controller`, `Viewer` are application roles on a wallet record. Mint, freeze, update, permanent-delegate, transfer-fee, and transfer-hook authorities are Solana protocol facts. They are never conflated. |
| Sign-in identity vs. operational wallet | A wallet used to sign in identifies a user. An operational wallet is a registered organization asset. Signing in does not register a wallet. |
| Observed vs. derived vs. inferred | Observed facts come from a source; derived metrics are computed from observed facts; inferences and hypotheses are interpretations and are always labeled. |
| Unknown vs. absent vs. revoked | "Unknown" (data not available) is never displayed as "Absent" or "Revoked". |

## 2. Shared value objects

| Value object | Definition |
| --- | --- |
| `Cluster` | `localnet \| devnet \| testnet \| mainnet-beta` |
| `WalletAddress` / `Address` | Base58 Ed25519 public key (`Address` type from `@solana/kit`) |
| `Signature` | Base58 transaction signature |
| `Lamports` | Non-negative `bigint`; 1 SOL = 1,000,000,000 lamports |
| `TokenAmount` | `{ raw: bigint, decimals: number }` |
| `Slot` | `bigint` |
| `Sourced<T>` | Value + provenance + availability (SPEC-003) |
| `Money` *(03)* | `{ amount: decimal string, currency: "USD" \| …, priceSource, priceTimestamp }` — never a bare float |

## 3. Domains and main concepts

### network
- **ClusterIdentity**: configured cluster, expected and observed genesis hash, verification time, RPC version.
- **ExplorerLink**: address/transaction link for a cluster.

### system
- **Provider**: registry entry (id, networks, auth mode, budget, capabilities).
- **ProviderHealth**: status (`HEALTHY`, `DEGRADED`, `RATE_LIMITED`, `UNAVAILABLE`, `DISABLED`, `UNKNOWN`), latency, error rate, rate-limit state.
- **Capability**: product capability with availability and reason.

### auth / users / organizations / roles
- **User**: a person; has one or more **WalletIdentity** records used for sign-in.
- **Organization**: tenant. **Membership** links a user to an organization with one or more **Roles**.
- **Role**: named set of **Permissions** (`wallet.read`, …). **Team** *(08)*.
- **Session**: server-side authentication state with active organization.
- **ApiCredential** *(08)*.

### wallets
- **WalletOverview** *(01)*: read model of balance, token accounts, recent signatures.
- **ManagedWallet** *(02)*: organization-registered wallet: address, cluster, label, purpose, category (`TREASURY`, `TRADING`, `OPERATIONS`, `DEVELOPMENT`, `TOKEN_ISSUANCE`, `RESEARCH`, `COLD_STORAGE`, `WATCH_ONLY`), custody type (`BROWSER_WALLET`, `LOCAL_ENCRYPTED`, `WATCH_ONLY`, future `KMS`/`MPC`/`MULTISIG`), tags, notes.
- **WalletAssignment** *(02/08)*: user or team + application wallet role (`CREATOR`, `FUNDER`, `CONTROLLER`, `VIEWER`).
- **TokenAccountSnapshot**, **TransactionSignatureSummary**.

### transactions *(02)*
- **TransactionRecord** with **TransactionState** (SPEC-004), **ExpectedEffects**, **SimulationResult**, **ReconciliationResult**.

### portfolio / market-data *(03)*
- **Portfolio**: aggregation over wallets of the same cluster.
- **Holding**: asset + amount + optional **Valuation** (`asset`, `price`, `priceSource`, `priceTimestamp`, `quoteCurrency`).
- **PortfolioSnapshot**: point-in-time holdings with provenance.
- **PriceQuote**: `Sourced<Money>` per asset.

### trading *(04)*
- **SwapQuoteRequest**, **SwapQuote** (input/output mint and amount, minimum output, price impact, route legs, fees, slippage bps, provider, expiry), **SwapExecution** (a TransactionRecord with purpose `swap`).

### token-studio / tokens *(05)*
- **TokenDraft** (identity, supply, authorities, extensions, metadata) progressing through the 12 wizard steps.
- **TokenExtension** (supported set verified per network and client).
- **AuthorityState**: `PRESENT(address) | ABSENT | REVOKED | UNKNOWN | NOT_APPLICABLE` per authority type.

### intelligence *(06/09)*
- **TokenFact**: observed fact with evidence and provenance.
- **DerivedMetric**: computed value with inputs and model version.
- **RiskAssessment**: versioned model (`modelVersion`), decomposed factor contributions, evidence, timestamp.
- **WalletRelationship**: `source`, `relationship` (`FUNDED`, `RECEIVED_FROM`, `INTERACTED_WITH_TOKEN`, `TRADED_THROUGH_PROGRAM`, …), `target`, `observedAt`, `confidence`, `evidence` — never an identity assertion.
- **AiAnalysis**: structured output with classified statements (Observed, Derived, Inference, Hypothesis, Unknown).

### alerts / notifications / watchlists *(07)*
- **AlertRule**: condition, source, evaluation frequency, last evaluated, last triggered, state.
- **AlertEvent**, **Notification** (in-app first), **Watchlist** (wallets/tokens).

### audit
- **AuditEvent** (SPEC-008).

## 4. Domain events (used where they solve a real problem)

`WalletConnected` (01), `WalletCreated`, `WalletBalanceChanged`, `TransactionSubmitted`, `TransactionConfirmed`, `TransactionFailed`, `ReconciliationRequired` (02), `MarketDataUpdated` (03), `TokenCreated`, `TokenAuthorityChanged` (05), `AlertTriggered` (07), `ProviderUnavailable` (01/07).

Events are published in-process first; BullMQ carries them only when the consumer runs in the worker.
