import { createHash } from "node:crypto";
import type { Address } from "@solana/kit";
import type { PermittedCluster } from "@sct/network";
import { isProviderError } from "@sct/providers";
import {
  buildSolTransferTransaction,
  decodeMessage,
  decodeSystemTransfer,
  type ReadContext,
} from "@sct/solana";
import {
  buildReview,
  describeChainError,
  effectsMatch,
  messageHash,
  observedEffects,
  solTransferEffects,
  toMovements,
  type TransactionRecord,
  type TransactionTransitions,
  type TransitionActor,
} from "@sct/transactions";
import type { SolTransferRequest } from "@sct/validation";
import { canInitiateTransactions } from "../../wallets/domain/managed-wallet";
import type { WalletStore } from "../../wallets/application/registry-ports";
import type { OrganizationActor } from "../../wallets/application/wallet-registration";
import type { BalanceReader, IdempotencyStore, TransactionChain } from "./ports";

const IDEMPOTENCY_SCOPE = "transactions.sol-transfer";

export type PrepareFailure =
  | { code: "WALLET_NOT_FOUND" }
  | { code: "FORBIDDEN"; message: string }
  | { code: "OPERATION_NOT_ALLOWED"; message: string }
  | { code: "VALIDATION_FAILED"; message: string }
  | { code: "IDEMPOTENCY_CONFLICT" };

export function userActor(actor: OrganizationActor): TransitionActor {
  return {
    type: "user",
    userId: actor.userId,
    organizationId: actor.organizationId,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  };
}

/**
 * SPEC-004 amendment — prepares a SOL transfer: authorization, idempotency, build,
 * mandatory simulation, effect check, and the server-built review (TXL-AC-02, 03, 10, 11, 15).
 */
export class SolTransferService {
  constructor(
    private readonly config: { cluster: PermittedCluster },
    private readonly deps: {
      wallets: WalletStore;
      idempotency: IdempotencyStore;
      chain: TransactionChain;
      balances: BalanceReader;
      transitions: TransactionTransitions;
      now?: () => Date;
    },
  ) {}

  async prepare(
    actor: OrganizationActor,
    request: SolTransferRequest,
    context: ReadContext,
  ): Promise<{ ok: true; record: TransactionRecord } | { ok: false; failure: PrepareFailure }> {
    const wallet = await this.deps.wallets.find(
      actor.organizationId,
      this.config.cluster,
      request.sourceWalletId,
    );
    if (!wallet) return { ok: false, failure: { code: "WALLET_NOT_FOUND" } };
    if (wallet.status !== "active" || wallet.custodyType === "WATCH_ONLY") {
      return {
        ok: false,
        failure: {
          code: "OPERATION_NOT_ALLOWED",
          message: "Transfers need an active wallet whose key you control (browser or local wallet).",
        },
      };
    }
    const roles = wallet.assignments
      .filter((entry) => entry.userId === actor.userId)
      .map((entry) => entry.role);
    if (!canInitiateTransactions(roles)) {
      return {
        ok: false,
        failure: {
          code: "FORBIDDEN",
          message: "Only the wallet's creator or a controller can initiate transfers.",
        },
      };
    }
    if (request.destination === wallet.address) {
      return {
        ok: false,
        failure: { code: "VALIDATION_FAILED", message: "The destination must differ from the source." },
      };
    }

    const requestHash = createHash("sha256")
      .update(JSON.stringify([request.sourceWalletId, request.destination, request.lamports]))
      .digest("hex");
    const keyRef = {
      organizationId: actor.organizationId,
      userId: actor.userId,
      scope: IDEMPOTENCY_SCOPE,
      key: request.idempotencyKey,
    };
    const existing = await this.deps.idempotency.find(keyRef);
    if (existing) return this.replay(existing, requestHash);

    const lamports = BigInt(request.lamports);
    const blockhash = await this.deps.chain.latestBlockhash(context);
    const built = buildSolTransferTransaction({
      source: wallet.address as Address,
      destination: request.destination as Address,
      lamports,
      blockhash: blockhash.value.blockhash,
      lastValidBlockHeight: blockhash.value.lastValidBlockHeight,
    });

    let claimed = true;
    const draft = await this.deps.transitions
      .create(
        {
          organizationId: actor.organizationId,
          initiatedByUserId: actor.userId,
          walletId: wallet.id,
          cluster: this.config.cluster,
          purpose: "sol-transfer",
          feePayer: wallet.address,
          signers: [wallet.address],
          intent: { destination: request.destination, lamports: request.lamports },
          expectedEffects: {},
          messageBytes: built.messageBytes,
          messageHash: messageHash(built.messageBytes),
          unsignedTransaction: built.wireBytes,
          recentBlockhash: blockhash.value.blockhash,
          lastValidBlockHeight: blockhash.value.lastValidBlockHeight,
          idempotencyKey: request.idempotencyKey,
          createdAt: this.deps.now?.() ?? new Date(),
        },
        userActor(actor),
        async (transactionId, transaction) => {
          claimed = await this.deps.idempotency.claim(
            { ...keyRef, requestHash, resourceId: transactionId },
            transaction,
          );
          // Roll back the draft: another request with this key won the race.
          if (!claimed) throw new IdempotencyRace();
        },
      )
      .catch((error: unknown) => {
        if (error instanceof IdempotencyRace) return null;
        throw error;
      });
    if (!draft || !claimed) {
      const winner = await this.deps.idempotency.find(keyRef);
      if (!winner) throw new Error("Idempotency key claimed but not readable");
      return this.replay(winner, requestHash);
    }
    return { ok: true, record: await this.simulate(draft, actor, context) };
  }

  private async replay(
    existing: { requestHash: string; resourceId: string },
    requestHash: string,
  ): Promise<{ ok: true; record: TransactionRecord } | { ok: false; failure: PrepareFailure }> {
    if (existing.requestHash !== requestHash) return { ok: false, failure: { code: "IDEMPOTENCY_CONFLICT" } };
    const record = await this.deps.transitions.find(existing.resourceId);
    if (!record) throw new Error("Idempotency key points to a missing transaction");
    return { ok: true, record };
  }

  /** DRAFT → SIMULATING → SIMULATED → AWAITING_SIGNATURE, or SIMULATION_FAILED with the reason. */
  private async simulate(draft: TransactionRecord, actor: OrganizationActor, context: ReadContext) {
    const by = userActor(actor);
    const simulating = await this.deps.transitions.apply(draft, "SIMULATING", { actor: by });
    if (!simulating) throw new Error("The new transaction changed state unexpectedly");
    const decoded = decodeMessage(simulating.messageBytes);
    const accounts = [simulating.feePayer, simulating.intent.destination];

    const fail = (
      reason: string,
      message: string,
      patch: Parameters<TransactionTransitions["apply"]>[2]["patch"] = {},
    ) =>
      this.deps.transitions.apply(simulating, "SIMULATION_FAILED", {
        actor: by,
        reason,
        patch: { ...patch, failure: { reason, message } },
      });

    let outcome;
    try {
      const [before, fee, simulation] = await Promise.all([
        this.deps.balances.read(accounts as Address[], context),
        this.deps.chain.feeForMessage(simulating.messageBytes, context),
        this.deps.chain.simulate(simulating.unsignedTransaction, accounts, context),
      ]);
      outcome = {
        before: before.value.map((row) => row.lamports),
        fee: fee.value,
        simulation: simulation.value,
      };
    } catch (error) {
      if (!isProviderError(error)) throw error;
      return this.required(
        await fail(
          "SIMULATION_UNAVAILABLE",
          `The simulation could not run: RPC ${error.kind.toLowerCase()}.`,
        ),
      );
    }

    if (outcome.fee === null) {
      return this.required(
        await fail("BLOCKHASH_EXPIRED", "The blockhash expired before simulation. Prepare a new transfer."),
      );
    }
    const transfers = decoded.instructions.flatMap((instruction) => {
      const transfer = decodeSystemTransfer(instruction);
      return transfer ? [transfer] : [];
    });
    const expected = solTransferEffects(transfers, decoded.feePayer, outcome.fee);
    const movements = toMovements(expected);
    const review = buildReview({
      cluster: this.config.cluster,
      decoded,
      movements,
      feeLamports: outcome.fee,
      simulation: outcome.simulation,
      lastValidBlockHeight: simulating.lastValidBlockHeight,
    });
    const simulationResult = {
      error: describeChainError(outcome.simulation.error),
      logs: review.simulation.logs,
      unitsConsumed: review.simulation.unitsConsumed,
      slot: outcome.simulation.slot.toString(),
    };
    const expectedEffects = Object.fromEntries(
      movements.map((movement) => [movement.account, movement.deltaLamports]),
    );
    const patch = { review, simulationResult, expectedEffects };

    if (outcome.simulation.error !== null) {
      return this.required(
        await fail("SIMULATION_ERROR", review.simulation.error ?? "The simulation returned an error.", patch),
      );
    }
    const observed = observedEffects(accounts, outcome.before, outcome.simulation.postLamports);
    if (!effectsMatch(expected, observed)) {
      return this.required(
        await fail("EFFECTS_MISMATCH", "The simulated balance changes differ from the expected transfer.", {
          ...patch,
          simulationResult: { ...simulationResult, observed: toMovements(observed) },
        }),
      );
    }

    const simulated = this.required(
      await this.deps.transitions.apply(simulating, "SIMULATED", { actor: by, patch }),
    );
    return this.required(await this.deps.transitions.apply(simulated, "AWAITING_SIGNATURE", { actor: by }));
  }

  private required(record: TransactionRecord | null): TransactionRecord {
    if (!record) throw new Error("The transaction changed state concurrently during preparation");
    return record;
  }
}

class IdempotencyRace extends Error {}
