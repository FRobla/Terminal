import type { Address, Signature } from "@solana/kit";
import { z } from "zod";
import type { Commitment, ReadContext, RpcGateway, RpcReading } from "../rpc/solana-rpc-client";

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
    private readonly client: RpcGateway,
    private readonly commitment: Exclude<Commitment, "processed"> = "confirmed",
  ) {}

  async read(address: Address, limit: number, context: ReadContext): Promise<RpcReading<SignatureSummary[]>> {
    return this.readPage(address, { limit }, context);
  }

  /**
   * One page, newest first. `before` starts below that signature; `until` stops at
   * (and excludes) that signature (SPEC-009 §4.8).
   */
  async readPage(
    address: Address,
    page: { limit: number; before?: string | undefined; until?: string | undefined },
    context: ReadContext,
  ): Promise<RpcReading<SignatureSummary[]>> {
    const result = await this.client.call("getSignaturesForAddress", (abortSignal, rpc) =>
      rpc
        .getSignaturesForAddress(address, {
          limit: page.limit,
          commitment: this.commitment,
          ...(page.before ? { before: page.before as Signature } : {}),
          ...(page.until ? { until: page.until as Signature } : {}),
        })
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
