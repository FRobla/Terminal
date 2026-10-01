# SPEC-004 — Transaction Lifecycle

| Field | Value |
| --- | --- |
| Status | IMPLEMENTED (SOL transfer, Iteration 02; see Amendments) |
| Iteration | 02 |
| Domain(s) | `transactions` (used by `wallets`, `trading`, `token-studio`) |
| Criteria prefix | `TXL` |
| Related | SPEC-005, SPEC-009, SPEC-010, SECURITY.md §3, ADR-0004 |

## 1. Problem and goal

Every transaction the terminal prepares must be traceable from intent to reconciled on-chain state. `sendTransaction` success is not proof that the business operation completed. The lifecycle is an explicit, persisted state machine.

## 2. State machine

```
DRAFT
  └─► SIMULATING ──► SIMULATED ──► AWAITING_SIGNATURE ──► SIGNING ──► SUBMITTED ──► CONFIRMING ──► CONFIRMED ──► RECONCILED
          │                               │                  │            │              │              │
          ▼                               ▼                  ▼            ▼              ▼              ▼
   SIMULATION_FAILED               CANCELLED          SIGNING_FAILED  SUBMISSION_FAILED  EXPIRED   RECONCILIATION_REQUIRED
                                                                                    CONFIRMATION_FAILED      │
                                                                                                             ▼
                                                                                              RECONCILED | RECONCILIATION_FAILED
```

| State | Meaning | Terminal? |
| --- | --- | --- |
| `DRAFT` | Intent captured; instructions built; not yet simulated | No |
| `SIMULATING` | `simulateTransaction` in progress | No |
| `SIMULATED` | Simulation succeeded; expected effects computed | No |
| `SIMULATION_FAILED` | Simulation returned an error or effects violate expectations | Yes |
| `AWAITING_SIGNATURE` | User reviewing the human-readable summary | No |
| `CANCELLED` | User declined before signing | Yes |
| `SIGNING` | Wallet signature requested | No |
| `SIGNING_FAILED` | Wallet rejected or errored | Yes |
| `SUBMITTED` | Signed transaction sent; signature known | No |
| `SUBMISSION_FAILED` | Send failed (preflight or network) and the transaction cannot land | Yes |
| `CONFIRMING` | Awaiting target commitment | No |
| `EXPIRED` | Blockhash expired (block height exceeded `lastValidBlockHeight`) without landing | Yes |
| `CONFIRMATION_FAILED` | Landed with an on-chain error | Yes |
| `CONFIRMED` | Landed successfully at `confirmed`; awaiting `finalized` + reconciliation | No |
| `RECONCILED` | Finalized, and observed state matches expected effects | Yes |
| `RECONCILIATION_REQUIRED` | Observed state diverges from expected effects or from application state | No (needs action) |
| `RECONCILIATION_FAILED` | Reconciliation could not be completed (e.g. data unavailable after retries) | Yes (alerted) |

Transitions are validated by a pure domain function; illegal transitions throw a domain error and are logged.

## 3. Transaction record

Every transaction record stores: `id`, `organizationId`, `initiatedByUserId`, `cluster`, `purpose` (e.g. `sol-transfer`, `swap`, `token-create`), `feePayer`, `signers[]`, `instructionsSummary` (decoded programs, accounts, writable flags), `expectedEffects` (SOL and token deltas per account), `recentBlockhash`, `lastValidBlockHeight`, `simulationResult` (logs, units consumed, error), `signature`, `state`, `stateHistory[]` (state, at, requestId, details), `idempotencyKey`, timestamps.

## 4. Rules

1. Cluster of the record must equal the API cluster at every transition.
2. Simulation is mandatory where supported; a transaction cannot reach `AWAITING_SIGNATURE` without `SIMULATED`.
3. The review shown to the user is generated server-side from the decoded transaction, not from client-supplied descriptions.
4. Unknown programs are labeled `UNKNOWN PROGRAM`; the user must acknowledge them explicitly.
5. The bytes signed by the wallet must match the bytes reviewed (message hash compared before submission).
6. Submission is idempotent by `idempotencyKey` and by signature.
7. Confirmation is monitored by the worker using `getSignatureStatuses` and block height; no client-side-only confirmation.
8. Reconciliation compares finalized balances/accounts with `expectedEffects` and with application state; divergence → `RECONCILIATION_REQUIRED` + alert.
9. Every transition produces an audit event (`transaction.prepared`, `transaction.simulated`, `transaction.signed`, `transaction.submitted`, `transaction.confirmed`, `transaction.failed`, `transaction.reconciled`, `transaction.reconciliation_required`).

## 5. Acceptance criteria (draft)

- **TXL-AC-01** Illegal transitions are rejected by the domain state machine (exhaustive transition table test).
- **TXL-AC-02** A transaction cannot be presented for signature without a successful simulation.
- **TXL-AC-03** The review screen lists cluster, fee payer, signers, programs (unknown labeled), writable accounts, expected SOL/token movements, fee estimate, and simulation result.
- **TXL-AC-04** Submitting twice with the same idempotency key yields one on-chain submission.
- **TXL-AC-05** A transaction whose blockhash expires without landing ends in `EXPIRED`, not `SUBMISSION_FAILED` or `CONFIRMED`.
- **TXL-AC-06** A transaction landing with an on-chain error ends in `CONFIRMATION_FAILED` with the decoded error.
- **TXL-AC-07** After finalization, observed balances matching expected effects produce `RECONCILED`; mismatches produce `RECONCILIATION_REQUIRED` and an alert.
- **TXL-AC-08** A record whose cluster differs from the API cluster cannot transition.
- **TXL-AC-09** Every transition is audited with request id.

## 6. Open questions

- Priority fee strategy on Devnet (likely none by default; compute budget instructions only where needed).
- Durable nonces for long-running approvals (future corporate approval workflows).

## Amendments

### 2026-10-01 — Iteration 02: ready for implementation with SOL transfer as the first flow

Reason: Iteration 02 implements the lifecycle with SOL transfer as its first write flow (ADR-0004, checklist). The draft left the API shape, the signing hand-off, the worker design, and the open questions unresolved. Criteria TXL-AC-01..09 are unchanged in intent; TXL-AC-07 is clarified, and TXL-AC-10..15 are added.

**Open questions resolved.**
- Priority fees: none on Devnet. Transactions contain no compute-budget instructions; the fee is the base fee from `getFeeForMessage`.
- Durable nonces: not used. Every transaction uses a recent blockhash (`getLatestBlockhash`, `confirmed`) and its `lastValidBlockHeight`.

**SOL transfer flow.**
1. `POST /transactions/sol-transfers { sourceWalletId, destination, lamports, idempotencyKey }` (decimal-string lamports, `idempotencyKey` 16–128 characters).
   - Requires `wallet.control` and a `CREATOR` or `CONTROLLER` assignment on the source wallet (SPEC-009). The source must be an active registered wallet with custody `BROWSER_WALLET` or `LOCAL_ENCRYPTED` on the API cluster; `WATCH_ONLY` sources are refused with `OPERATION_NOT_ALLOWED`.
   - The destination must be a valid address different from the source; `lamports` must be > 0 and ≤ 2^63−1.
   - The cluster must be verified (`CLUSTER_VERIFICATION_FAILED` otherwise).
2. The API creates the record in `DRAFT` (purpose `sol-transfer`, fee payer and only signer = source), builds a version-0 transaction message with one System Program `Transfer` instruction, and stores the exact message bytes and their SHA-256 hash.
3. `SIMULATING` → `simulateTransaction` (`sigVerify: false`, `replaceRecentBlockhash: false`, `commitment: confirmed`, post-state of source and destination accounts). Success → `SIMULATED` with logs, units consumed, and the post-simulation lamports; error → `SIMULATION_FAILED` with the decoded error (e.g. insufficient funds, insufficient funds for rent).
4. Expected effects: source `−(lamports + fee)`, destination `+lamports`. If the simulated post-balances disagree, the record goes to `SIMULATION_FAILED` with reason `EFFECTS_MISMATCH`.
5. `SIMULATED` → `AWAITING_SIGNATURE`. The response carries the record, the server-built review (TXL-AC-03), and `transactionBase64` (the wire transaction with an empty signature slot) for the wallet.
6. The terminal shows the review. **Cancel** → `POST /transactions/{id}/cancel` → `CANCELLED`. **Sign** → `POST /transactions/{id}/signing { acknowledgeUnknownPrograms }` → `SIGNING`; the wallet signs through the signing boundary (Wallet Standard `solana:signTransaction`, or the local key per SPEC-010). A rejection or wallet error → `POST /transactions/{id}/signing-failed { reason }` → `SIGNING_FAILED`.
7. `POST /transactions/{id}/submit { signedTransactionBase64 }`:
   - The API decodes the transaction and requires that its message bytes hash to the stored hash (rule 5; `TRANSACTION_MESSAGE_MISMATCH` otherwise, with the record moved to `SIGNING_FAILED`) and that the fee payer's signature verifies.
   - It records the signature, sends with `sendTransaction` (`skipPreflight: false`, `preflightCommitment: confirmed`, `maxRetries: 0`), and moves to `SUBMITTED`.
   - A definitive preflight rejection → `SUBMISSION_FAILED` with the decoded error. An ambiguous network failure keeps `SUBMITTED`, because the signature may still land; the worker decides between `CONFIRMED`, `CONFIRMATION_FAILED`, and `EXPIRED`.
   - Repeating the call for a record already past `SIGNING` returns the current record without sending again.
8. The API enqueues an immediate confirmation sweep after submission.

**Worker (queues `transactions.confirmation` and `transactions.reconciliation`).**
- *Confirmation sweep* (job scheduler every 3 s, plus on-demand jobs with deterministic ids):
  - Loads records in `SUBMITTED` or `CONFIRMING` on the worker cluster and moves `SUBMITTED` → `CONFIRMING`.
  - Calls `getSignatureStatuses` (batches of ≤ 256, `searchTransactionHistory: false`) and `getBlockHeight` (`confirmed`).
  - Status `confirmed`/`finalized` without error → `CONFIRMED`. With error → `CONFIRMATION_FAILED` with the decoded instruction error. No status and block height > `lastValidBlockHeight` → `EXPIRED`.
  - While a record is `SUBMITTED`/`CONFIRMING` and the blockhash is still valid, the sweep re-sends the stored signed transaction at most every 2 s (`maxRetries: 0`), as recommended for `maxRetries: 0` senders.
- *Reconciliation sweep* (every 10 s): loads `CONFIRMED` records and checks `getSignatureStatuses` for `finalized`.
  - Once finalized, reads `getTransaction` (`finalized`) and compares the source and destination balance deltas (`meta.preBalances`/`postBalances`, fee from `meta.fee`) with the expected effects.
  - Match → `RECONCILED`. Mismatch → `RECONCILIATION_REQUIRED` with both values.
  - Data unavailable for 10 minutes after confirmation → `RECONCILIATION_FAILED`.
- Each transition is idempotent: a transition is applied with a compare-and-set on the current state, so concurrent sweeps cannot apply it twice.
- Until alerts exist (Iteration 07), the "alert" for `RECONCILIATION_REQUIRED` and `RECONCILIATION_FAILED` is an audit event with result `failure`, a structured log at `error` level, and a visible state in the terminal.

**Other endpoints.**
- `GET /transactions?walletId=&state=&cursor=` and `GET /transactions/{id}` require `wallet.read`. They return records of the active organization on the API cluster with the review and the state history.

**Audit.**
- Signatures are audited under the metadata key `txSignature`, because `signature` is in the audit denylist (AUD-AC-03).
- Actions, one action per target state: `transaction.prepared` (DRAFT), `transaction.simulation_requested` (SIMULATING), `transaction.simulated` (SIMULATED), `transaction.review_ready` (AWAITING_SIGNATURE), `transaction.signing_requested` (SIGNING), `transaction.cancelled` (CANCELLED), `transaction.submitted` (SUBMITTED; the signature is verified at this step, so there is no separate `transaction.signed`), `transaction.confirming` (CONFIRMING), `transaction.confirmed` (CONFIRMED), `transaction.reconciled` (RECONCILED), `transaction.reconciliation_required` (RECONCILIATION_REQUIRED, result `failure`), and `transaction.failed` for every failure state (metadata `to` names the state and `reason` the cause). All share the metadata `from`, `to`, `purpose`, `walletId`, optional `txSignature` and `reason`.
- Worker transitions are audited with actor type `system` and the job request id.

**Persistence.**
- `transaction_records` holds the record (§3), the stored message bytes and hash, the signed wire transaction after submission, the expected effects, the simulation result, and the review. Its `state` column changes only through the domain transition function.
- `transaction_state_transitions` is append-only history (from, to, at, request id, details).
- `idempotency_keys` holds `(organization_id, user_id, scope, key)` unique, the request hash, and the resulting record id.

**Clarified criterion.**
- **TXL-AC-07** (clarified): "an alert" means the interim alert defined above until Iteration 07.

**New criteria.**
- **TXL-AC-10** — Only a holder of `wallet.control` with a `CREATOR` or `CONTROLLER` assignment on an active `BROWSER_WALLET` or `LOCAL_ENCRYPTED` source wallet can prepare a SOL transfer; other requests return `403 FORBIDDEN` or `OPERATION_NOT_ALLOWED` and create no record.
- **TXL-AC-11** — A SOL transfer whose simulation fails (e.g. insufficient funds, or rent for a new destination) ends in `SIMULATION_FAILED` with the decoded error and cannot be signed or submitted.
- **TXL-AC-12** — Submitting a signed transaction whose message differs from the reviewed message is refused with `TRANSACTION_MESSAGE_MISMATCH`, nothing is sent, and the record ends in `SIGNING_FAILED`.
- **TXL-AC-13** — Cancelling from `AWAITING_SIGNATURE` ends in `CANCELLED`; a wallet rejection ends in `SIGNING_FAILED`; neither sends anything to the RPC.
- **TXL-AC-14** — A SOL transfer signed by a real Devnet wallet reaches `RECONCILED`, and the terminal shows the state timeline from `DRAFT` to `RECONCILED` with the signature's explorer link.
- **TXL-AC-15** — Reusing an idempotency key with a different request returns `IDEMPOTENCY_CONFLICT`; reusing it with the same request returns the original record.

### 2026-10-01 — Implementation details (Iteration 02)

Reason: decisions made while implementing the amendment above. No acceptance criterion changed.

- **Expiry before submission:** `AWAITING_SIGNATURE` and `SIGNING` may move to `EXPIRED`. When the current block height already exceeds `lastValidBlockHeight` at submission, the record becomes `EXPIRED` and nothing is sent.
- **Signature first, then send:** submission records the signed bytes and the signature, moves to `SUBMITTED`, and only then calls `sendTransaction`. If the process stops after sending, the worker still tracks and re-sends the transaction while its blockhash is valid.
- **Who may sign:** cancel, signing, signing-failed, and submit are allowed only for the user who prepared the transaction (`OPERATION_NOT_ALLOWED` for other members; `TRANSACTION_NOT_FOUND` for other organizations). An operation that does not fit the current state returns `TRANSACTION_STATE_CONFLICT`.
- **Sign-and-send wallets:** wallets that only offer `solana:signAndSendTransaction` are refused, because they would broadcast without the API's checks.
- **Shared lifecycle code:** the state machine, the transition recorder, and the repositories live in `@sct/transactions` and are used by both the API and the worker (ADR-0010).
- **Verified on Devnet:** simulated post-balances include both the amount and the base fee (Devnet opt-in test, 2026-10-01).
