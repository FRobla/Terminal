import type { AuditAction, AuditLog } from "@sct/audit";
import type { Cluster } from "@sct/network";
import { currentRequestContext } from "@sct/observability";
import type { TransactionState } from "@sct/validation";
import { assertTransition, FAILURE_STATES } from "../domain/transaction-state";
import type {
  NewTransactionRecord,
  TransactionPatch,
  TransactionRecord,
  TransactionStore,
  UnitOfWork,
} from "./ports";

/** Who caused a transition: a signed-in user (API) or the system (worker sweeps). */
export type TransitionActor =
  | {
      type: "user";
      userId: string;
      organizationId: string;
      ipAddress: string | null;
      userAgent: string | null;
    }
  | { type: "system" };

const ACTION_BY_STATE: Record<TransactionState, AuditAction> = {
  DRAFT: "transaction.prepared",
  SIMULATING: "transaction.simulation_requested",
  SIMULATED: "transaction.simulated",
  SIMULATION_FAILED: "transaction.failed",
  AWAITING_SIGNATURE: "transaction.review_ready",
  CANCELLED: "transaction.cancelled",
  SIGNING: "transaction.signing_requested",
  SIGNING_FAILED: "transaction.failed",
  SUBMITTED: "transaction.submitted",
  SUBMISSION_FAILED: "transaction.failed",
  CONFIRMING: "transaction.confirming",
  EXPIRED: "transaction.failed",
  CONFIRMATION_FAILED: "transaction.failed",
  CONFIRMED: "transaction.confirmed",
  RECONCILED: "transaction.reconciled",
  RECONCILIATION_REQUIRED: "transaction.reconciliation_required",
  RECONCILIATION_FAILED: "transaction.failed",
};

/**
 * SPEC-004 — the single writer of transaction state. Each transition is checked by the
 * domain (TXL-AC-01, TXL-AC-08), applied with compare-and-set, appended to the history,
 * and audited with the request id (TXL-AC-09), all in one database transaction.
 */
export class TransactionTransitions {
  constructor(
    private readonly config: { cluster: Cluster },
    private readonly deps: {
      unitOfWork: UnitOfWork;
      store: TransactionStore;
      audit: AuditLog;
      now?: () => Date;
    },
  ) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private requestId(): string {
    return currentRequestContext()?.requestId ?? "system";
  }

  find(transactionId: string): Promise<TransactionRecord | null> {
    return this.deps.store.find(transactionId);
  }

  /**
   * Inserts the record in `DRAFT`. `alongside` runs in the same database transaction
   * (e.g. to claim an idempotency key), so both are stored or neither is.
   */
  async create(
    record: NewTransactionRecord,
    actor: TransitionActor,
    alongside?: (transactionId: string, transaction: unknown) => Promise<void>,
  ): Promise<TransactionRecord> {
    if (record.cluster !== this.config.cluster) {
      throw new Error(`Cannot create a ${record.cluster} transaction in a ${this.config.cluster} process`);
    }
    const id = await this.deps.unitOfWork.run(async (transaction) => {
      const transactionId = await this.deps.store.insert(record, transaction);
      await alongside?.(transactionId, transaction);
      await this.deps.store.appendStateChange(
        transactionId,
        {
          fromState: null,
          toState: "DRAFT",
          occurredAt: record.createdAt,
          requestId: this.requestId(),
          details: {},
        },
        transaction,
      );
      await this.audit(
        {
          id: transactionId,
          organizationId: record.organizationId,
          walletId: record.walletId,
          purpose: record.purpose,
        },
        null,
        "DRAFT",
        actor,
        {},
        transaction,
      );
      return transactionId;
    });
    const created = await this.deps.store.find(id);
    if (!created) throw new Error("The transaction record could not be read back");
    return created;
  }

  /**
   * Moves `record` to `to`. Returns the updated record, or null when another writer
   * changed the state first (the caller re-reads and decides).
   */
  async apply(
    record: TransactionRecord,
    to: TransactionState,
    options: {
      actor: TransitionActor;
      patch?: TransactionPatch;
      details?: Record<string, unknown>;
      reason?: string;
    },
  ): Promise<TransactionRecord | null> {
    assertTransition(record, to, this.config.cluster);
    const at = this.now();
    const patch = options.patch ?? {};
    const applied = await this.deps.unitOfWork.run(async (transaction) => {
      const changed = await this.deps.store.compareAndSet(
        record.id,
        record.state,
        to,
        patch,
        at,
        transaction,
      );
      if (!changed) return false;
      await this.deps.store.appendStateChange(
        record.id,
        {
          fromState: record.state,
          toState: to,
          occurredAt: at,
          requestId: this.requestId(),
          details: { ...(options.details ?? {}), ...(options.reason ? { reason: options.reason } : {}) },
        },
        transaction,
      );
      await this.audit(
        record,
        record.state,
        to,
        options.actor,
        {
          ...((patch.signature ?? record.signature)
            ? { txSignature: patch.signature ?? record.signature ?? "" }
            : {}),
          ...(options.reason ? { reason: options.reason.slice(0, 200) } : {}),
        },
        transaction,
      );
      return true;
    });
    return applied ? this.deps.store.find(record.id) : null;
  }

  private async audit(
    subject: Pick<TransactionRecord, "id" | "organizationId" | "walletId" | "purpose">,
    from: TransactionState | null,
    to: TransactionState,
    actor: TransitionActor,
    extra: { txSignature?: string; reason?: string },
    transaction: unknown,
  ): Promise<void> {
    const failed = FAILURE_STATES.includes(to) || to === "RECONCILIATION_REQUIRED";
    await this.deps.audit.record(
      {
        action: ACTION_BY_STATE[to],
        resourceType: "transaction",
        resourceId: subject.id,
        result: failed ? "failure" : "success",
        cluster: this.config.cluster,
        ...(actor.type === "user"
          ? {
              actorType: "user" as const,
              actorId: actor.userId,
              organizationId: actor.organizationId,
              ipAddress: actor.ipAddress,
              userAgent: actor.userAgent,
            }
          : // Worker transitions stay visible in the organization's audit log.
            { actorType: "system" as const, organizationId: subject.organizationId }),
        metadata: { from, to, purpose: subject.purpose, walletId: subject.walletId, ...extra },
      },
      transaction,
    );
  }
}
