import { z } from "zod";
import { clusterSchema, integerStringSchema, isoTimestampSchema } from "./contract-primitives";

/** SPEC-003 — provenance and availability envelope for externally sourced values. */

export const AVAILABILITY_STATUSES = ["AVAILABLE", "STALE", "UNAVAILABLE"] as const;

export const CONFIDENCE_LEVELS = ["AUTHORITATIVE", "PROVIDER_REPORTED", "DERIVED", "CACHED"] as const;

export const SOURCE_TYPES = ["rpc", "rest", "websocket", "sdk-onchain", "derived"] as const;

export const COMMITMENTS = ["processed", "confirmed", "finalized"] as const;

export const UNAVAILABLE_REASONS = [
  "RPC_UNAVAILABLE",
  "RPC_TIMEOUT",
  "RPC_RATE_LIMITED",
  "RPC_INVALID_RESPONSE",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_NOT_CONFIGURED",
  "NOT_SUPPORTED_ON_NETWORK",
  "CLUSTER_UNVERIFIED",
  "DEPENDENCY_UNAVAILABLE",
] as const;

export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];

type ProvenanceShape = {
  source: string;
  sourceType: (typeof SOURCE_TYPES)[number];
  provider: string;
  providerVersion?: string | undefined;
  endpoint: string;
  method?: string | undefined;
  network: z.infer<typeof clusterSchema>;
  commitment?: (typeof COMMITMENTS)[number] | undefined;
  slot?: string | undefined;
  retrievedAt: string;
  observedAt: string | null;
  requestId: string;
  dataVersion: string;
  confidence: (typeof CONFIDENCE_LEVELS)[number];
  latencyMs?: number | undefined;
  responseStatus?: number | undefined;
  fallbackUsed: boolean;
  derivedFrom?: ProvenanceShape[] | undefined;
};

export const provenanceSchema: z.ZodType<ProvenanceShape> = z.lazy(() =>
  z.object({
    source: z.string().min(1),
    sourceType: z.enum(SOURCE_TYPES),
    provider: z.string().min(1),
    providerVersion: z.string().optional(),
    endpoint: z.string(),
    method: z.string().optional(),
    network: clusterSchema,
    commitment: z.enum(COMMITMENTS).optional(),
    slot: integerStringSchema.optional(),
    retrievedAt: isoTimestampSchema,
    observedAt: isoTimestampSchema.nullable(),
    requestId: z.string().min(1),
    dataVersion: z.string().min(1),
    confidence: z.enum(CONFIDENCE_LEVELS),
    latencyMs: z.number().int().nonnegative().optional(),
    responseStatus: z.number().int().optional(),
    fallbackUsed: z.boolean(),
    derivedFrom: z.array(provenanceSchema).optional(),
  }),
);

export type Provenance = z.infer<typeof provenanceSchema>;

export const unavailableInfoSchema = z.object({
  reason: z.enum(UNAVAILABLE_REASONS),
  message: z.string(),
  source: z.string(),
  lastSuccessfulRetrievalAt: isoTimestampSchema.nullable(),
  retry: z.object({
    retryable: z.boolean(),
    retryAfterMs: z.number().int().nonnegative().optional(),
    attempts: z.number().int().nonnegative(),
  }),
});

export type UnavailableInfo = z.infer<typeof unavailableInfoSchema>;

export function sourcedSchema<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion("status", [
    z.object({ status: z.literal("AVAILABLE"), value, provenance: provenanceSchema }),
    z.object({
      status: z.literal("STALE"),
      value,
      provenance: provenanceSchema,
      staleSince: isoTimestampSchema,
    }),
    z.object({
      status: z.literal("UNAVAILABLE"),
      value: z.null(),
      provenance: z.null(),
      unavailable: unavailableInfoSchema,
    }),
  ]);
}

export type Sourced<T> =
  | { status: "AVAILABLE"; value: T; provenance: Provenance }
  | { status: "STALE"; value: T; provenance: Provenance; staleSince: string }
  | { status: "UNAVAILABLE"; value: null; provenance: null; unavailable: UnavailableInfo };
