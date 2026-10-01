# SPEC-009 — Wallet Registry

| Field | Value |
| --- | --- |
| Status | IMPLEMENTED |
| Iteration | 02 |
| Domain(s) | `wallets` (api, terminal), `organizations`, worker `wallets` |
| Criteria prefix | `WRG` |
| Related | SPEC-002, SPEC-003, SPEC-004, SPEC-007, SPEC-008, SPEC-010, ADR-0004, prompt §27, §29 |

## 1. Problem and goal

An organization operates several Solana wallets (treasury, trading, token issuance, research, watched counterparties). Today the terminal can only show the wallet the user happens to have connected, or any address typed into the watch field; nothing is recorded about which wallets the organization owns, what they are for, or who is responsible for them.

The registry makes wallets first-class organization assets: each registered wallet has an address, a cluster, off-chain metadata (label, purpose, category, tags, notes), a custody type, and application role assignments. It keeps its own indexed transaction history, synchronized by the worker from Devnet. On-chain facts (balances, history) always come from the chain with provenance; the registry stores only off-chain metadata and the derived index.

Success: an operator can register the connected wallet, a locally generated wallet (SPEC-010), or a watch-only address; see every registered wallet of the organization with its live SOL balance; open one to see its overview and indexed history; and every registry change is audited.

## 2. Scope

In scope:
- Registering wallets of three custody types: `BROWSER_WALLET` (a Wallet Standard account the user controls), `LOCAL_ENCRYPTED` (generated in the browser, SPEC-010), and `WATCH_ONLY` (any address, no control claimed).
- Proof of control for `BROWSER_WALLET` and `LOCAL_ENCRYPTED`: a single-use ownership challenge signed by the wallet's key.
- Metadata: label, purpose, category, tags, notes; archiving and restoring.
- Application wallet role assignments (`CREATOR`, `FUNDER`, `CONTROLLER`, `VIEWER`) for organization members.
- Registry list with filters and live SOL balances (one batched RPC call); wallet detail.
- Indexed transaction history per registered wallet, maintained by the worker (`wallets.sync` queue), with fee and SOL change per transaction.
- Audit events for every registry change.

Out of scope:
- Transfers and other write flows (SPEC-004 covers the first one, SOL transfer).
- Token holdings aggregation and valuation across wallets (Iteration 03, Portfolio).
- Team assignments and the organization dashboard (Iteration 08).
- Moving a wallet between organizations; registering the same address on several clusters at once.
- Deleting a wallet record. Wallets are archived, never deleted, because audit events and transaction records reference them.

## 3. Domain concepts

- **ManagedWallet** (domain model §wallets): `id`, `organizationId`, `address`, `cluster`, `label`, `purpose`, `category`, `custodyType`, `tags`, `notes`, `status` (`ACTIVE` · `ARCHIVED`), `createdByUserId`, timestamps.
  - `label`: 1–64 characters after trimming, plain text (no control, format, or line-separator characters).
  - `purpose`: optional, ≤ 200 characters, plain text.
  - `notes`: optional, ≤ 2,000 characters, plain text; line breaks allowed.
  - `tags`: 0–10 distinct tags, each 1–32 characters of `a–z`, `0–9`, `-`; stored lowercase.
  - `category`: `TREASURY`, `TRADING`, `OPERATIONS`, `DEVELOPMENT`, `TOKEN_ISSUANCE`, `RESEARCH`, `COLD_STORAGE`, `WATCH_ONLY`.
  - `custodyType`: `BROWSER_WALLET`, `LOCAL_ENCRYPTED`, `WATCH_ONLY` (future `KMS`, `MPC`, `MULTISIG` require a new ADR).
- **Invariants:**
  1. `(organizationId, address, cluster)` is unique.
  2. `address`, `cluster`, and `custodyType` are immutable after registration.
  3. `category = WATCH_ONLY` requires `custodyType = WATCH_ONLY`. A watch-only wallet may carry any category (e.g. a `COLD_STORAGE` wallet watched from the terminal).
  4. `cluster` equals the API cluster at registration; records of another cluster are never listed or returned.
  5. Signing in with a wallet does not register it (domain model §1). Registration is always an explicit action.
- **WalletAssignment**: `(walletId, userId, role)` unique; `role` ∈ `CREATOR`, `FUNDER`, `CONTROLLER`, `VIEWER`. Application roles, never protocol authorities. The registering user receives `CREATOR` automatically.
- **OwnershipChallenge**: single-use, expires after 5 minutes, bound to organization, user, address, and cluster. The message is built by the server:

```
<domain> asks you to prove control of this Solana account for the wallet registry.

Account: <address>
Network: <cluster>
Organization: <organization slug>
Nonce: <nonce>
Issued At: <ISO timestamp>
Expiration Time: <ISO timestamp>

Signing this message does not authorize any transaction.
```

- **IndexedTransaction**: `(walletId, signature)` unique; `slot`, `blockTime`, `status` (`succeeded` · `failed`), `confirmationStatus`, `memo` (untrusted text), `feeLamports` and `solChangeLamports` (nullable until the details are fetched), `detailsRetrievedAt`.
- **WalletSyncState** per wallet: `newestSignature`, `oldestSignature`, `backfillComplete`, `indexedCount`, `lastAttemptAt`, `lastSuccessAt`, `lastFailureAt`, `lastFailureReason`.

## 4. Behavior

```
Terminal /wallets → /api/v1/wallets* (wallet.read | wallet.create | organization.manage)
  → wallets application services → PostgreSQL (managed_wallets, wallet_tags, wallet_assignments,
    wallet_ownership_challenges, wallet_sync_state, indexed_transactions)
  → Solana RPC (getMultipleAccounts for balances; ownership signature verified locally)
  → audit (wallet.*)
Worker wallets.sync → Solana RPC (getSignaturesForAddress, getTransaction) → indexed_transactions
```

1. **Register watch-only.** `POST /wallets { custodyType: "WATCH_ONLY", address, label, category, purpose?, tags?, notes? }` validates the address (base58, 32 bytes), checks uniqueness, inserts the wallet, its tags, the `CREATOR` assignment, and its sync state in one transaction, audits `wallet.created`, and enqueues an initial sync.
2. **Register with proof of control.** The terminal requests `POST /wallets/ownership-challenges { address }`, has the wallet (Wallet Standard `solana:signMessage`, or the local key from SPEC-010) sign the exact message, then sends `POST /wallets { custodyType: "BROWSER_WALLET" | "LOCAL_ENCRYPTED", address, …, ownership: { challengeId, signature } }`. The API locks the challenge, checks it is unconsumed, unexpired, and bound to the same organization, user, address, and cluster, verifies the Ed25519 signature over the stored message, marks the challenge consumed, and registers as in step 1. A failure returns `WALLET_OWNERSHIP_UNVERIFIED` and is audited as `wallet.registration_rejected`.
3. **List.** `GET /wallets?status=&category=&custodyType=&tag=&q=&cursor=&limit=` returns the organization's wallets on the API cluster, newest first, paginated by cursor (default 50, max 100), each with tags, assignments, the caller's own roles, and sync state. `q` matches label or address prefix. The response carries `balances: Sourced<{ walletId, lamports }[]>` read with one `getMultipleAccounts` call (≤ 100 addresses, `confirmed`), cached 10 s per address set. A missing account (never funded) has balance `0`.
4. **Detail.** `GET /wallets/{id}` returns the wallet with tags, assignments, and sync state. The terminal combines it with the existing overview (`GET /wallets/{address}/overview`, SPEC-002) and the indexed history.
5. **Update.** `PATCH /wallets/{id}` changes any of `label`, `purpose`, `category`, `tags`, `notes`, `status`. Immutable fields are rejected by the schema. Audited as `wallet.updated` with the changed field names (never the values of notes). Archiving keeps the record, its history, and its assignments; archived wallets are excluded from the default list and from synchronization.
6. **Assignments.** `POST /wallets/{id}/assignments { userId, role }` and `DELETE /wallets/{id}/assignments/{userId}/{role}` require `organization.manage`. The target user must hold an active membership in the organization. Audited as `wallet.assigned` / `wallet.unassigned`. `GET /organization/members` (`organization.manage`) lists active members (id, display name, sign-in wallet) for the assignment picker.
7. **History.** `GET /wallets/{id}/transactions?cursor=&limit=` returns indexed transactions newest first (default 25, max 100) with the sync state. The index is labeled with its coverage: "Indexed since <oldest indexed block time>" and, when the backfill cap is reached, "Older history is not indexed."
8. **Synchronization** (worker, queue `wallets.sync`):
   - A job scheduler runs a sweep every 60 s. The sweep selects active wallets on the API cluster ordered by `lastAttemptAt` (oldest first), at most 20 per sweep, and enqueues one job per wallet with the deterministic id `sync-<walletId>-<sweepWindow>`.
   - Registration and the terminal's **Sync now** action (`POST /wallets/{id}/sync`, `wallet.read`, at most once per 30 s per wallet) enqueue a job with id `sync-<walletId>-manual-<30 s window>`.
   - A wallet job (idempotent):
     1. Fetches new signatures newer than `newestSignature` (`getSignaturesForAddress` with `until`, `limit` 100, `confirmed`), paging until it reaches the known newest signature or 500 signatures in one run.
     2. Backfills older signatures (`before = oldestSignature`, limit 100) until the wallet holds 1,000 indexed signatures (`backfillComplete`), at most one page per run.
     3. Fetches details (`getTransaction`, `confirmed`, `maxSupportedTransactionVersion: 0`) for up to 10 indexed transactions without details, newest first, computing the fee and the wallet's SOL change from `meta.preBalances`/`postBalances`. Details are best effort: a provider failure in this step (usually the shared budget) defers them to the next run without failing the sync.
     4. Upserts on `(walletId, signature)`, so reruns never duplicate rows.
   - Known limit: when more than 500 new signatures appear between two runs, the signatures between the 500th newest and the previously known newest are not indexed (the backfill only extends below the oldest indexed signature). At a 60 s sweep this needs more than about 8 transactions per second on one wallet.
   - Failures update `lastFailureAt` and `lastFailureReason` (the classified provider error kind) and are retried by the next sweep; BullMQ retries a job up to 3 times with exponential backoff and keeps failed jobs for inspection.

## 5. External data dependencies

| Data | Source | Network | Budget impact | Failure behavior |
| --- | --- | --- | --- | --- |
| SOL balances for the list | `getMultipleAccounts` (≤ 100 addresses) | Devnet | 1 request per list load (10 s cache) | `balances` is `UNAVAILABLE` with reason; the list itself still renders |
| Ownership proof | None (Ed25519 verification in the API) | — | None | — |
| New and older signatures | `getSignaturesForAddress` | Devnet | ≤ 6 requests per wallet job | Sync state records the failure; the index keeps its last data |
| Transaction details | `getTransaction` | Devnet | ≤ 10 requests per wallet job | Details stay `null` and are retried in later runs |

All calls go through the provider pipeline (budget, retries, health, fallback per SPEC-006 amendment).

## 6. Security considerations

- **Authorization:** `wallet.read` to list, view, read history, and request a sync; `wallet.create` to request ownership challenges, register, and update; `organization.manage` to assign and unassign and to list members. Every query filters by the caller's active organization; a wallet of another organization returns `404 WALLET_NOT_FOUND`.
- **Key material:** none reaches the API. Ownership proof is a signature over a server-built text message that cannot be a transaction (it is not a valid transaction message and the wallet signs it with `signMessage`).
- **Replay:** challenges are single-use, short-lived, and bound to organization, user, address, and cluster.
- **Untrusted input:** label, purpose, notes, and tags are validated and rendered as text; memos from the chain are sanitized (`sanitizeUntrustedText`) and truncated at render time.
- **Audit:** `wallet.created` (address, custodyType, category), `wallet.registration_rejected` (address, custodyType, reason), `wallet.updated` (fields), `wallet.assigned` / `wallet.unassigned` (targetUserId, role), `wallet.sync_requested`.
- **Abuse:** registration is limited by the organization's wallet cap (500 active wallets; `OPERATION_NOT_ALLOWED` beyond it) and by the API rate limit; manual sync is throttled per wallet.

## 7. States

| State | Trigger | UI representation |
| --- | --- | --- |
| Loading | List or detail request in flight | Skeleton with "Loading registered wallets…" |
| Empty | No wallets registered | "No wallets found. Create or connect a wallet to begin." with Register actions (for `wallet.create` holders) |
| Filtered empty | Filters match nothing | "No wallets match these filters." |
| Error | API error | Error state with message and request id |
| Balances unavailable | `getMultipleAccounts` failed | Balance column shows `DATA UNAVAILABLE` with reason and Retry; rows remain |
| Not synced yet | Sync state without success | History: "This wallet has not been indexed yet." with sync status |
| Sync failing | `lastFailureAt` after `lastSuccessAt` | Warning with the failure reason and last success time; existing rows remain |
| Archived | `status = ARCHIVED` | Muted row with `ARCHIVED`; detail shows Restore for `wallet.create` holders |
| Ownership pending | Waiting for the wallet signature | "Waiting for wallet signature…" |

## 8. Acceptance criteria

### WRG-AC-01 — Register a watch-only wallet
Given a user with `wallet.create`
When they register a valid Devnet address as watch-only with a label and category
Then the wallet is stored for the active organization with custody `WATCH_ONLY`, the user holds `CREATOR`, a sync state exists, `wallet.created` is audited, and an initial sync job is enqueued.

### WRG-AC-02 — Register with proof of control
Given a user with `wallet.create` and a wallet they control
When they request an ownership challenge, sign it with that wallet, and register it as `BROWSER_WALLET` or `LOCAL_ENCRYPTED`
Then the wallet is registered as in WRG-AC-01 and the challenge is consumed.

### WRG-AC-03 — Ownership proof is enforced
Given a registration claiming `BROWSER_WALLET` or `LOCAL_ENCRYPTED`
When the signature is missing or invalid, the challenge is expired, consumed, or bound to another user, organization, address, or cluster
Then the API returns `WALLET_OWNERSHIP_UNVERIFIED`, nothing is stored, and `wallet.registration_rejected` is audited with the reason.

### WRG-AC-04 — Registration validation
Given a registration request
When the address is invalid, already registered in the organization on this cluster, the label is empty or too long, a tag is malformed, more than 10 tags are given, `category = WATCH_ONLY` is combined with a custody type other than `WATCH_ONLY`, or the organization already holds 500 active wallets
Then the API returns `WALLET_ADDRESS_INVALID`, `WALLET_ALREADY_REGISTERED`, `VALIDATION_FAILED`, or `OPERATION_NOT_ALLOWED` respectively and nothing is stored.

### WRG-AC-05 — Signing in does not register
Given a user who signed in with a wallet
When they open the registry
Then that wallet is not listed until they explicitly register it.

### WRG-AC-06 — List with balances
Given registered wallets in the organization
When a user with `wallet.read` lists them
Then only the active organization's wallets on the API cluster are returned, newest first, filtered by status, category, custody type, tag, and label/address search, paginated by cursor, with tags, assignments, the caller's roles, sync state, and `balances` as a `Sourced` value from one `getMultipleAccounts` call; an unfunded address shows `0`; when the RPC fails, `balances` is `UNAVAILABLE` and the list is still returned.

### WRG-AC-07 — Detail and isolation
Given a wallet registered in organization A
When a member of organization A requests it, and when a member of organization B requests the same id
Then A receives the wallet with tags, assignments, and sync state, and B receives `404 WALLET_NOT_FOUND`.

### WRG-AC-08 — Update metadata
Given a registered wallet
When a user with `wallet.create` changes its label, purpose, category, tags, notes, or status
Then the change is persisted, `wallet.updated` is audited with the changed field names, attempts to change address, cluster, or custody type are rejected with `VALIDATION_FAILED`, and archived wallets are excluded from the default list and from synchronization until restored.

### WRG-AC-09 — Assignments
Given a registered wallet and an active member
When a user with `organization.manage` assigns or removes a role
Then the assignment is stored or removed, `wallet.assigned` or `wallet.unassigned` is audited, assigning a user without an active membership is refused with `VALIDATION_FAILED`, and users without `organization.manage` receive `403 FORBIDDEN`.

### WRG-AC-10 — Authorization matrix
Given each registry route
When it is called without a session, without the required permission, or without a CSRF token on a state-changing route
Then it returns `401 UNAUTHENTICATED`, `403 FORBIDDEN` (audited as `authorization.denied`), or `403 CSRF_TOKEN_INVALID`.

### WRG-AC-11 — Incremental synchronization
Given a registered wallet with Devnet history
When the sync job runs repeatedly
Then new signatures are indexed newest first without duplicates, older signatures are backfilled up to 1,000 per wallet, fee and SOL change are filled for up to 10 transactions per run from `getTransaction`, and `lastSuccessAt` advances.

### WRG-AC-12 — Synchronization failure
Given the RPC fails during a sync job
When the job ends
Then the sync state records `lastFailureAt` and the classified reason, previously indexed rows are untouched, the next sweep retries, and the terminal shows the failure with the last successful sync time.

### WRG-AC-13 — Indexed history
Given an indexed wallet
When a user with `wallet.read` opens its history
Then transactions are listed newest first with signature, slot, block time (or "Unknown"), status, fee, SOL change (or "Not yet indexed"), sanitized memo, and an explorer link with the cluster, paginated by cursor, with the coverage label ("Indexed since …", and "Older history is not indexed." when the cap is reached).

### WRG-AC-14 — Manual sync throttle
Given a wallet whose sync was requested less than 30 s ago
When **Sync now** is requested again
Then no second job is enqueued and the API responds with `enqueued: false` and `retryAfterMs`; only an enqueued request is audited as `wallet.sync_requested`.

### WRG-AC-15 — Registry UI
Given the terminal
When a user with `wallet.read` opens **Wallets**
Then the list shows label, short address, category, custody type, tags, SOL balance with provenance and freshness, and sync status; users with `wallet.create` see **Register connected wallet**, **Create local wallet**, and **Add watch-only address**; loading, empty, filtered-empty, error, and unavailable states match §7; and the page passes axe checks.

## 9. Test plan

| Criterion | Test layer | Notes |
| --- | --- | --- |
| WRG-AC-01..04, 06..10, 14 | API integration (PostgreSQL + Redis + stub RPC) | Generated authorization matrix over every `/wallets` route |
| WRG-AC-03 | Unit (challenge rules) + integration | Expired, consumed, wrong binding, bad signature |
| WRG-AC-04, 08 | Unit (domain validation) | Label, tags, category/custody invariant |
| WRG-AC-05 | Integration | Sign in, list is empty |
| WRG-AC-11, 12 | Worker integration (stub RPC) + Devnet opt-in | Paging, upsert idempotency, failure bookkeeping |
| WRG-AC-13, 15 | E2E (test wallet, real Devnet) | Register connected, watch-only; history panel |

## 10. Open questions

- Per-wallet authorization beyond organization permissions (e.g. only `VIEWER`s may see a wallet). Iteration 08 decides; until then organization permissions govern visibility and assignments govern who may initiate transactions (SPEC-004 amendment).
- Real-time updates (WebSocket subscriptions) instead of a 60 s sweep. Deferred until the Helius decision (D-06).

## Amendments

_None._
