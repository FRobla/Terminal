import { getBase58Decoder } from "@solana/kit";
import type { Logger } from "@sct/observability";
import { isFailoverEligible, decodeWireTransaction } from "@sct/solana";
import { isProviderError } from "@sct/providers";
import { describeChainError, type TransactionRecord, type TransactionTransitions } from "@sct/transactions";
import { transactionReviewSchema } from "@sct/validation";
import { timingSafeEqual, createHash } from "node:crypto";
import type { SignatureVerifier } from "../../auth/application/ports";
import type { OrganizationActor } from "../../wallets/application/wallet-registration";
import type { ConfirmationScheduler, TransactionChain } from "./ports";
import { userActor } from "./sol-transfer-service";

export type SigningFailure =
  | { code: "TRANSACTION_NOT_FOUND" }
  | { code: "OPERATION_NOT_ALLOWED"; message: string }
  | { code: "TRANSACTION_STATE_CONFLICT"; message: string }
  | { code: "VALIDATION_FAILED"; message: string }
  | { code: "TRANSACTION_MESSAGE_MISMATCH"; reason: "MESSAGE_MISMATCH" | "SIGNATURE_INVALID" };

type Result = { ok: true; record: TransactionRecord } | { ok: false; failure: SigningFailure };

const SUBMITTED_OR_LATER = new Set([
  "SUBMITTED",
  "SUBMISSION_FAILED",
  "CONFIRMING",
  "CONFIRMED",
  "CONFIRMATION_FAILED",
  "EXPIRED",
  "RECONCILED",
  "RECONCILIATION_REQUIRED",
  "RECONCILIATION_FAILED",
]);

/**
 * SPEC-004 amendment steps 6–8 — the signing hand-off and submission. Only the user who
 * prepared a transaction may move it forward. The API never signs (ADR-0004).
 */
export class TransactionSigning {
  constructor(
    private readonly deps: {
      transitions: TransactionTransitions;
      chain: TransactionChain;
      verifier: SignatureVerifier;
      confirmations: ConfirmationScheduler;
      logger: Pick<Logger, "warn">;
      now?: () => Date;
    },
  ) {}

  private async load(
    actor: OrganizationActor,
    transactionId: string,
  ): Promise<TransactionRecord | SigningFailure> {
    const record = await this.deps.transitions.find(transactionId);
    if (!record || record.organizationId !== actor.organizationId) return { code: "TRANSACTION_NOT_FOUND" };
    if (record.initiatedByUserId !== actor.userId) {
      return {
        code: "OPERATION_NOT_ALLOWED",
        message: "Only the person who prepared this transaction can sign it.",
      };
    }
    return record;
  }

  private conflict(record: TransactionRecord): Result {
    return {
      ok: false,
      failure: { code: "TRANSACTION_STATE_CONFLICT", message: `The transaction is ${record.state}.` },
    };
  }

  /** TXL-AC-13 — the user declines before signing. */
  async cancel(actor: OrganizationActor, transactionId: string): Promise<Result> {
    const record = await this.load(actor, transactionId);
    if ("code" in record) return { ok: false, failure: record };
    if (record.state !== "AWAITING_SIGNATURE") return this.conflict(record);
    const cancelled = await this.deps.transitions.apply(record, "CANCELLED", {
      actor: userActor(actor),
      reason: "USER_CANCELLED",
      patch: { failure: { reason: "USER_CANCELLED", message: "Cancelled before signing." } },
    });
    return cancelled ? { ok: true, record: cancelled } : this.current(transactionId);
  }

  /** AWAITING_SIGNATURE → SIGNING; unknown programs need explicit acknowledgement (rule 4). */
  async requestSignature(
    actor: OrganizationActor,
    transactionId: string,
    acknowledgeUnknownPrograms: boolean,
  ): Promise<Result> {
    const record = await this.load(actor, transactionId);
    if ("code" in record) return { ok: false, failure: record };
    if (record.state === "SIGNING") return { ok: true, record };
    if (record.state !== "AWAITING_SIGNATURE") return this.conflict(record);
    const review = transactionReviewSchema.safeParse(record.review);
    if (!review.success) throw new Error("A transaction awaiting signature has no valid review");
    if (review.data.requiresUnknownProgramAcknowledgement && !acknowledgeUnknownPrograms) {
      return {
        ok: false,
        failure: {
          code: "VALIDATION_FAILED",
          message: "This transaction invokes unknown programs; acknowledge them before signing.",
        },
      };
    }
    const signing = await this.deps.transitions.apply(record, "SIGNING", { actor: userActor(actor) });
    return signing ? { ok: true, record: signing } : this.current(transactionId);
  }

  /** TXL-AC-13 — the wallet rejected or failed; nothing is sent. */
  async signingFailed(actor: OrganizationActor, transactionId: string, reason: string): Promise<Result> {
    const record = await this.load(actor, transactionId);
    if ("code" in record) return { ok: false, failure: record };
    if (record.state !== "SIGNING") return this.conflict(record);
    const failed = await this.deps.transitions.apply(record, "SIGNING_FAILED", {
      actor: userActor(actor),
      reason,
      patch: { failure: { reason, message: "The wallet did not sign the transaction." } },
    });
    return failed ? { ok: true, record: failed } : this.current(transactionId);
  }

  /** TXL-AC-04, TXL-AC-05, TXL-AC-12 — verifies the signed bytes, then sends once. */
  async submit(
    actor: OrganizationActor,
    transactionId: string,
    signedTransactionBase64: string,
  ): Promise<Result> {
    const record = await this.load(actor, transactionId);
    if ("code" in record) return { ok: false, failure: record };
    const signedBytes = new Uint8Array(Buffer.from(signedTransactionBase64, "base64"));
    if (SUBMITTED_OR_LATER.has(record.state)) {
      // A repeated submission of the same bytes returns the record without sending again.
      return record.signedTransaction &&
        Buffer.from(record.signedTransaction).equals(Buffer.from(signedBytes))
        ? { ok: true, record }
        : this.conflict(record);
    }
    if (record.state !== "SIGNING") return this.conflict(record);
    const by = userActor(actor);

    let decoded;
    try {
      decoded = decodeWireTransaction(signedBytes);
    } catch {
      return this.rejectSigned(record, by, "MESSAGE_MISMATCH");
    }
    const hash = new Uint8Array(createHash("sha256").update(decoded.messageBytes).digest());
    if (hash.length !== record.messageHash.length || !timingSafeEqual(hash, record.messageHash)) {
      return this.rejectSigned(record, by, "MESSAGE_MISMATCH");
    }
    const signature = decoded.signatures[record.feePayer];
    if (!signature || !(await this.deps.verifier.verify(record.feePayer, decoded.messageBytes, signature))) {
      return this.rejectSigned(record, by, "SIGNATURE_INVALID");
    }

    // An expired blockhash cannot land: record EXPIRED and send nothing.
    const height = await this.deps.chain.blockHeight().catch(() => null);
    if (height !== null && height > record.lastValidBlockHeight) {
      const expired = await this.deps.transitions.apply(record, "EXPIRED", {
        actor: by,
        reason: "BLOCKHASH_EXPIRED",
        patch: {
          failure: { reason: "BLOCKHASH_EXPIRED", message: "The blockhash expired before submission." },
        },
      });
      return expired ? { ok: true, record: expired } : this.current(transactionId);
    }

    // Persist the signature first: if this process stops after sending, the worker still tracks it.
    const now = this.deps.now?.() ?? new Date();
    const txSignature = getBase58Decoder().decode(signature);
    const submitted = await this.deps.transitions.apply(record, "SUBMITTED", {
      actor: by,
      patch: { signedTransaction: signedBytes, signature: txSignature, submittedAt: now, lastSentAt: now },
    });
    if (!submitted) return this.current(transactionId);

    try {
      await this.deps.chain.send(signedBytes);
    } catch (error) {
      if (isProviderError(error) && !isFailoverEligible(error)) {
        // The node answered and rejected the transaction (e.g. failed preflight): it cannot land.
        const message = describeChainError(
          error.cause instanceof Error ? error.cause.message : error.message,
        );
        const failed = await this.deps.transitions.apply(submitted, "SUBMISSION_FAILED", {
          actor: by,
          reason: "SEND_REJECTED",
          patch: {
            failure: { reason: "SEND_REJECTED", message: message ?? "The RPC rejected the transaction." },
          },
        });
        return failed ? { ok: true, record: failed } : this.current(transactionId);
      }
      // Ambiguous: the transaction may still land. The worker re-sends and decides by status and block height.
      this.deps.logger.warn(
        { err: error, transactionId },
        "Transaction send outcome unknown; the worker will track it",
      );
    }
    await this.deps.confirmations.requestSweep(transactionId).catch((error: unknown) => {
      this.deps.logger.warn({ err: error, transactionId }, "Confirmation sweep could not be enqueued");
    });
    return this.current(transactionId);
  }

  private async rejectSigned(
    record: TransactionRecord,
    actor: ReturnType<typeof userActor>,
    reason: "MESSAGE_MISMATCH" | "SIGNATURE_INVALID",
  ): Promise<Result> {
    await this.deps.transitions.apply(record, "SIGNING_FAILED", {
      actor,
      reason,
      patch: {
        failure: {
          reason,
          message:
            reason === "MESSAGE_MISMATCH"
              ? "The signed transaction differs from the reviewed transaction."
              : "The fee payer's signature does not verify.",
        },
      },
    });
    return { ok: false, failure: { code: "TRANSACTION_MESSAGE_MISMATCH", reason } };
  }

  private async current(transactionId: string): Promise<Result> {
    const record = await this.deps.transitions.find(transactionId);
    if (!record) return { ok: false, failure: { code: "TRANSACTION_NOT_FOUND" } };
    return { ok: true, record };
  }
}
