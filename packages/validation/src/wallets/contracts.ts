import { z } from "zod";
import {
  clusterSchema,
  decimalStringSchema,
  integerStringSchema,
  isoTimestampSchema,
} from "../contract-primitives";
import { sourcedSchema } from "../sourced";

/**
 * Base58 Solana address shape. This is a cheap structural check for request
 * validation; the API additionally verifies it decodes to 32 bytes (`isAddress`).
 */
export const walletAddressSchema = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Expected a base58 Solana address");

export const walletAddressParamsSchema = z.object({ address: z.string() }).strict();

export const walletOverviewQuerySchema = z
  .object({
    signaturesLimit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export const lamportsValueSchema = z.object({
  lamports: integerStringSchema,
  decimals: z.literal(9),
  uiAmount: decimalStringSchema,
});

export const tokenAccountSchema = z.object({
  tokenAccount: walletAddressSchema,
  mint: walletAddressSchema,
  programId: walletAddressSchema,
  tokenProgram: z.enum(["spl-token", "token-2022"]),
  amount: integerStringSchema,
  decimals: z.number().int().min(0).max(255),
  uiAmount: decimalStringSchema,
  state: z.enum(["initialized", "frozen"]),
  isNative: z.boolean(),
});

export type TokenAccount = z.infer<typeof tokenAccountSchema>;

export const recentTransactionSchema = z.object({
  signature: z.string(),
  slot: integerStringSchema,
  blockTime: isoTimestampSchema.nullable(),
  status: z.enum(["succeeded", "failed"]),
  confirmationStatus: z.enum(["processed", "confirmed", "finalized"]).nullable(),
  memo: z.string().nullable(),
  explorerUrl: z.url(),
});

export type RecentTransaction = z.infer<typeof recentTransactionSchema>;

export const walletOverviewSchema = z.object({
  address: walletAddressSchema,
  cluster: clusterSchema,
  solBalance: sourcedSchema(lamportsValueSchema),
  tokenAccounts: sourcedSchema(z.array(tokenAccountSchema)),
  recentTransactions: sourcedSchema(z.array(recentTransactionSchema)),
  explorerUrl: z.url(),
});

export type WalletOverview = z.infer<typeof walletOverviewSchema>;

export const walletConnectionRequestSchema = z
  .object({
    address: walletAddressSchema,
    walletName: z.string().min(1).max(128),
    walletChains: z.array(z.string().max(64)).max(32),
  })
  .strict();

export const walletConnectionResponseSchema = z.object({
  accepted: z.boolean(),
  reason: z.enum(["CLUSTER_MISMATCH"]).nullable(),
  recordedAt: isoTimestampSchema,
});
