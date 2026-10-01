# Specifications

Specifications are the anchor for implementation. Code is not the source of truth for intended behavior; the spec is. Specs, acceptance criteria, tests, and implementation stay synchronized.

## Lifecycle

| Status | Meaning |
| --- | --- |
| `DRAFT` | Being written; not implementable yet |
| `READY` | Reviewed; acceptance criteria are stable enough to implement |
| `IN PROGRESS` | Being implemented in the current iteration |
| `IMPLEMENTED` | All acceptance criteria pass |
| `SUPERSEDED` | Replaced by another spec (link it) |

Amending a `READY` or later spec: append an entry to its **Amendments** section with date, reason, and the changed criteria. Never silently edit an acceptance criterion.

## Acceptance criteria IDs

Each spec defines a prefix (e.g. `WO` for Wallet Overview). Criteria are numbered `WO-AC-01`, `WO-AC-02`, … and never renumbered. Removed criteria are marked `(withdrawn)` with a reason. Tests reference these IDs in their names.

## Index

| Spec | Title | Prefix | Iteration | Status |
| --- | --- | --- | --- | --- |
| [SPEC-000](./SPEC-000-template.md) | Template | — | — | — |
| [SPEC-001](./SPEC-001-foundation.md) | Foundation | `FND` | 01 | IMPLEMENTED |
| [SPEC-002](./SPEC-002-wallet-overview.md) | Wallet Overview (first vertical slice) | `WO` | 01 | IMPLEMENTED |
| [SPEC-003](./SPEC-003-data-provenance.md) | Data provenance and availability | `PRV` | 01 | IMPLEMENTED |
| [SPEC-004](./SPEC-004-transaction-lifecycle.md) | Transaction lifecycle | `TXL` | 02 | DRAFT |
| [SPEC-005](./SPEC-005-network-safety.md) | Network safety | `NET` | 01 | IMPLEMENTED |
| [SPEC-006](./SPEC-006-provider-health.md) | Provider health and capability status | `PH` | 01 | IMPLEMENTED (RPC) |
| [SPEC-007](./SPEC-007-auth-and-rbac.md) | Authentication and RBAC | `AUTH` / `RBAC` | 01 (foundation) / 08 | IMPLEMENTED (foundation) |
| [SPEC-008](./SPEC-008-audit-logging.md) | Audit logging | `AUD` | 01 | IMPLEMENTED (foundation) |

## Definition of Done

A feature is **not** done because the page exists, the button exists, the API returns 200, or TypeScript compiles. A feature is done only when:

- [ ] Specification exists with acceptance criteria
- [ ] Implementation exists
- [ ] Domain logic is tested
- [ ] Loading, empty, and error states exist
- [ ] Security considerations are addressed
- [ ] Real data integration works (no mock data in runtime paths)
- [ ] Provider failures are handled and visible
- [ ] Audit requirements are addressed
- [ ] Documentation is updated
- [ ] `changelog.md` is updated
- [ ] `checklist.md` is updated
- [ ] Relevant tests pass
