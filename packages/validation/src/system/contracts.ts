import { z } from "zod";
import { clusterSchema, isoTimestampSchema } from "../contract-primitives";

export const PROVIDER_STATUSES = [
  "HEALTHY",
  "DEGRADED",
  "RATE_LIMITED",
  "UNAVAILABLE",
  "DISABLED",
  "UNKNOWN",
] as const;

export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];

export const healthResponseSchema = z.object({ status: z.literal("ok") });

const dependencyCheckSchema = z.object({
  status: z.enum(["ok", "failed"]),
  message: z.string().optional(),
});

export const readinessResponseSchema = z.object({
  status: z.enum(["ready", "not_ready"]),
  checks: z.object({
    database: dependencyCheckSchema,
    redis: dependencyCheckSchema,
    solanaCluster: dependencyCheckSchema,
  }),
});

export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;

export const networkIdentitySchema = z.object({
  cluster: clusterSchema,
  networkLabel: z.string(),
  expectedGenesisHash: z.string().nullable(),
  observedGenesisHash: z.string().nullable(),
  verified: z.boolean(),
  verifiedAt: isoTimestampSchema.nullable(),
  checkedAt: isoTimestampSchema.nullable(),
  rpcProvider: z.string(),
  solanaCoreVersion: z.string().nullable(),
  failureReason: z.string().nullable(),
});

export type NetworkIdentity = z.infer<typeof networkIdentitySchema>;

export const providerHealthSchema = z.object({
  providerId: z.string(),
  displayName: z.string(),
  network: clusterSchema,
  status: z.enum(PROVIDER_STATUSES),
  latencyP50Ms: z.number().int().nullable(),
  latencyP95Ms: z.number().int().nullable(),
  requestCount: z.number().int().nonnegative(),
  errorRate: z.number().min(0).max(1).nullable(),
  lastSuccessAt: isoTimestampSchema.nullable(),
  lastFailureAt: isoTimestampSchema.nullable(),
  lastFailureReason: z.string().nullable(),
  rateLimit: z.object({
    limited: z.boolean(),
    resetAt: isoTimestampSchema.nullable(),
    lastRateLimitedAt: isoTimestampSchema.nullable(),
  }),
  checkedAt: isoTimestampSchema,
});

export type ProviderHealth = z.infer<typeof providerHealthSchema>;

export const providerHealthListSchema = z.array(providerHealthSchema);
