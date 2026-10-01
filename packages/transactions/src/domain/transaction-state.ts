/** SPEC-004 §2 — the persisted transaction lifecycle. Never collapsed into a boolean. */
import type { TransactionState } from "@sct/validation";

export { TRANSACTION_STATES, type TransactionState } from "@sct/validation";

/**
 * Allowed transitions. `AWAITING_SIGNATURE` and `SIGNING` may also expire: a blockhash
 * that becomes invalid before submission is recorded as `EXPIRED`, and nothing is sent
 * (SPEC-004 amendment 2026-10-01).
 */
export const TRANSITIONS: Readonly<Record<TransactionState, readonly TransactionState[]>> = {
  DRAFT: ["SIMULATING"],
  SIMULATING: ["SIMULATED", "SIMULATION_FAILED"],
  SIMULATED: ["AWAITING_SIGNATURE", "SIMULATION_FAILED"],
  SIMULATION_FAILED: [],
  AWAITING_SIGNATURE: ["SIGNING", "CANCELLED", "EXPIRED"],
  CANCELLED: [],
  SIGNING: ["SUBMITTED", "SIGNING_FAILED", "EXPIRED"],
  SIGNING_FAILED: [],
  SUBMITTED: ["CONFIRMING", "SUBMISSION_FAILED"],
  SUBMISSION_FAILED: [],
  CONFIRMING: ["CONFIRMED", "CONFIRMATION_FAILED", "EXPIRED"],
  EXPIRED: [],
  CONFIRMATION_FAILED: [],
  CONFIRMED: ["RECONCILED", "RECONCILIATION_REQUIRED", "RECONCILIATION_FAILED"],
  RECONCILED: [],
  RECONCILIATION_REQUIRED: ["RECONCILED", "RECONCILIATION_FAILED"],
  RECONCILIATION_FAILED: [],
};

export function isTerminalState(state: TransactionState): boolean {
  return TRANSITIONS[state].length === 0;
}

export const FAILURE_STATES: readonly TransactionState[] = [
  "SIMULATION_FAILED",
  "CANCELLED",
  "SIGNING_FAILED",
  "SUBMISSION_FAILED",
  "EXPIRED",
  "CONFIRMATION_FAILED",
  "RECONCILIATION_FAILED",
];

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: TransactionState,
    readonly to: TransactionState,
  ) {
    super(`Illegal transaction transition ${from} → ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export class TransactionClusterMismatchError extends Error {
  constructor(
    readonly recordCluster: string,
    readonly processCluster: string,
  ) {
    super(`Transaction on ${recordCluster} cannot transition in a process configured for ${processCluster}`);
    this.name = "TransactionClusterMismatchError";
  }
}

/** TXL-AC-01, TXL-AC-08 — the only gate every state change passes through. */
export function assertTransition(
  record: { state: TransactionState; cluster: string },
  to: TransactionState,
  processCluster: string,
): void {
  if (record.cluster !== processCluster)
    throw new TransactionClusterMismatchError(record.cluster, processCluster);
  if (!TRANSITIONS[record.state].includes(to)) throw new IllegalTransitionError(record.state, to);
}
