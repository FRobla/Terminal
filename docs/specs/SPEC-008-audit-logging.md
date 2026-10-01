# SPEC-008 — Audit Logging

| Field | Value |
| --- | --- |
| Status | IMPLEMENTED (Iteration 01 foundation scope) |
| Iteration | 01 (foundation), extended by every later iteration |
| Domain(s) | `audit` |
| Criteria prefix | `AUD` |
| Related | SECURITY.md §7, SPEC-007 |

## 1. Problem and goal

Every sensitive action must leave an immutable, queryable record that answers who did what, to which resource, when, from where, with what result — without ever storing secrets.

## 2. Record

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID v7 | Time-ordered |
| `occurredAt` | timestamptz | Server time |
| `organizationId` | UUID, nullable | Null only for pre-membership events (e.g. failed login) |
| `actorType` | enum | `user`, `system`, `worker`, `anonymous` |
| `actorId` | UUID, nullable | User id when applicable |
| `action` | text | Dotted verb, from the catalog below |
| `resourceType` | text | e.g. `wallet`, `session`, `transaction`, `provider` |
| `resourceId` | text, nullable | e.g. address, transaction id |
| `result` | enum | `success`, `failure`, `denied` |
| `requestId` | text | Correlates with logs and traces |
| `ipAddress` | inet, nullable | Stored where appropriate (auth and sensitive actions) |
| `userAgent` | text, nullable | Truncated to 512 characters |
| `cluster` | enum, nullable | For Solana-related actions |
| `metadata` | jsonb | Sanitized, schema-validated per action; never secrets |

## 3. Rules

1. Audit writes for an action happen in the same database transaction as the action's state change where there is one; otherwise immediately after, with failure logged at `error` level and retried.
2. The application role cannot `UPDATE` or `DELETE` audit rows.
3. Each action has a Zod metadata schema; unknown keys are stripped. A denylist test ensures no key such as `privateKey`, `secretKey`, `seed`, `mnemonic`, `passphrase`, `password`, `signature` (of auth messages), `token`, `apiKey`, or `cookie` can be stored.
4. Reading the audit log requires `audit.read` and is scoped to the active organization.
5. Retention: indefinite during the MVP; a retention policy is required before Mainnet.

## 4. Action catalog

| Action | Iteration |
| --- | --- |
| `user.login`, `user.login_failed`, `user.logout` | 01 |
| `wallet.connected`, `wallet.connection_rejected` | 01 |
| `role.assigned`, `role.revoked`, `permission.changed` | 01 (bootstrap) / 08 |
| `provider.changed`, `provider.disabled`, `provider.enabled` | 01 (config) / 08 (UI) |
| `wallet.created`, `wallet.assigned`, `wallet.updated`, `wallet.exported` | 02 |
| `transaction.prepared`, `transaction.simulated`, `transaction.signed`, `transaction.submitted`, `transaction.confirmed`, `transaction.failed`, `transaction.reconciled`, `transaction.reconciliation_required` | 02 |
| `token.created`, `token.authority_changed`, `token.metadata_updated` | 05 |
| `alert.created`, `alert.updated`, `alert.deleted` | 07 |
| `organization.created`, `organization.updated`, `member.invited`, `member.removed`, `api_credential.created`, `api_credential.revoked` | 08 |

## 5. Acceptance criteria

### AUD-AC-01 — Required fields
Given any audited action
When it occurs
Then a record with `occurredAt`, `actorType`, `action`, `resourceType`, `result`, and `requestId` is persisted, and `organizationId`/`actorId` are present whenever known.

### AUD-AC-02 — Immutability
Given the application database role
When it attempts to update or delete an audit record
Then the database rejects it.

### AUD-AC-03 — No secrets
Given metadata containing a denylisted key
When the event is recorded
Then the key is not persisted (schema strips it and the denylist test passes for every action schema).

### AUD-AC-04 — Denied actions are audited
Given a request rejected by authorization for a sensitive action
When it is rejected
Then an event with `result: denied` is recorded.

### AUD-AC-05 — Scoped reading
Given a user with `audit.read` in organization A
When they list audit events
Then only organization A's events are returned, newest first, paginated.

## Amendments

- **2026-09-30 (Iteration 01):** added the action `authorization.denied` (resource `route`, metadata `requiredPermission`, `route`). The application role also lacks `TRUNCATE` on `audit_events`.
- **2026-10-01 (Iteration 01.5):** added actions (with metadata schemas) for user settings (SPEC-025) and the owner console (SPEC-026): `user.profile_updated`, `session.revoked`, `role.revoked`, `member.suspended`, `member.reactivated`, `user.disabled`, `user.enabled`, `organization.updated`, `announcement.updated`, `system.cluster_verification_requested`, `system.job_enqueued`, `system.cache_purged`. `role.revoked` and `organization.updated` move forward from Iteration 08. The audit log viewer for AUD-AC-05 is now available to the owner in the console (OWN-AC-09).
- **2026-10-01 (Iteration 02):** added actions with metadata schemas for the wallet registry (SPEC-009), local wallets (SPEC-010), and the transaction lifecycle (SPEC-004 amendment):
  - Wallet registry: `wallet.created`, `wallet.registration_rejected`, `wallet.updated`, `wallet.assigned`, `wallet.unassigned`, `wallet.sync_requested`, `wallet.exported`.
  - Transactions, one action per target state: `transaction.prepared` (DRAFT), `transaction.simulation_requested` (SIMULATING), `transaction.simulated` (SIMULATED), `transaction.review_ready` (AWAITING_SIGNATURE), `transaction.signing_requested` (SIGNING), `transaction.cancelled` (CANCELLED), `transaction.submitted` (SUBMITTED; the signature is verified at this step, so there is no separate `transaction.signed`), `transaction.confirming` (CONFIRMING), `transaction.confirmed` (CONFIRMED), `transaction.reconciled` (RECONCILED), `transaction.reconciliation_required` (RECONCILIATION_REQUIRED, result `failure`), and `transaction.failed` for every failure state (metadata `to` names the state and `reason` the cause). All share the metadata `from`, `to`, `purpose`, `walletId`, optional `txSignature` and `reason`.

  Transaction signatures are recorded under the metadata key `txSignature`; the denylisted key `signature` remains forbidden at any depth. Worker-applied transitions use actor type `system` with the job's request id.
