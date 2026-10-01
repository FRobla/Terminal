import { z } from "zod";
import { isoTimestampSchema } from "../contract-primitives";
import { walletAddressSchema } from "../wallets/contracts";
import { PERMISSIONS } from "./permissions";

/** SPEC-007 — Sign-In With Solana contracts. Binary values are base64 encoded. */

const base64Schema = z.base64();

export const siwsChallengeRequestSchema = z.object({ address: walletAddressSchema }).strict();

export const siwsInputSchema = z.object({
  domain: z.string(),
  address: walletAddressSchema,
  statement: z.string(),
  uri: z.string(),
  version: z.literal("1"),
  chainId: z.string(),
  nonce: z.string(),
  issuedAt: isoTimestampSchema,
  expirationTime: isoTimestampSchema,
});

export type SiwsInput = z.infer<typeof siwsInputSchema>;

export const siwsChallengeResponseSchema = z.object({
  challengeId: z.uuid(),
  input: siwsInputSchema,
  /** Exact message text to sign when the wallet lacks `solana:signIn` (signMessage fallback). */
  message: z.string(),
});

export const siwsVerifyRequestSchema = z
  .object({
    challengeId: z.uuid(),
    address: walletAddressSchema,
    signedMessage: base64Schema,
    signature: base64Schema,
    method: z.enum(["signIn", "signMessage"]),
  })
  .strict();

export const sessionResponseSchema = z.object({
  user: z.object({ id: z.uuid(), displayName: z.string().nullable() }),
  walletAddress: walletAddressSchema,
  organization: z.object({ id: z.uuid(), slug: z.string(), name: z.string() }).nullable(),
  permissions: z.array(z.enum(PERMISSIONS)),
  csrfToken: z.string(),
  expiresAt: isoTimestampSchema,
});

export type SessionResponse = z.infer<typeof sessionResponseSchema>;

/** SPEC-025 §4 / SPEC-026 §4 — active session listings. Token hashes and CSRF tokens are never listed. */
export const sessionSummarySchema = z.object({
  id: z.uuid(),
  walletAddress: walletAddressSchema,
  createdAt: isoTimestampSchema,
  lastSeenAt: isoTimestampSchema,
  expiresAt: isoTimestampSchema,
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  current: z.boolean(),
});

export type SessionSummary = z.infer<typeof sessionSummarySchema>;

export const adminSessionSummarySchema = sessionSummarySchema.extend({
  user: z.object({ id: z.uuid(), displayName: z.string().nullable() }),
});

export type AdminSessionSummary = z.infer<typeof adminSessionSummarySchema>;

export const sessionIdParamsSchema = z.object({ sessionId: z.uuid() }).strict();

export const sessionRevocationResponseSchema = z.object({ revoked: z.number().int().nonnegative() });
