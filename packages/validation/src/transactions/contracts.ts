import { z } from "zod";
import { clusterSchema, integerStringSchema, isoTimestampSchema } from "../contract-primitives";
import { walletAddressSchema } from "../wallets/contracts";

/** SPEC-004 — transaction lifecycle contracts. */

export const TRANSACTION_STATES = [
  "DRAFT",
  "SIMULATING",
  "SIMULATED",
  "SIMULATION_FAILED",
  "AWAITING_SIGNATURE",
  "CANCELLED",
  "SIGNING",
  "SIGNING_FAILED",
  "SUBMITTED",
  "SUBMISSION_FAILED",
  "CONFIRMING",
  "EXPIRED",
  "CONFIRMATION_FAILED",
  "CONFIRMED",
  "RECONCILED",
  "RECONCILIATION_REQUIRED",
  "RECONCILIATION_FAILED",
] as const;

export type TransactionState = (typeof TRANSACTION_STATES)[number];

export const TRANSACTION_PURPOSES = ["sol-transfer"] as const;

/** Signed decimal string of an integer (lamport deltas). */
export const signedIntegerStringSchema = z.string().regex(/^-?(0|[1-9]\d*)$/, "Expected an integer string");

const positiveLamportsSchema = integerStringSchema.refine(
  (value) => BigInt(value) > 0n && BigInt(value) < 2n ** 63n,
  "Amount must be greater than 0 and below 2^63 lamports",
);

export const idempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,128}$/, "Use 16-128 characters: letters, digits, hyphens, underscores");

export const solTransferRequestSchema = z
  .object({
    sourceWalletId: z.uuid(),
    destination: walletAddressSchema,
    lamports: positiveLamportsSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export type SolTransferRequest = z.infer<typeof solTransferRequestSchema>;

export const balanceMovementSchema = z.object({
  account: walletAddressSchema,
  asset: z.literal("SOL"),
  deltaLamports: signedIntegerStringSchema,
});

export type BalanceMovement = z.infer<typeof balanceMovementSchema>;

/** TXL-AC-03 — built by the API from the decoded transaction, never from client descriptions. */
export const transactionReviewSchema = z.object({
  cluster: clusterSchema,
  feePayer: walletAddressSchema,
  signers: z.array(walletAddressSchema),
  programs: z.array(z.object({ programId: z.string(), name: z.string().nullable(), known: z.boolean() })),
  accounts: z.array(z.object({ address: z.string(), signer: z.boolean(), writable: z.boolean() })),
  movements: z.array(balanceMovementSchema),
  feeLamports: integerStringSchema.nullable(),
  simulation: z.object({
    status: z.enum(["SUCCEEDED", "FAILED"]),
    unitsConsumed: integerStringSchema.nullable(),
    error: z.string().nullable(),
    logs: z.array(z.string()),
  }),
  requiresUnknownProgramAcknowledgement: z.boolean(),
  recentBlockhash: z.string(),
  lastValidBlockHeight: integerStringSchema,
});

export type TransactionReview = z.infer<typeof transactionReviewSchema>;

export const transactionStateChangeSchema = z.object({
  from: z.enum(TRANSACTION_STATES).nullable(),
  to: z.enum(TRANSACTION_STATES),
  at: isoTimestampSchema,
  requestId: z.string(),
  details: z.record(z.string(), z.unknown()),
});

export const transactionFailureSchema = z.object({ reason: z.string(), message: z.string() });

export const reconciliationSchema = z.object({
  matched: z.boolean(),
  expected: z.array(balanceMovementSchema),
  observed: z.array(balanceMovementSchema),
  checkedAt: isoTimestampSchema,
});

export const transactionRecordSchema = z.object({
  id: z.uuid(),
  walletId: z.uuid(),
  walletLabel: z.string(),
  cluster: clusterSchema,
  purpose: z.enum(TRANSACTION_PURPOSES),
  state: z.enum(TRANSACTION_STATES),
  feePayer: walletAddressSchema,
  intent: z.object({ destination: walletAddressSchema, lamports: integerStringSchema }),
  review: transactionReviewSchema.nullable(),
  signature: z.string().nullable(),
  failure: transactionFailureSchema.nullable(),
  reconciliation: reconciliationSchema.nullable(),
  /** The wire transaction to sign; present only while a signature is awaited. */
  unsignedTransactionBase64: z.string().nullable(),
  initiatedBy: z.object({ id: z.uuid(), displayName: z.string().nullable() }),
  stateHistory: z.array(transactionStateChangeSchema),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});

export type TransactionRecordView = z.infer<typeof transactionRecordSchema>;

export const transactionIdParamsSchema = z.object({ transactionId: z.uuid() }).strict();

export const signingRequestSchema = z.object({ acknowledgeUnknownPrograms: z.boolean() }).strict();

export const SIGNING_FAILURE_REASONS = [
  "USER_REJECTED",
  "WALLET_ERROR",
  "UNSUPPORTED_WALLET",
  "WRONG_PASSPHRASE",
] as const;

export const signingFailedRequestSchema = z.object({ reason: z.enum(SIGNING_FAILURE_REASONS) }).strict();

export const submitTransactionRequestSchema = z.object({ signedTransactionBase64: z.base64() }).strict();

export const transactionListQuerySchema = z
  .object({
    walletId: z.uuid().optional(),
    state: z.enum(TRANSACTION_STATES).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.uuid().optional(),
  })
  .strict();

export type TransactionListQuery = z.infer<typeof transactionListQuerySchema>;
