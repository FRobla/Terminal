import type { Signature } from "@solana/kit";
import { z } from "zod";
import type { Commitment, ReadContext, RpcGateway, RpcReading } from "../rpc/solana-rpc-client";

export const TRANSACTION_DETAILS_DATA_VERSION = "transaction-details.v1";

export interface TransactionDetails {
  slot: bigint;
  blockTime: bigint | null;
  feeLamports: bigint;
  /** Every account of the transaction in message order (static keys, then loaded writable, then loaded read-only). */
  accountKeys: string[];
  preBalances: bigint[];
  postBalances: bigint[];
  /** The on-chain error, or null when the transaction succeeded. Untrusted structure. */
  error: unknown;
}

const detailsSchema = z
  .object({
    slot: z.bigint(),
    blockTime: z.bigint().nullable(),
    meta: z
      .object({
        fee: z.bigint(),
        preBalances: z.array(z.bigint()),
        postBalances: z.array(z.bigint()),
        err: z.unknown(),
        loadedAddresses: z
          .object({ writable: z.array(z.string()), readonly: z.array(z.string()) })
          .loose()
          .optional(),
      })
      .loose(),
    transaction: z.object({ message: z.object({ accountKeys: z.array(z.string()) }).loose() }).loose(),
  })
  .loose()
  .refine(
    (value) =>
      value.meta.preBalances.length === value.meta.postBalances.length &&
      value.meta.preBalances.length ===
        value.transaction.message.accountKeys.length +
          (value.meta.loadedAddresses?.writable.length ?? 0) +
          (value.meta.loadedAddresses?.readonly.length ?? 0),
    "Balance arrays do not match the account keys",
  );

/**
 * One confirmed or finalized transaction with fee and balance changes
 * (SPEC-009 §4.8, SPEC-004 reconciliation). `null` when the RPC does not know it.
 */
export class TransactionDetailsReader {
  constructor(private readonly client: RpcGateway) {}

  async read(
    signature: string,
    commitment: Exclude<Commitment, "processed">,
    context: ReadContext,
  ): Promise<RpcReading<TransactionDetails | null>> {
    const result = await this.client.call("getTransaction", (abortSignal, rpc) =>
      rpc
        .getTransaction(signature as Signature, {
          commitment,
          encoding: "json",
          maxSupportedTransactionVersion: 0,
        })
        .send({ abortSignal })
        .then((response) => (response === null ? null : detailsSchema.parse(response))),
    );
    const parsed = result.value;
    return {
      value: parsed
        ? {
            slot: parsed.slot,
            blockTime: parsed.blockTime,
            feeLamports: parsed.meta.fee,
            accountKeys: [
              ...parsed.transaction.message.accountKeys,
              ...(parsed.meta.loadedAddresses?.writable ?? []),
              ...(parsed.meta.loadedAddresses?.readonly ?? []),
            ],
            preBalances: parsed.meta.preBalances,
            postBalances: parsed.meta.postBalances,
            error: parsed.meta.err ?? null,
          }
        : null,
      provenance: this.client.provenance({
        method: "getTransaction",
        result,
        context,
        dataVersion: TRANSACTION_DETAILS_DATA_VERSION,
        commitment,
        ...(parsed ? { slot: parsed.slot } : {}),
      }),
    };
  }
}

/** The SOL change of one account in a transaction, or null when the account is not part of it. */
export function solChangeOf(details: TransactionDetails, address: string): bigint | null {
  const index = details.accountKeys.indexOf(address);
  if (index < 0) return null;
  const before = details.preBalances[index];
  const after = details.postBalances[index];
  return before === undefined || after === undefined ? null : after - before;
}
