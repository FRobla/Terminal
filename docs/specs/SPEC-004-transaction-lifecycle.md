# SPEC-004 — Transaction Lifecycle

| Field | Value |
| --- | --- |
| Status | DRAFT (implementation in Iteration 02) |
| Iteration | 02 |
| Domain(s) | `transactions` (used by `wallets`, `trading`, `token-studio`) |
| Criteria prefix | `TXL` |
| Related | SPEC-005, SECURITY.md §3, ADR-0004 |

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

_None._
