import { z } from "zod";
import { clusterSchema, integerStringSchema, isoTimestampSchema } from "../contract-primitives";
import { plainTextSchema } from "../plain-text";
import { sourcedSchema } from "../sourced";
import { walletAddressSchema } from "./contracts";

/** SPEC-009 — wallet registry contracts. */

export const WALLET_CATEGORIES = [
  "TREASURY",
  "TRADING",
  "OPERATIONS",
  "DEVELOPMENT",
  "TOKEN_ISSUANCE",
  "RESEARCH",
  "COLD_STORAGE",
  "WATCH_ONLY",
] as const;
export type WalletCategory = (typeof WALLET_CATEGORIES)[number];

export const CUSTODY_TYPES = ["BROWSER_WALLET", "LOCAL_ENCRYPTED", "WATCH_ONLY"] as const;
export type CustodyType = (typeof CUSTODY_TYPES)[number];

/** Custody types whose registration requires proof of control (SPEC-009 §4.2). */
export const CONTROLLED_CUSTODY_TYPES = ["BROWSER_WALLET", "LOCAL_ENCRYPTED"] as const;

export const WALLET_STATUSES = ["active", "archived"] as const;
export type WalletStatus = (typeof WALLET_STATUSES)[number];

export const WALLET_ROLES = ["CREATOR", "FUNDER", "CONTROLLER", "VIEWER"] as const;
export type WalletRole = (typeof WALLET_ROLES)[number];

export const MAX_WALLET_TAGS = 10;

export const walletLabelSchema = plainTextSchema({ max: 64 });
export const walletPurposeSchema = plainTextSchema({ max: 200 });

/** Control, format, and separator characters other than the line feed. */
const DISALLOWED_NOTE_CHARACTERS = /[\p{Cf}\p{Zl}\p{Zp}]|(?![\n])\p{Cc}/u;

export const walletNotesSchema = z
  .string()
  .transform((value) => value.replace(/\r\n?/g, "\n").trim())
  .pipe(
    z
      .string()
      .min(1, "Must not be empty")
      .max(2000, "Must be at most 2000 characters")
      .refine(
        (value) => !DISALLOWED_NOTE_CHARACTERS.test(value),
        "Must not contain control or formatting characters",
      ),
  );

export const walletTagSchema = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.string().regex(/^[a-z0-9-]{1,32}$/, "Tags use 1-32 characters: a-z, 0-9, and hyphens"));

export const walletTagsSchema = z
  .array(walletTagSchema)
  .max(MAX_WALLET_TAGS, `At most ${MAX_WALLET_TAGS} tags`)
  .refine((tags) => new Set(tags).size === tags.length, "Tags must be distinct");

const metadataFields = {
  label: walletLabelSchema,
  category: z.enum(WALLET_CATEGORIES),
  purpose: walletPurposeSchema.nullable().optional(),
  tags: walletTagsSchema.optional(),
  notes: walletNotesSchema.nullable().optional(),
};

const base64Schema = z.base64();

export const ownershipProofSchema = z.object({ challengeId: z.uuid(), signature: base64Schema }).strict();

export const registerWalletRequestSchema = z.discriminatedUnion("custodyType", [
  z
    .object({ custodyType: z.literal("WATCH_ONLY"), address: walletAddressSchema, ...metadataFields })
    .strict(),
  z
    .object({
      custodyType: z.enum(CONTROLLED_CUSTODY_TYPES),
      address: walletAddressSchema,
      ...metadataFields,
      ownership: ownershipProofSchema,
    })
    .strict(),
]);

export type RegisterWalletRequest = z.infer<typeof registerWalletRequestSchema>;

export const updateWalletRequestSchema = z
  .object({
    label: walletLabelSchema.optional(),
    category: z.enum(WALLET_CATEGORIES).optional(),
    purpose: walletPurposeSchema.nullable().optional(),
    tags: walletTagsSchema.optional(),
    notes: walletNotesSchema.nullable().optional(),
    status: z.enum(WALLET_STATUSES).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export type UpdateWalletRequest = z.infer<typeof updateWalletRequestSchema>;

export const ownershipChallengeRequestSchema = z.object({ address: walletAddressSchema }).strict();

export const ownershipChallengeResponseSchema = z.object({
  challengeId: z.uuid(),
  /** Exact text the wallet must sign with `signMessage`. */
  message: z.string(),
  expiresAt: isoTimestampSchema,
});

export const walletAssignmentSchema = z.object({
  userId: z.uuid(),
  displayName: z.string().nullable(),
  walletAddress: walletAddressSchema.nullable(),
  role: z.enum(WALLET_ROLES),
  assignedAt: isoTimestampSchema,
});

export type WalletAssignment = z.infer<typeof walletAssignmentSchema>;

export const walletSyncStateSchema = z.object({
  indexedCount: z.number().int().nonnegative(),
  backfillComplete: z.boolean(),
  oldestIndexedBlockTime: isoTimestampSchema.nullable(),
  lastAttemptAt: isoTimestampSchema.nullable(),
  lastSuccessAt: isoTimestampSchema.nullable(),
  lastFailureAt: isoTimestampSchema.nullable(),
  lastFailureReason: z.string().nullable(),
});

export type WalletSyncState = z.infer<typeof walletSyncStateSchema>;

export const managedWalletSchema = z.object({
  id: z.uuid(),
  address: walletAddressSchema,
  cluster: clusterSchema,
  label: z.string(),
  purpose: z.string().nullable(),
  category: z.enum(WALLET_CATEGORIES),
  custodyType: z.enum(CUSTODY_TYPES),
  notes: z.string().nullable(),
  tags: z.array(z.string()),
  status: z.enum(WALLET_STATUSES),
  createdBy: z.object({ id: z.uuid(), displayName: z.string().nullable() }),
  assignments: z.array(walletAssignmentSchema),
  /** The caller's own application roles on this wallet. */
  myRoles: z.array(z.enum(WALLET_ROLES)),
  sync: walletSyncStateSchema,
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
  archivedAt: isoTimestampSchema.nullable(),
});

export type ManagedWallet = z.infer<typeof managedWalletSchema>;

export const walletListQuerySchema = z
  .object({
    status: z.enum(WALLET_STATUSES).default("active"),
    category: z.enum(WALLET_CATEGORIES).optional(),
    custodyType: z.enum(CUSTODY_TYPES).optional(),
    tag: walletTagSchema.optional(),
    q: z.string().trim().min(1).max(64).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.uuid().optional(),
  })
  .strict();

export type WalletListQuery = z.infer<typeof walletListQuerySchema>;

export const walletBalanceSchema = z.object({ walletId: z.uuid(), lamports: integerStringSchema });

export const walletListSchema = z.object({
  wallets: z.array(managedWalletSchema),
  balances: sourcedSchema(z.array(walletBalanceSchema)),
});

export type WalletList = z.infer<typeof walletListSchema>;

export const walletIdParamsSchema = z.object({ walletId: z.uuid() }).strict();

export const assignWalletRequestSchema = z.object({ userId: z.uuid(), role: z.enum(WALLET_ROLES) }).strict();

export const walletAssignmentParamsSchema = z
  .object({ walletId: z.uuid(), userId: z.uuid(), role: z.enum(WALLET_ROLES) })
  .strict();

export const organizationMemberSchema = z.object({
  userId: z.uuid(),
  displayName: z.string().nullable(),
  walletAddress: walletAddressSchema.nullable(),
});

export const organizationMembersSchema = z.array(organizationMemberSchema);

export const walletHistoryQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().max(200).optional(),
  })
  .strict();

export const indexedTransactionSchema = z.object({
  signature: z.string(),
  slot: integerStringSchema,
  blockTime: isoTimestampSchema.nullable(),
  status: z.enum(["succeeded", "failed"]),
  confirmationStatus: z.enum(["processed", "confirmed", "finalized"]).nullable(),
  memo: z.string().nullable(),
  feeLamports: integerStringSchema.nullable(),
  /** Signed decimal string: the wallet's SOL change in lamports. */
  solChangeLamports: z
    .string()
    .regex(/^-?(0|[1-9]\d*)$/)
    .nullable(),
});

export type IndexedTransaction = z.infer<typeof indexedTransactionSchema>;

export const walletHistorySchema = z.object({
  transactions: z.array(indexedTransactionSchema),
  sync: walletSyncStateSchema,
  /** Signatures beyond this cap are not indexed (SPEC-009 §4.8). */
  backfillCap: z.number().int().positive(),
});

export type WalletHistory = z.infer<typeof walletHistorySchema>;

export const walletSyncResponseSchema = z.object({
  enqueued: z.boolean(),
  retryAfterMs: z.number().int().nonnegative().nullable(),
});

export const walletExportResponseSchema = z.object({ recordedAt: isoTimestampSchema });
