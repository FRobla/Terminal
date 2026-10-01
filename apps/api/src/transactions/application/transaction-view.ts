import type { TransactionRecord, TransactionStore } from "@sct/transactions";
import { reconciliationSchema, transactionReviewSchema, type TransactionRecordView } from "@sct/validation";
import type { TransactionDirectory } from "./ports";

const AWAITING_SIGNATURE_STATES = new Set(["AWAITING_SIGNATURE", "SIGNING"]);

/** API representation of a transaction with its state history (SPEC-004 §3). */
export async function toTransactionView(
  record: TransactionRecord,
  deps: { store: TransactionStore; directory: TransactionDirectory },
): Promise<TransactionRecordView> {
  const [history, listing] = await Promise.all([
    deps.store.history(record.id),
    deps.directory.describe(record.id),
  ]);
  const review = record.review ? transactionReviewSchema.safeParse(record.review) : null;
  const reconciliation = record.reconciliation ? reconciliationSchema.safeParse(record.reconciliation) : null;
  return {
    id: record.id,
    walletId: record.walletId,
    walletLabel: listing?.walletLabel ?? "",
    cluster: record.cluster,
    purpose: record.purpose,
    state: record.state,
    feePayer: record.feePayer,
    intent: record.intent,
    review: review?.success ? review.data : null,
    signature: record.signature,
    failure: record.failure,
    reconciliation: reconciliation?.success ? reconciliation.data : null,
    unsignedTransactionBase64: AWAITING_SIGNATURE_STATES.has(record.state)
      ? Buffer.from(record.unsignedTransaction).toString("base64")
      : null,
    initiatedBy: listing?.initiatedBy ?? { id: record.initiatedByUserId, displayName: null },
    stateHistory: history.map((change) => ({
      from: change.fromState,
      to: change.toState,
      at: change.occurredAt.toISOString(),
      requestId: change.requestId,
      details: change.details,
    })),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
