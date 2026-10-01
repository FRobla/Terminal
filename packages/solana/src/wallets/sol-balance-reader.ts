import type { Address } from "@solana/kit";
import { z } from "zod";
import type { Commitment, ReadContext, RpcGateway, RpcReading } from "../rpc/solana-rpc-client";

export const SOL_BALANCE_DATA_VERSION = "sol-balance.v1";

export interface SolBalance {
  lamports: bigint;
}

const balanceResponseSchema = z.object({
  context: z.object({ slot: z.bigint() }).loose(),
  value: z.bigint().nonnegative(),
});

export class SolBalanceReader {
  constructor(
    private readonly client: RpcGateway,
    private readonly commitment: Commitment = "confirmed",
  ) {}

  async read(address: Address, context: ReadContext): Promise<RpcReading<SolBalance>> {
    const result = await this.client.call("getBalance", (abortSignal, rpc) =>
      rpc
        .getBalance(address, { commitment: this.commitment })
        .send({ abortSignal })
        .then((response) => balanceResponseSchema.parse(response)),
    );
    return {
      value: { lamports: result.value.value },
      provenance: this.client.provenance({
        method: "getBalance",
        result,
        context,
        dataVersion: SOL_BALANCE_DATA_VERSION,
        commitment: this.commitment,
        slot: result.value.context.slot,
      }),
    };
  }
}
