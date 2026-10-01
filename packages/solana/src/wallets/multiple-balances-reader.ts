import type { Address } from "@solana/kit";
import { z } from "zod";
import type { Commitment, ReadContext, RpcGateway, RpcReading } from "../rpc/solana-rpc-client";

export const MULTIPLE_BALANCES_DATA_VERSION = "multiple-balances.v1";

/** `getMultipleAccounts` accepts at most 100 addresses per request. */
export const MAX_ADDRESSES_PER_BALANCE_READ = 100;

export interface AddressBalance {
  address: Address;
  /** `0` when the account does not exist (never funded or closed). */
  lamports: bigint;
}

const accountSchema = z.object({ lamports: z.bigint().nonnegative() }).loose().nullable();

const multipleAccountsResponseSchema = z.object({
  context: z.object({ slot: z.bigint() }).loose(),
  value: z.array(accountSchema),
});

/**
 * SOL balances of up to 100 addresses in one request (SPEC-009 WRG-AC-06).
 * Account data is sliced to zero bytes: only lamports are needed.
 */
export class MultipleBalancesReader {
  constructor(
    private readonly client: RpcGateway,
    private readonly commitment: Commitment = "confirmed",
  ) {}

  async read(addresses: readonly Address[], context: ReadContext): Promise<RpcReading<AddressBalance[]>> {
    if (addresses.length > MAX_ADDRESSES_PER_BALANCE_READ) {
      throw new RangeError(`At most ${MAX_ADDRESSES_PER_BALANCE_READ} addresses per balance read`);
    }
    const result = await this.client.call("getMultipleAccounts", (abortSignal, rpc) =>
      rpc
        .getMultipleAccounts([...addresses], {
          commitment: this.commitment,
          encoding: "base64",
          dataSlice: { offset: 0, length: 0 },
        })
        .send({ abortSignal })
        .then((response) =>
          multipleAccountsResponseSchema
            .refine(
              (parsed) => parsed.value.length === addresses.length,
              "Account count differs from the request",
            )
            .parse(response),
        ),
    );
    return {
      value: addresses.map((address, index) => ({
        address,
        lamports: result.value.value[index]?.lamports ?? 0n,
      })),
      provenance: this.client.provenance({
        method: "getMultipleAccounts",
        result,
        context,
        dataVersion: MULTIPLE_BALANCES_DATA_VERSION,
        commitment: this.commitment,
        slot: result.value.context.slot,
      }),
    };
  }
}
