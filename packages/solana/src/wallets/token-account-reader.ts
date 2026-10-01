import type { Address } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { z } from "zod";
import type { Commitment, ReadContext, RpcGateway, RpcReading } from "../rpc/solana-rpc-client";

export const TOKEN_ACCOUNTS_DATA_VERSION = "token-accounts.v1";

export type TokenProgramKind = "spl-token" | "token-2022";

export const TOKEN_PROGRAMS: ReadonlyArray<{ kind: TokenProgramKind; programId: Address }> = [
  { kind: "spl-token", programId: TOKEN_PROGRAM_ADDRESS },
  { kind: "token-2022", programId: TOKEN_2022_PROGRAM_ADDRESS },
];

export interface TokenAccountHolding {
  tokenAccount: string;
  mint: string;
  owner: string;
  programId: string;
  tokenProgram: TokenProgramKind;
  amount: bigint;
  decimals: number;
  state: "initialized" | "frozen";
  isNative: boolean;
}

const parsedTokenAccountSchema = z.object({
  pubkey: z.string(),
  account: z
    .object({
      data: z.object({
        program: z.string(),
        parsed: z.object({
          type: z.literal("account"),
          info: z
            .object({
              mint: z.string(),
              owner: z.string(),
              state: z.enum(["initialized", "frozen"]),
              isNative: z.boolean(),
              tokenAmount: z
                .object({
                  amount: z.string().regex(/^\d+$/),
                  decimals: z.number().int().min(0).max(255),
                })
                .loose(),
            })
            .loose(),
        }),
      }),
    })
    .loose(),
});

const tokenAccountsResponseSchema = z.object({
  context: z.object({ slot: z.bigint() }).loose(),
  value: z.array(parsedTokenAccountSchema),
});

/**
 * Reads token accounts for both token programs. The result is all-or-nothing:
 * if either program query fails, the error propagates, because a partial list
 * would misrepresent holdings (SPEC-002 §4.2, WO-AC-13).
 */
export class TokenAccountReader {
  constructor(
    private readonly client: RpcGateway,
    private readonly commitment: Commitment = "confirmed",
  ) {}

  async read(owner: Address, context: ReadContext): Promise<RpcReading<TokenAccountHolding[]>> {
    const results = await Promise.all(
      TOKEN_PROGRAMS.map(async (program) => {
        const result = await this.client.call("getTokenAccountsByOwner", (abortSignal, rpc) =>
          rpc
            .getTokenAccountsByOwner(
              owner,
              { programId: program.programId },
              { encoding: "jsonParsed", commitment: this.commitment },
            )
            .send({ abortSignal })
            .then((response) => tokenAccountsResponseSchema.parse(response)),
        );
        return { program, result };
      }),
    );

    const holdings = results.flatMap(({ program, result }) =>
      result.value.value.map((entry): TokenAccountHolding => ({
        tokenAccount: entry.pubkey,
        mint: entry.account.data.parsed.info.mint,
        owner: entry.account.data.parsed.info.owner,
        programId: program.programId,
        tokenProgram: program.kind,
        amount: BigInt(entry.account.data.parsed.info.tokenAmount.amount),
        decimals: entry.account.data.parsed.info.tokenAmount.decimals,
        state: entry.account.data.parsed.info.state,
        isNative: entry.account.data.parsed.info.isNative,
      })),
    );

    // Provenance reflects the oldest context slot and the slowest of the two queries.
    const oldest = results.reduce((a, b) =>
      a.result.value.context.slot <= b.result.value.context.slot ? a : b,
    );
    const slowest = results.reduce((a, b) => (a.result.latencyMs >= b.result.latencyMs ? a : b));
    return {
      value: holdings,
      provenance: this.client.provenance({
        method: "getTokenAccountsByOwner",
        result: { ...oldest.result, latencyMs: slowest.result.latencyMs },
        context,
        dataVersion: TOKEN_ACCOUNTS_DATA_VERSION,
        commitment: this.commitment,
        slot: oldest.result.value.context.slot,
      }),
    };
  }
}
