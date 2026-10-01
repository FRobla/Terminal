import type { Cluster } from "@sct/network";
import type { TransactionState } from "@sct/validation";

/** Opaque database transaction handle passed between repositories within one unit of work. */
export type DatabaseTransaction = unknown;

export interface UnitOfWork {
  run<T>(work: (transaction: DatabaseTransaction) => Promise<T>): Promise<T>;
}

/** SPEC-004 §3 — the persisted record. JSON fields are validated by the repository. */
export interface TransactionRecord {
  id: string;
  organizationId: string;
  initiatedByUserId: string;
  walletId: string;
  cluster: Cluster;
  purpose: "sol-transfer";
  state: TransactionState;
  feePayer: string;
  signers: string[];
  intent: { destination: string; lamports: string };
  /** Expected SOL deltas as decimal strings, keyed by account. */
  expectedEffects: Record<string, string>;
  review: Record<string, unknown> | null;
  simulationResult: Record<string, unknown> | null;
  messageBytes: Uint8Array;
  messageHash: Uint8Array;
  unsignedTransaction: Uint8Array;
  signedTransaction: Uint8Array | null;
  recentBlockhash: string;
  lastValidBlockHeight: bigint;
  signature: string | null;
  failure: { reason: string; message: string } | null;
  reconciliation: Record<string, unknown> | null;
  idempotencyKey: string;
  lastSentAt: Date | null;
  submittedAt: Date | null;
  confirmedAt: Date | null;
  finalizedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type NewTransactionRecord = Omit<
  TransactionRecord,
  | "id"
  | "state"
  | "review"
  | "simulationResult"
  | "signedTransaction"
  | "signature"
  | "failure"
  | "reconciliation"
  | "lastSentAt"
  | "submittedAt"
  | "confirmedAt"
  | "finalizedAt"
  | "updatedAt"
>;

/** Fields a transition may set alongside the new state. */
export type TransactionPatch = Partial<
  Pick<
    TransactionRecord,
    | "expectedEffects"
    | "review"
    | "simulationResult"
    | "signedTransaction"
    | "signature"
    | "failure"
    | "reconciliation"
    | "lastSentAt"
    | "submittedAt"
    | "confirmedAt"
    | "finalizedAt"
  >
>;

export interface StateChangeRecord {
  fromState: TransactionState | null;
  toState: TransactionState;
  occurredAt: Date;
  requestId: string;
  details: Record<string, unknown>;
}

export interface TransactionStore {
  insert(record: NewTransactionRecord, transaction: DatabaseTransaction): Promise<string>;
  find(transactionId: string, transaction?: DatabaseTransaction): Promise<TransactionRecord | null>;
  /** Applies the change only while the record is still in `from`; false when another writer moved it first. */
  compareAndSet(
    transactionId: string,
    from: TransactionState,
    to: TransactionState,
    patch: TransactionPatch,
    at: Date,
    transaction: DatabaseTransaction,
  ): Promise<boolean>;
  appendStateChange(
    transactionId: string,
    change: StateChangeRecord,
    transaction: DatabaseTransaction,
  ): Promise<void>;
  history(transactionId: string): Promise<StateChangeRecord[]>;
  /** Records in the given states on the cluster, oldest first. */
  listInStates(
    states: readonly TransactionState[],
    cluster: Cluster,
    limit: number,
  ): Promise<TransactionRecord[]>;
  /** Updates bookkeeping that is not a state change (e.g. the last re-broadcast time). */
  touch(transactionId: string, patch: Pick<TransactionPatch, "lastSentAt">): Promise<void>;
}
