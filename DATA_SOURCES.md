# Data Sources

Status: **Baseline (Iteration 00).** Catalog of every external data provider considered for the MVP.

A provider may be integrated only after completing the [provider verification procedure](./docs/data-sources/provider-verification-template.md): official documentation inspected, endpoint verified, authentication verified, free-tier availability verified, rate limits verified, response schema verified, endpoint tested, adapter created, validation added, provider documented, health monitoring added.

**Nothing in this file is a license to fabricate data.** When a provider cannot deliver, the product shows `DATA UNAVAILABLE` / `Provider unavailable`.

---

## 1. Policy summary

- Every provider used by the MVP must be free for the required functionality, documented, legally accessible, and rate-limit aware.
- Limited free tiers require: documented limits, throttling, retries, caching, degradation, and health recording.
- Undocumented or unofficial endpoints may only be used behind provider isolation, schema validation, health monitoring, graceful degradation, and documentation — and never for critical functionality.
- No aggressive scraping, no bypassing authentication, no circumventing rate limits.
- API keys belong to the backend only; they never reach the browser.

## 2. Status legend

| Status | Meaning |
| --- | --- |
| `ADOPTED` | Verified and scheduled for (or in) implementation |
| `CANDIDATE` | Plausible; must complete verification before use |
| `UNVERIFIED` | Information comes from secondary sources and has not been confirmed against official documentation |
| `REJECTED` | Not suitable (cost, legality, reliability, or network) |
| `UNAVAILABLE` | No free, legal, reliable source exists today; the capability is shown as unavailable |

## 3. Critical Devnet reality

Devnet tokens have **no market**. Aggregators, price APIs, DEX analytics, pump.fun, and social data describe **Mainnet** activity only. Consequences:

- USD valuation of Devnet assets is `UNAVAILABLE` by design unless an explicit, labeled policy says otherwise ([ADR-0009](./docs/architecture/adr/0009-devnet-valuation-policy.md)).
- Jupiter cannot execute swaps on Devnet; Devnet trading requires an on-chain DEX deployed on Devnet ([ADR-0008](./docs/architecture/adr/0008-devnet-dex-strategy.md)).
- Token intelligence based on market or social data only makes sense for Mainnet mints, observed in **read-only** mode. Any read-only Mainnet data shown in a Devnet terminal must be labeled with its network.

## 4. Provider catalog

### 4.1 Solana public RPC — Devnet

| Field | Value |
| --- | --- |
| Status | `ADOPTED` (Iteration 01) |
| URL | `https://api.devnet.solana.com` (HTTP JSON-RPC), `wss://api.devnet.solana.com` (PubSub) |
| Purpose | Authoritative on-chain data: balances, token accounts, signatures, transactions, account data, simulation, submission, cluster identity |
| Free / Paid | Free |
| Authentication | None |
| Rate limit (documented) | 100 requests / 10 s per IP; 40 requests / 10 s per IP per single RPC method; 40 concurrent connections per IP; 40 connections / 10 s per IP; 100 MB data / 30 s. Solana notes these limits may change without notice. |
| Internal budget | 70 requests / 10 s total and 25 requests / 10 s per method across all app processes (Redis token bucket), max 8 concurrent requests |
| Data fields | Iteration 01: `getBalance`, `getTokenAccountsByOwner` (jsonParsed), `getSignaturesForAddress`, `getGenesisHash`, `getVersion`, `getSlot`. Iteration 02: `getMultipleAccounts` (registry balances, data sliced to 0 bytes, ≤ 100 addresses), `getSignaturesForAddress` with `before`/`until` (indexing), `getTransaction` (json, `maxSupportedTransactionVersion: 0`; fee and SOL change, reconciliation at `finalized`), `getLatestBlockhash`, `getFeeForMessage`, `simulateTransaction` (`sigVerify: false`, post-state of the transfer accounts), `sendTransaction` (base64, preflight on, `maxRetries: 0`), `getSignatureStatuses` (≤ 256 per call), `getBlockHeight` |
| Reliability | Development-grade; not suitable for production. Occasional 429 and 5xx. Transaction history may be pruned. |
| Fallback | Optional RPC via `SOLANA_RPC_FALLBACK_URL` (provider id `solana-fallback-rpc`, own budget and health). Used once per call after a transport failure, timeout, rate limit, or invalid response from the primary, never after a JSON-RPC error answer, and only while its genesis hash is verified (SPEC-006 PH-AC-07..09). `fallbackUsed: true` and the fallback provider id appear in provenance |
| Verified identity | `getGenesisHash` = `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`; `getVersion` returned `solana-core 4.3.0` |
| Last verified | 2026-09-30 (docs: solana.com/docs/references/clusters; live calls; Iteration 01 adapter tests compare reader results with raw JSON-RPC calls) |
| Observed behavior | 2026-09-30: HTTP 429 returned for `getTokenAccountsByOwner` after a burst of end-to-end and Devnet test runs from one IP; the adapter classified it as `RPC_RATE_LIMITED` and did not retry |
| Adapter | `packages/solana` (`SolanaRpcClient`, `FailoverRpcClient`, `ClusterIdentityReader`, `SolBalanceReader`, `TokenAccountReader`, `SignatureHistoryReader`, `MultipleBalancesReader`, `TransactionDetailsReader`, `TransactionChainReaders`); provider id `solana-public-rpc` |
| Budget use (Iteration 02) | Registry list: 1 request per page (10 s cache). Wallet sync: ≤ 6 signature pages and ≤ 10 `getTransaction` calls per wallet job, ≤ 20 wallets per 60 s sweep, one job at a time. Transfer: about 6 requests to prepare and submit. Confirmation: 1 status batch plus 1 block height per 3 s sweep while transactions are open. Reconciliation: 1 status batch per 10 s, plus `getTransaction` per finalized record |
| Observed behavior (2026-10-01) | The faucet (`requestAirdrop`) returned 429 ("airdrop limit") all day, so Devnet tests that need funds skip with that reason. An unsigned `simulateTransaction` from a funded account confirmed that simulated post-balances include the amount and the base fee. Long e2e runs exhaust the per-method budget for `getTokenAccountsByOwner`, and the UI then shows `RPC rate limited` |

### 4.2 Solana public RPC — other clusters (identity reference only)

| Cluster | URL | Genesis hash (verified 2026-09-30) | MVP usage |
| --- | --- | --- | --- |
| testnet | `https://api.testnet.solana.com` | `4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY` | Not used |
| mainnet-beta | `https://api.mainnet.solana.com` | `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` | Forbidden for transactions; reserved for future read-only intelligence behind an explicit decision |
| localnet | `http://127.0.0.1:8899` | Varies per validator instance | Integration tests |

The genesis hashes are embedded as protocol constants in `packages/solana` and used for cluster verification ([SPEC-005](./docs/specs/SPEC-005-network-safety.md)).

### 4.3 Helius

| Field | Value |
| --- | --- |
| Status | `CANDIDATE` (fallback RPC and DAS metadata, Iteration 02–06) |
| URL | `https://www.helius.dev` (RPC and DAS endpoints per official docs) |
| Purpose | Fallback RPC with higher limits; Digital Asset Standard (DAS) API for token metadata; webhooks |
| Free / Paid | Free plan available |
| Authentication | API key (backend only) |
| Rate limit | Free plan: 1M credits / month; 10 RPC requests / s; DAS 2 requests / s (pricing page, 2026-09-30) |
| Data fields | Standard JSON-RPC; DAS `getAsset`, `getAssetsByOwner`; webhooks |
| Reliability | Commercial provider; free tier intended for testing |
| Fallback | Solana public RPC |
| Open questions | Devnet coverage of free plan and DAS on Devnet must be confirmed in official docs before adoption |
| Last verified | 2026-09-30 (pricing page only) — full verification pending |

### 4.4 Jupiter Developer Platform

| Field | Value |
| --- | --- |
| Status | `CANDIDATE` — read-only Mainnet quotes and reference prices only; **cannot** serve Devnet trading |
| URL | `https://api.jup.ag` (Developer Portal: `https://developers.jup.ag`, keys at `https://portal.jup.ag`) |
| Purpose | Mainnet swap quotes and routes, token lists, reference prices |
| Free / Paid | Free plan available |
| Authentication | API key required on the free plan |
| Rate limit | Free: 1 request / s (60 / min), 60-second sliding window. Swap, Price, and Token requests share one bucket. `/swap/v2/execute` has a separate bucket (50 RPS on free). Headers: `x-ratelimit-remaining`, `x-ratelimit-current`, `x-ratelimit-reset`. |
| Network | Mainnet only (hosted APIs do not support Devnet) |
| Reliability | Primary Solana aggregator; API versions change — pin versions and validate schemas |
| Deprecated endpoint | The legacy `public.jupiterapi.com` (QuickNode Metis) endpoint is scheduled to shut down on 2026-10-14. **Never** use it. |
| Fallback | None for execution on Devnet; see ADR-0008 |
| Last verified | 2026-09-30 (rate-limit docs). Endpoint paths and response schemas must be re-verified against `https://developers.jup.ag/docs/llms.txt` at Iteration 03/04 start. |

### 4.5 Orca Whirlpools (on-chain, via SDK)

| Field | Value |
| --- | --- |
| Status | `CANDIDATE` — preferred Devnet swap venue (Iteration 04) |
| URL | SDK `@orca-so/whirlpools` (npm, 8.0.1 at 2026-09-30); docs `https://dev.orca.so` |
| Purpose | Devnet quotes and swap instructions computed from on-chain pool state; no hosted API needed |
| Free / Paid | Free (reads go through our RPC budget) |
| Authentication | None |
| Rate limit | Bound by the RPC provider |
| Network | Solana Mainnet and Devnet (per Orca docs) |
| Data fields | Pool state, tick arrays, quotes, `swapInstructions` |
| Reliability | Devnet liquidity is sparse and test-oriented (e.g. a documented SOL/devUSDC pool). Quotes on Devnet do not represent any market price. |
| Fallback | None; capability `trading.devnet-swap` becomes `UNAVAILABLE` when no pool exists for the pair |
| Last verified | 2026-09-30 (secondary sources + npm). Official docs verification pending. |

### 4.6 DEX Screener API

| Field | Value |
| --- | --- |
| Status | `CANDIDATE` — Mainnet pair/liquidity/volume data for read-only intelligence (Iteration 06) |
| URL | `https://api.dexscreener.com` (reference: `https://docs.dexscreener.com/api/reference`) |
| Purpose | Pairs, liquidity, volume, price, token profiles and boosts |
| Free / Paid | Free public API (terms of use must be reviewed before adoption) |
| Authentication | None documented |
| Rate limit | Documented per endpoint: 60 requests / min for profile/boost/meta endpoints; pair/token/search endpoints must be re-verified (secondary sources report 300 requests / min) |
| Network | Mainnet only |
| Data fields | `/latest/dex/pairs/{chainId}/{pairId}`, `/latest/dex/search`, `/token-pairs/v1/{chainId}/{tokenAddress}`, `/tokens/v1/{chainId}/{tokenAddresses}`, `/token-profiles/latest/v1`, `/token-boosts/latest/v1`, … |
| Reliability | Unofficial aggregator data; values are provider-reported, not on-chain facts |
| Fallback | Jupiter price (for price only) |
| Last verified | 2026-09-30 (API reference page) |

### 4.7 On-chain token metadata

| Field | Value |
| --- | --- |
| Status | `ADOPTED` (Iteration 03/05) |
| Source | Token-2022 metadata extension and Metaplex Token Metadata accounts, read via RPC |
| Purpose | Name, symbol, URI, update authority, mutability |
| Free / Paid | Free (RPC budget) |
| Reliability | On-chain fields are authoritative for what the account says; the off-chain JSON at the URI is untrusted external content |
| Last verified | Pending (Iteration 03) |

### 4.8 pump.fun

| Field | Value |
| --- | --- |
| Status | `UNAVAILABLE` as an official API; on-chain decoding is a `CANDIDATE` for Iteration 09 |
| Findings (2026-09-30) | pump.fun does not offer a public, documented data API. Its on-chain programs and IDLs are published publicly (pump-public-docs), which allows decoding bonding-curve and migration events directly from Mainnet RPC data. The hosts used by its web app are undocumented. |
| Third-party options | PumpPortal (free WebSocket for new-token and migration events), Bitquery, Codex (free tier ~10,000 requests / month), Solana Tracker, Moralis — all `UNVERIFIED`; terms of use, limits, and stability must be verified individually |
| Network | Mainnet only — no Devnet data exists |
| Product behavior | Capability `new-tokens.pumpfun` shows `Provider unavailable` until a verified source is adopted |

### 4.9 X (Twitter)

| Field | Value |
| --- | --- |
| Status | `UNAVAILABLE` |
| Findings | No free official X API tier provides practical read/search access for monitoring. Scraping X violates its terms and is prohibited by project policy. |
| Product behavior | `X DATA UNAVAILABLE` is a valid, first-class product state |
| Last verified | 2026-09-30 (policy decision; re-check official X developer pricing before Iteration 09) |

### 4.10 Reference market prices (e.g. SOL/USD)

| Candidate | Status | Notes |
| --- | --- | --- |
| Jupiter Price API | `CANDIDATE` | Mainnet prices, shares the free 1 RPS bucket (4.4) |
| CoinGecko Demo API | `UNVERIFIED` | Free demo plan with API key; limits must be verified from official docs |
| Pyth price feeds (on-chain / Hermes) | `UNVERIFIED` | Oracle prices; Devnet feed availability must be verified |

Whether any Mainnet reference price may be displayed next to Devnet balances is an open product decision ([ADR-0009](./docs/architecture/adr/0009-devnet-valuation-policy.md)).

### 4.11 Solana Explorer (links only)

| Field | Value |
| --- | --- |
| Status | `ADOPTED` (Iteration 01) — link target, not a data source |
| URL | `https://explorer.solana.com/{address|tx}/{id}?cluster=devnet` |
| Notes | Links are generated by the `network` domain with the active cluster; no data is fetched from the explorer |

## 5. Provider registry fields

Each provider in code (`system/providers` registry) declares:

```
id, displayName, sourceType (rpc | rest | websocket | sdk-onchain),
networks[], baseUrl, authMode (none | apiKeyHeader | apiKeyQuery),
budget { requestsPerWindow, windowMs, perMethod?, maxConcurrency },
timeoutMs, retry { maxAttempts, baseDelayMs, maxDelayMs, jitter },
capabilities[], enabled, docsUrl, lastVerifiedAt
```

## 6. Change procedure

Adding, removing, or changing a provider requires: an update to this file, a changelog entry, an audit event when changed at runtime (`provider.changed`), and a health-monitoring entry.
