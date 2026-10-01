# ADR-0010 — Shared Audit and Transaction Lifecycle Packages

Status: Accepted
Date: 2026-10-01

## Context

Iteration 02 adds the transaction lifecycle (SPEC-004). Two processes apply its transitions:

- The **API** prepares, simulates, cancels, records signing, and submits.
- The **worker** confirms, expires, and reconciles (ADR-0007, SPEC-004 rule 7).

Both processes must:

- use the same state machine, because illegal transitions are rejected by one pure function (TXL-AC-01);
- persist transitions the same way (compare-and-set on the current state, plus an append-only history row);
- audit every transition with the same action catalog and metadata sanitization (TXL-AC-09, AUD-AC-03).

Until now the audit catalog and writer lived in `apps/api/src/audit`. Apps never import other apps, so the worker could not use them.

## Decision

- **`packages/audit` (`@sct/audit`)** holds:
  - the audit action catalog with per-action metadata schemas and the denylist sanitizer;
  - `AuditLog`;
  - the audit record and writer port;
  - the Drizzle writer.

  The API keeps its audit HTTP routes and the reader used by the audit viewer.
- **`packages/transactions` (`@sct/transactions`)** holds:
  - `domain/`: the state machine, expected effects, the known-program registry, and the review model;
  - `application/`: the transition recorder and its ports;
  - `infrastructure/`: the Drizzle repositories for transaction records, transitions, and idempotency keys.

  Flows stay in the apps that own them: the SOL transfer API in `apps/api/src/transactions`, and the confirmation and reconciliation sweeps in `apps/worker/src/transactions`.
- **Transaction building, decoding, and the chain adapters** (blockhash, fee, simulation, send, statuses, block height) live in `packages/solana/src/transactions`, next to the existing readers.

## Alternatives considered

- **API-only lifecycle, with the worker calling an internal API:** this adds an authenticated internal surface and a network hop to every confirmation, and the worker would still need its own audit identity.
- **Duplicating the state machine and audit writer in the worker:** two sources of truth for a safety-critical state machine.
- **Moving all domain code into one shared package:** this conflicts with screaming architecture (ADR-0002). Only the code both processes need is shared.

## Consequences

- API and worker import the same lifecycle and audit code, and dependency-cruiser keeps packages free of app imports.
- `apps/api/src/audit` keeps only HTTP routes and the reader.
- New shared packages follow the same rules as other packages: no `utils` modules, and domain code stays framework-free.
