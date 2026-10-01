# SPEC-002 — Wallet Overview (First Vertical Slice)

| Field | Value |
| --- | --- |
| Status | IMPLEMENTED |
| Iteration | 01 |
| Domain(s) | `wallets`, `network`, `auth`, `audit`, `system` |
| Criteria prefix | `WO` |
| Related | SPEC-003, SPEC-005, SPEC-006, SPEC-007, SPEC-008, API.md §4.3 |

## 1. Problem and goal

Prove the architecture end-to-end with real Devnet data:

```
User → Terminal → API → Solana adapter → Devnet RPC → real blockchain data
     → domain model → API response → Terminal UI
```

A signed-in user connects a Solana wallet and sees its real SOL balance, token accounts, and recent transactions, each with provenance and freshness, with correct behavior under every failure mode.

## 2. Scope

In scope:
- Wallet detection and connection via the Wallet Standard (`@solana/kit-plugin-wallet`).
- Wallet chain vs. application cluster verification.
- Read-only overview for the connected wallet, and for any valid address typed by the user (watch view).
- SOL balance, token accounts (SPL Token and Token-2022), recent signatures (up to 50).
- Audit of wallet connection events.
- Loading, empty, error, unavailable, stale, disconnected, and cluster-mismatch states.

Out of scope:
- Persisting wallets in a registry (Iteration 02).
- Token metadata (names, symbols, logos) — mints are shown by address (Iteration 03).
- USD valuation (Iteration 03, ADR-0009).
- Full transaction decoding (Iteration 02).
- WebSocket live subscriptions (Iteration 02).

## 3. Domain concepts

| Concept | Kind | Rules |
| --- | --- | --- |
| `WalletAddress` | Value object | Valid base58 32-byte Ed25519 public key (`isAddress` from `@solana/kit`) |
| `Cluster` | Value object | `localnet \| devnet \| testnet \| mainnet-beta`; must equal the API cluster |
| `Lamports` | Value object | Non-negative `bigint`; `uiAmount` = lamports / 10^9 computed with integer arithmetic |
| `TokenAmount` | Value object | Raw `bigint` + `decimals` (0–255 as reported by the mint); display string computed exactly |
| `TokenAccountSnapshot` | Entity (read model) | `tokenAccount`, `mint`, `owner`, `tokenProgram` (`spl-token` / `token-2022`), `amount`, `state`, `isNative` |
| `TransactionSignatureSummary` | Read model | `signature`, `slot`, `blockTime` (nullable), `status` (`succeeded`/`failed`), `confirmationStatus`, `memo` (untrusted) |
| `WalletOverview` | Aggregate read model | `address`, `cluster`, `solBalance: Sourced<Lamports>`, `tokenAccounts: Sourced<TokenAccountSnapshot[]>`, `recentTransactions: Sourced<TransactionSignatureSummary[]>` |

## 4. Behavior

### 4.1 Terminal
1. The terminal lists wallets detected through the Wallet Standard. If none are detected, it shows guidance to install a Solana wallet.
2. The user selects a wallet and approves connection in the wallet.
3. The terminal reads the account address and the wallet's supported chains. If the account does not support `solana:devnet` (the chain for the configured cluster), the terminal shows the cluster-mismatch state and does not request data or signatures for it.
4. The terminal calls `POST /api/v1/wallets/connections` (recording the connection) and `GET /api/v1/wallets/{address}/overview`.
5. The overview refreshes on user request (button and keyboard shortcut `R`) and automatically every 30 s while the tab is visible. No tighter polling.
6. On wallet disconnect or account change, cached data for the previous address is removed from view immediately.

### 4.2 API (`GetWalletOverview`)
1. Validate `address` (400 `WALLET_ADDRESS_INVALID`) and session/permission `wallet.read` (401/403).
2. Ensure cluster verification is `verified` (else 503 `CLUSTER_VERIFICATION_FAILED`).
3. Execute in parallel, through the provider wrapper (budget, timeout 8 s, up to 3 attempts with backoff + jitter for retryable errors):
   - `getBalance(address, { commitment: "confirmed" })`
   - `getTokenAccountsByOwner(address, { programId: TOKEN_PROGRAM }, { encoding: "jsonParsed", commitment: "confirmed" })`
   - `getTokenAccountsByOwner(address, { programId: TOKEN_2022_PROGRAM }, …)`
   - `getSignaturesForAddress(address, { limit: signaturesLimit, commitment: "confirmed" })`
4. Validate each RPC response with a Zod schema. Invalid shapes become `UNAVAILABLE` with reason `RPC_INVALID_RESPONSE`.
5. Build `Sourced<T>` per section. Token accounts are `AVAILABLE` only if **both** program queries succeed; if one fails, the section is `UNAVAILABLE` (a partial token list would misrepresent holdings).
6. Cache the successful sections in Redis for 10 s keyed by `cluster:address:section`. Cached responses keep their original `retrievedAt`.
7. Return `200` with the aggregate even when some sections are unavailable.

### 4.3 Explorer links
Built by the `network` domain: `https://explorer.solana.com/address/{address}?cluster=devnet` and `https://explorer.solana.com/tx/{signature}?cluster=devnet`.

## 5. External data dependencies

| Data | Source | Network | Budget impact per overview | Failure behavior |
| --- | --- | --- | --- | --- |
| SOL balance | Solana RPC `getBalance` | devnet | 1 request | Section `UNAVAILABLE` |
| Token accounts | Solana RPC `getTokenAccountsByOwner` ×2 | devnet | 2 requests | Section `UNAVAILABLE` |
| Recent signatures | Solana RPC `getSignaturesForAddress` | devnet | 1 request | Section `UNAVAILABLE` |

## 6. Security considerations

- Only public data is read; no key material is involved.
- `memo` and any string from the chain are untrusted: rendered as plain text, length-limited (display truncation at 256 characters with full value on demand), control/bidi characters stripped.
- Addresses typed by users are validated client-side (UX) and server-side (security).
- Connection events are audited (`wallet.connected`, `wallet.connection_rejected`), including wallet name and chain, never including signatures or keys.
- API rate limit applies per session.

## 7. States

| State | Trigger | UI |
| --- | --- | --- |
| No wallet detected | Wallet Standard registry empty | Empty state: "No Solana wallet detected. Install a Wallet Standard compatible wallet to connect." |
| Not connected | No active account | "Connect a wallet to view its overview." + address search input |
| Loading | Request in flight | Section skeletons with operation label ("Fetching SOL balance from Devnet RPC…") |
| Empty token accounts | Both queries succeed with 0 accounts | "No token accounts found for this wallet on Devnet." |
| No transactions | Signatures query returns 0 | "No indexed transactions are available for this wallet." |
| Unavailable | Section status `UNAVAILABLE` | `DATA UNAVAILABLE` block: reason, source, last successful retrieval, retry state, Retry button |
| Stale | Displayed data older than 60 s (e.g. refetch failed) | Freshness label "Stale — last update 4m 17s ago" in warning color |
| Disconnected | Wallet disconnects | Data cleared; "Wallet disconnected." with reconnect action |
| Cluster mismatch | Wallet account lacks `solana:devnet` | Blocking notice: "This wallet account is not configured for Solana Devnet. Switch the wallet network to Devnet." |
| Cluster unverified | API cluster verification failed | Global banner: "Solana RPC cluster could not be verified. Blockchain data is disabled." |

## 8. Acceptance criteria

### WO-AC-01 — Wallet detection
Given the user is signed in on the terminal configured for Devnet
When one or more Wallet Standard wallets are registered in the browser
Then the terminal lists them by name and icon, and when none are registered it shows the "No Solana wallet detected" state.

### WO-AC-02 — Connection and audit
Given a detected wallet
When the user connects an account that supports `solana:devnet`
Then the terminal displays the public address and network `SOLANA DEVNET`, and an audit event `wallet.connected` with the address, wallet name, chain, actor, organization, and request id is persisted.

### WO-AC-03 — Real SOL balance
Given a connected Devnet address with a known balance
When the overview loads
Then the displayed lamports equal the value returned by Devnet `getBalance` at `confirmed` commitment (within the same slot window), shown with 9-decimal precision and no floating-point rounding errors.

### WO-AC-04 — Token accounts from both programs
Given an address holding token accounts under SPL Token and under Token-2022
When the overview loads
Then both sets are listed with token account, mint, program, raw amount, decimals, display amount, and state.

### WO-AC-05 — Recent transactions
Given an address with transaction history on Devnet
When the overview loads
Then up to `signaturesLimit` (default 20) signatures are listed newest first with slot, block time (or "Unknown" when null), success/failure status, and a working explorer link for Devnet.

### WO-AC-06 — Provenance
Given any section is `AVAILABLE`
When the user inspects it (provenance popover / detail)
Then source, provider, RPC method, network, commitment, context slot, retrieved-at timestamp, latency, and request id are shown.

### WO-AC-07 — Freshness
Given a section was retrieved at time T
When the user views it
Then a relative freshness label is shown ("Updated 12 s ago"), and after 60 s without a successful refresh it switches to the stale state.

### WO-AC-08 — Input validation and authorization
Given a request for `/api/v1/wallets/{address}/overview`
When the address is invalid, the session is missing, or the user lacks `wallet.read`
Then the API responds `400 WALLET_ADDRESS_INVALID`, `401 UNAUTHENTICATED`, or `403 FORBIDDEN` respectively, using the standard error format.

### WO-AC-09 — Empty token accounts
Given a valid Devnet address with no token accounts
When the overview loads
Then the token section shows "No token accounts found for this wallet on Devnet." and no placeholder rows.

### WO-AC-10 — No transactions
Given a valid address with no signatures returned
When the overview loads
Then the transactions section shows "No indexed transactions are available for this wallet."

### WO-AC-11 — RPC unavailable
Given the RPC is unreachable or times out after retries
When the overview is requested
Then affected sections are `UNAVAILABLE` with reason `RPC_UNAVAILABLE` or `RPC_TIMEOUT`, the UI shows `DATA UNAVAILABLE` with source, last successful retrieval (or "Never"), and a Retry action, and provider health records the failure.

### WO-AC-12 — RPC rate limited
Given the RPC responds with HTTP 429 or the internal budget is exhausted
When the overview is requested
Then affected sections are `UNAVAILABLE` with reason `RPC_RATE_LIMITED` and a `retryAfterMs`, provider health transitions to `RATE_LIMITED`, and no value is fabricated or silently reused.

### WO-AC-13 — Partial failure
Given the balance request succeeds and a token-account request fails
When the overview is returned
Then the balance is shown as available, the whole token section is `UNAVAILABLE` (never a partial list), and the HTTP status is `200`.

### WO-AC-14 — Wallet disconnection
Given an overview is displayed for a connected wallet
When the wallet disconnects or switches accounts
Then the previous address's data is removed from view immediately and the disconnected (or new account) state is shown.

### WO-AC-15 — Cluster mismatch
Given the connected account does not support `solana:devnet`
When the connection completes
Then the terminal shows the cluster-mismatch notice, requests no overview for signing purposes, and records `wallet.connection_rejected` with reason `CLUSTER_MISMATCH`.

### WO-AC-16 — Bounded refresh
Given the overview is open
When time passes
Then automatic refresh happens no more often than every 30 s and only while the tab is visible, and repeated overview requests within 10 s are served from cache with their original `retrievedAt`.

### WO-AC-17 — Untrusted chain strings
Given a transaction memo contains markup, control characters, or bidirectional override characters
When it is displayed
Then it renders as inert plain text with those characters removed and is truncated for display.

## 9. Test plan

| Criterion | Layer |
| --- | --- |
| WO-AC-01, 02, 14, 15 | E2E (test Wallet Standard wallet) + integration (audit) |
| WO-AC-03, 04, 05 | Devnet integration (`@devnet`) + unit (normalization) |
| WO-AC-06, 07 | Unit (Sourced builder, freshness) + E2E |
| WO-AC-08 | Integration (Fastify inject) |
| WO-AC-09, 10 | Devnet integration with a freshly generated, empty address + E2E |
| WO-AC-11, 12, 13 | Integration with stub RPC server + E2E |
| WO-AC-16 | Unit (query config) + integration (cache) |
| WO-AC-17 | Unit (sanitizer) + component test |

## 10. Open questions

- Should the watch view (arbitrary address) require a distinct permission from the connected-wallet view? Default: both use `wallet.read`.

## Amendments

- **2026-09-30 (Iteration 01):** Status set to IMPLEMENTED. WO-AC-01..17 pass automated tests; the manual check with a third-party browser wallet is pending (checklist 1.14).
- **2026-09-30 — WO-AC-01 clarification:** `@solana/kit-plugin-wallet` only discovers wallets that advertise the configured chain. A wallet without `solana:devnet` is therefore not listed, and the empty-state text reads "No Solana wallet supporting Devnet was detected. Install a Wallet Standard compatible wallet and enable Devnet." WO-AC-15 still applies to connected accounts whose own `chains` lack `solana:devnet`.
- **2026-09-30 — Token account order:** amounts of different mints are not comparable without prices, so token accounts are ordered by token program, mint, and account address.
- **2026-09-30 — Signed-in vs. connected wallet:** when the connected account differs from the signed-in wallet, the terminal shows the connected account's overview read-only and states that the accounts differ.
- **2026-10-01 (Iteration 01.5) — User preferences (SPEC-025):** the automatic refresh interval follows the user's `overviewRefreshSeconds` preference (30, 60, or 120 s, or off); WO-AC-16's bound is unchanged — never more often than every 30 s, only while the tab is visible. The `/` and `R` shortcuts can be disabled. Explorer links are built in the terminal for the user's chosen explorer (the API's `explorerUrl` fields remain Solana Explorer links), and block times render in the user's selected time zone with its label instead of always UTC.
