import type { Address } from "@solana/kit";
import { z } from "zod";
import type { Commitment, ReadContext, RpcReading, SolanaRpcClient } from "../rpc/solana-rpc-client";

export const SIGNATURE_HISTORY_DATA_VERSION = "signature-history.v1";

export interface SignatureSummary {
  signature: string;
  slot: bigint;
  /** Unix timestamp in seconds, when the RPC knows it. */
  blockTime: bigint | null;
  failed: boolean;
  confirmationStatus: "processed" | "confirmed" | "finalized" | null;
  /** Untrusted on-chain content. */
  memo: string | null;
}

const signatureEntrySchema = z
  .object({
    signature: z.string(),
    slot: z.bigint(),
    blockTime: z.bigint().nullable(),
    err: z.unknown(),
    memo: z.string().nullable(),
    confirmationStatus: z.enum(["processed", "confirmed", "finalized"]).nullable(),
  })
  .loose();

const signaturesResponseSchema = z.array(signatureEntrySchema);

export class SignatureHistoryReader {
  constructor(
    private readonly client: SolanaRpcClient,
    private readonly commitment: Exclude<Commitment, "processed"> = "confirmed",
  ) {}

  async read(address: Address, limit: number, context: ReadContext): Promise<RpcReading<SignatureSummary[]>> {
    const result = await this.client.call("getSignaturesForAddress", (abortSignal) =>
      this.client.rpc
        .getSignaturesForAddress(address, { limit, commitment: this.commitment })
        .send({ abortSignal })
        .then((response) => signaturesResponseSchema.parse(response)),
    );
    return {
      value: result.value.map((entry) => ({
        signature: entry.signature,
        slot: entry.slot,
        blockTime: entry.blockTime,
        failed: entry.err !== null && entry.err !== undefined,
        confirmationStatus: entry.confirmationStatus,
        memo: entry.memo,
      })),
      provenance: this.client.provenance({
        method: "getSignaturesForAddress",
        result,
        context,
        dataVersion: SIGNATURE_HISTORY_DATA_VERSION,
        commitment: this.commitment,
      }),
    };
  }
}
