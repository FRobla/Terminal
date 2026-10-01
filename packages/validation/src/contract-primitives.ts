import { CLUSTERS } from "@sct/network";
import { z } from "zod";

export const clusterSchema = z.enum(CLUSTERS);

export const isoTimestampSchema = z.iso.datetime({ offset: false });

/** Decimal string of a non-negative integer (lamports, raw token amounts, slots). */
export const integerStringSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/, "Expected a non-negative integer string");

/** Decimal string of a non-negative decimal number, computed with exact arithmetic. */
export const decimalStringSchema = z.string().regex(/^(0|[1-9]\d*)(\.\d+)?$/, "Expected a decimal string");

export const ERROR_CODES = [
  "VALIDATION_FAILED",
  "WALLET_ADDRESS_INVALID",
  "CLUSTER_MISMATCH",
  "UNAUTHENTICATED",
  "SESSION_EXPIRED",
  "FORBIDDEN",
  "CSRF_TOKEN_INVALID",
  "SIWS_CHALLENGE_INVALID",
  "SIWS_SIGNATURE_INVALID",
  "ACCOUNT_DISABLED",
  "NOT_FOUND",
  "OPERATION_NOT_ALLOWED",
  "IDEMPOTENCY_CONFLICT",
  "RATE_LIMITED",
  "RPC_UNAVAILABLE",
  "RPC_RATE_LIMITED",
  "CLUSTER_VERIFICATION_FAILED",
  "PROVIDER_UNAVAILABLE",
  "NETWORK_NOT_PERMITTED",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const errorResponseSchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string(),
  requestId: z.string(),
  details: z.record(z.string(), z.unknown()),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export const responseMetaSchema = z.object({
  requestId: z.string(),
  generatedAt: isoTimestampSchema,
  nextCursor: z.string().nullable().optional(),
});

export function successEnvelope<T extends z.ZodType>(data: T) {
  return z.object({ data, meta: responseMetaSchema });
}
