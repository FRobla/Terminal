import type { Cluster } from "@sct/network";
import type { Logger } from "@sct/observability";
import { isProviderError } from "@sct/providers";
import {
  solChangeOf,
  type ReadContext,
  type RpcReading,
  type SignatureStatus,
  type TransactionDetails,
} from "@sct/solana";
import {
  describeChainError,
  effectsMatch,
  toMovements,
  type TransactionRecord,
  type TransactionStore,
  type TransactionTransitions,
} from "@sct/transactions";

/** SPEC-004 amendment — worker cadence and limits. */
export const CONFIRMATION_SWEEP_INTERVAL_MS = 3_000;
export const RECONCILIATION_SWEEP_INTERVAL_MS = 10_000;
export const REBROADCAST_INTERVAL_MS = 2_000;
export const RECONCILIATION_DEADLINE_MS = 10 * 60_000;
const RECORDS_PER_SWEEP = 256;

export interface SweepChain {
  signatureStatuses(signatures: string[]): Promise<(SignatureStatus | null)[]>;
  blockHeight(): Promise<bigint>;
  rebroadcast(wireBytes: Uint8Array): Promise<void>;
  transaction(signature: string, context: ReadContext): Promise<RpcReading<TransactionDetails | null>>;
}

const SYSTEM = { actor: { type: "system" as const } };

/**
 * Confirmation (SUBMITTED/CONFIRMING → CONFIRMED | CONFIRMATION_FAILED | EXPIRED) and
 * reconciliation (CONFIRMED → RECONCILED | RECONCILIATION_REQUIRED | RECONCILIATION_FAILED).
 * Idempotent: transitions are compare-and-set, so overlapping sweeps cannot apply one twice.
 */
export class TransactionSweeps {
  constructor(
    private readonly config: { cluster: Cluster },
    private readonly deps: {
      store: TransactionStore;
      transitions: TransactionTransitions;
      chain: SweepChain;
      logger: Pick<Logger, "info" | "warn" | "error">;
      now?: () => Date;
    },
  ) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** TXL-AC-05, TXL-AC-06 */
  async confirm(): Promise<{ checked: number; moved: number }> {
    const open = await this.deps.store.listInStates(
      ["SUBMITTED", "CONFIRMING"],
      this.config.cluster,
      RECORDS_PER_SWEEP,
    );
    if (open.length === 0) return { checked: 0, moved: 0 };

    const confirming: TransactionRecord[] = [];
    for (const record of open) {
      if (record.state === "CONFIRMING") confirming.push(record);
      else {
        const moved = await this.deps.transitions.apply(record, "CONFIRMING", SYSTEM);
        if (moved) confirming.push(moved);
      }
    }
    const tracked = confirming.filter((record) => record.signature !== null);
    const statuses = await this.deps.chain.signatureStatuses(tracked.map((record) => record.signature ?? ""));
    let height: bigint | null = null;
    let moved = 0;

    for (const [index, record] of tracked.entries()) {
      const status = statuses[index] ?? null;
      if (
        status &&
        (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")
      ) {
        const failed = status.error !== null && status.error !== undefined;
        const next = await this.deps.transitions.apply(record, failed ? "CONFIRMATION_FAILED" : "CONFIRMED", {
          ...SYSTEM,
          ...(failed
            ? {
                reason: "ON_CHAIN_ERROR",
                patch: {
                  failure: {
                    reason: "ON_CHAIN_ERROR",
                    message: describeChainError(status.error) ?? "The transaction failed on chain.",
                  },
                },
              }
            : { patch: { confirmedAt: this.now() } }),
          details: { slot: status.slot.toString() },
        });
        if (next) moved += 1;
        continue;
      }
      if (status) continue; // processed, not yet confirmed

      height ??= await this.deps.chain.blockHeight();
      if (height > record.lastValidBlockHeight) {
        const expired = await this.deps.transitions.apply(record, "EXPIRED", {
          ...SYSTEM,
          reason: "BLOCKHASH_EXPIRED",
          details: { blockHeight: height.toString() },
          patch: {
            failure: {
              reason: "BLOCKHASH_EXPIRED",
              message: "The blockhash expired before the transaction landed.",
            },
          },
        });
        if (expired) moved += 1;
        continue;
      }
      await this.rebroadcast(record);
    }
    return { checked: tracked.length, moved };
  }

  /** Re-sends the stored signed transaction at most every 2 s while its blockhash is valid. */
  private async rebroadcast(record: TransactionRecord): Promise<void> {
    if (!record.signedTransaction) return;
    const last = record.lastSentAt?.getTime() ?? 0;
    if (this.now().getTime() - last < REBROADCAST_INTERVAL_MS) return;
    try {
      await this.deps.chain.rebroadcast(record.signedTransaction);
    } catch (error) {
      // A rejected re-send changes nothing: status and block height decide the outcome.
      this.deps.logger.info({ err: error, transactionId: record.id }, "Transaction re-broadcast failed");
    }
    await this.deps.store.touch(record.id, { lastSentAt: this.now() });
  }

  /** TXL-AC-07 */
  async reconcile(context: ReadContext): Promise<{ checked: number; moved: number }> {
    const confirmed = await this.deps.store.listInStates(
      ["CONFIRMED"],
      this.config.cluster,
      RECORDS_PER_SWEEP,
    );
    const tracked = confirmed.filter((record) => record.signature !== null);
    if (tracked.length === 0) return { checked: 0, moved: 0 };
    const statuses = await this.deps.chain.signatureStatuses(tracked.map((record) => record.signature ?? ""));
    let moved = 0;
    for (const [index, record] of tracked.entries()) {
      const finalized = statuses[index]?.confirmationStatus === "finalized";
      const next = finalized ? await this.reconcileOne(record, context) : await this.checkDeadline(record);
      if (next) moved += 1;
    }
    return { checked: tracked.length, moved };
  }

  private async reconcileOne(
    record: TransactionRecord,
    context: ReadContext,
  ): Promise<TransactionRecord | null> {
    let details: TransactionDetails | null;
    try {
      details = (await this.deps.chain.transaction(record.signature ?? "", context)).value;
    } catch (error) {
      if (!isProviderError(error)) throw error;
      return this.checkDeadline(record);
    }
    if (!details) return this.checkDeadline(record);

    const expected = new Map(
      Object.entries(record.expectedEffects).map(([account, delta]) => [account, BigInt(delta)]),
    );
    const observed = new Map(
      [...expected.keys()].map((account) => [account, solChangeOf(details, account) ?? 0n]),
    );
    const matched = effectsMatch(expected, observed);
    const reconciliation = {
      matched,
      expected: toMovements(expected),
      observed: toMovements(observed),
      checkedAt: this.now().toISOString(),
    };
    if (!matched) {
      // Interim alert until Iteration 07: audit failure + error log + visible state.
      this.deps.logger.error(
        { transactionId: record.id, organizationId: record.organizationId, reconciliation },
        "ALERT: transaction reconciliation found a divergence",
      );
    }
    return this.deps.transitions.apply(record, matched ? "RECONCILED" : "RECONCILIATION_REQUIRED", {
      ...SYSTEM,
      ...(matched ? {} : { reason: "EFFECTS_DIVERGED" }),
      patch: { reconciliation, finalizedAt: this.now() },
    });
  }

  private async checkDeadline(record: TransactionRecord): Promise<TransactionRecord | null> {
    const since = record.confirmedAt ?? record.updatedAt;
    if (this.now().getTime() - since.getTime() < RECONCILIATION_DEADLINE_MS) return null;
    this.deps.logger.error(
      { transactionId: record.id, organizationId: record.organizationId },
      "ALERT: transaction reconciliation could not be completed",
    );
    return this.deps.transitions.apply(record, "RECONCILIATION_FAILED", {
      ...SYSTEM,
      reason: "DATA_UNAVAILABLE",
      patch: {
        failure: {
          reason: "DATA_UNAVAILABLE",
          message: "Finalized data was not available within 10 minutes of confirmation.",
        },
      },
    });
  }
}
