import type { Base64EncodedWireTransaction, Signature, TransactionMessageBytesBase64 } from "@solana/kit";
import { z } from "zod";
import type { ReadContext, RpcGateway, RpcReading } from "../rpc/solana-rpc-client";

/**
 * SPEC-004 — the RPC methods the transaction lifecycle needs. Every call goes through
 * the provider pipeline (budget, retries, health, fallback).
 */

export const TRANSACTION_DATA_VERSION = "transaction-lifecycle.v1";

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

const latestBlockhashSchema = z.object({
  context: z.object({ slot: z.bigint() }).loose(),
  value: z.object({ blockhash: z.string().min(32).max(44), lastValidBlockHeight: z.bigint() }).loose(),
});

const feeSchema = z.object({ context: z.object({ slot: z.bigint() }).loose(), value: z.bigint().nullable() });

const simulationSchema = z.object({
  context: z.object({ slot: z.bigint() }).loose(),
  value: z
    .object({
      err: z.unknown(),
      logs: z.array(z.string()).nullable().optional(),
      unitsConsumed: z.bigint().nullable().optional(),
      accounts: z
        .array(z.object({ lamports: z.bigint() }).loose().nullable())
        .nullable()
        .optional(),
    })
    .loose(),
});

const statusSchema = z
  .object({
    slot: z.bigint(),
    err: z.unknown(),
    confirmationStatus: z.enum(["processed", "confirmed", "finalized"]).nullable(),
  })
  .loose()
  .nullable();

const statusesSchema = z.object({
  context: z.object({ slot: z.bigint() }).loose(),
  value: z.array(statusSchema),
});

export interface SimulationOutcome {
  /** The on-chain error, or null when the simulation succeeded. Untrusted structure. */
  error: unknown;
  logs: string[];
  unitsConsumed: bigint | null;
  /** Post-simulation lamports per requested account (null when the account would not exist). */
  postLamports: (bigint | null)[];
  slot: bigint;
}

export interface SignatureStatus {
  slot: bigint;
  /** The on-chain error, or null when the transaction succeeded. */
  error: unknown;
  confirmationStatus: "processed" | "confirmed" | "finalized" | null;
}

export class TransactionChainReaders {
  constructor(private readonly client: RpcGateway) {}

  async latestBlockhash(
    context: ReadContext,
  ): Promise<RpcReading<{ blockhash: string; lastValidBlockHeight: bigint; slot: bigint }>> {
    const result = await this.client.call("getLatestBlockhash", (abortSignal, rpc) =>
      rpc
        .getLatestBlockhash({ commitment: "confirmed" })
        .send({ abortSignal })
        .then((response) => latestBlockhashSchema.parse(response)),
    );
    const { context: rpcContext, value } = result.value;
    return {
      value: {
        blockhash: value.blockhash,
        lastValidBlockHeight: value.lastValidBlockHeight,
        slot: rpcContext.slot,
      },
      provenance: this.client.provenance({
        method: "getLatestBlockhash",
        result,
        context,
        dataVersion: TRANSACTION_DATA_VERSION,
        commitment: "confirmed",
        slot: rpcContext.slot,
      }),
    };
  }

  /** The base fee for a compiled message, or null when its blockhash is no longer valid. */
  async feeForMessage(messageBytes: Uint8Array, context: ReadContext): Promise<RpcReading<bigint | null>> {
    const result = await this.client.call("getFeeForMessage", (abortSignal, rpc) =>
      rpc
        .getFeeForMessage(base64(messageBytes) as TransactionMessageBytesBase64, { commitment: "confirmed" })
        .send({ abortSignal })
        .then((response) => feeSchema.parse(response)),
    );
    return {
      value: result.value.value,
      provenance: this.client.provenance({
        method: "getFeeForMessage",
        result,
        context,
        dataVersion: TRANSACTION_DATA_VERSION,
        commitment: "confirmed",
        slot: result.value.context.slot,
      }),
    };
  }

  /** Simulates without signature verification, keeping the transaction's own blockhash. */
  async simulate(
    wireBytes: Uint8Array,
    accounts: string[],
    context: ReadContext,
  ): Promise<RpcReading<SimulationOutcome>> {
    const result = await this.client.call("simulateTransaction", (abortSignal, rpc) =>
      rpc
        .simulateTransaction(base64(wireBytes) as Base64EncodedWireTransaction, {
          encoding: "base64",
          sigVerify: false,
          replaceRecentBlockhash: false,
          commitment: "confirmed",
          accounts: { addresses: accounts as never, encoding: "base64" },
        })
        .send({ abortSignal })
        .then((response) => simulationSchema.parse(response)),
    );
    const { context: rpcContext, value } = result.value;
    return {
      value: {
        error: value.err ?? null,
        logs: value.logs ?? [],
        unitsConsumed: value.unitsConsumed ?? null,
        postLamports: (value.accounts ?? accounts.map(() => null)).map(
          (account) => account?.lamports ?? null,
        ),
        slot: rpcContext.slot,
      },
      provenance: this.client.provenance({
        method: "simulateTransaction",
        result,
        context,
        dataVersion: TRANSACTION_DATA_VERSION,
        commitment: "confirmed",
        slot: rpcContext.slot,
      }),
    };
  }

  /**
   * Sends a signed transaction with preflight and no RPC-side retries (the worker
   * re-sends while the blockhash is valid). A JSON-RPC error answer is definitive;
   * transport failures are ambiguous (the transaction may still land).
   */
  async send(wireBytes: Uint8Array): Promise<string> {
    const result = await this.client.call("sendTransaction", (abortSignal, rpc) =>
      rpc
        .sendTransaction(base64(wireBytes) as Base64EncodedWireTransaction, {
          encoding: "base64",
          skipPreflight: false,
          preflightCommitment: "confirmed",
          maxRetries: 0n,
        })
        .send({ abortSignal })
        .then((signature) => z.string().min(32).max(100).parse(signature)),
    );
    return result.value;
  }

  /** Re-broadcast while confirming: no preflight (it already passed) and no RPC-side retries. */
  async rebroadcast(wireBytes: Uint8Array): Promise<void> {
    await this.client.call("sendTransaction", (abortSignal, rpc) =>
      rpc
        .sendTransaction(base64(wireBytes) as Base64EncodedWireTransaction, {
          encoding: "base64",
          skipPreflight: true,
          maxRetries: 0n,
        })
        .send({ abortSignal }),
    );
  }

  /** Statuses of up to 256 signatures from the recent status cache. */
  async signatureStatuses(signatures: string[]): Promise<(SignatureStatus | null)[]> {
    if (signatures.length === 0) return [];
    if (signatures.length > 256) throw new RangeError("At most 256 signatures per status request");
    const result = await this.client.call("getSignatureStatuses", (abortSignal, rpc) =>
      rpc
        .getSignatureStatuses(signatures as Signature[], { searchTransactionHistory: false })
        .send({ abortSignal })
        .then((response) => statusesSchema.parse(response)),
    );
    return result.value.value.map((status) =>
      status
        ? { slot: status.slot, error: status.err ?? null, confirmationStatus: status.confirmationStatus }
        : null,
    );
  }

  async blockHeight(): Promise<bigint> {
    const result = await this.client.call("getBlockHeight", (abortSignal, rpc) =>
      rpc
        .getBlockHeight({ commitment: "confirmed" })
        .send({ abortSignal })
        .then((height) => z.bigint().parse(height)),
    );
    return result.value;
  }
}
