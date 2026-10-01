import { z } from "zod";
import { PERMISSIONS } from "../auth/permissions";
import { clusterSchema, isoTimestampSchema } from "../contract-primitives";
import {
  networkIdentitySchema,
  PROVIDER_STATUSES,
  providerHealthListSchema,
  readinessResponseSchema,
} from "./contracts";

/** SPEC-026 — owner console: overview, runtime inspection, jobs, developer tooling. */

/** A section read from a dependency that may be unreachable; never a fabricated value. */
export function inspectedSection<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion("status", [
    z.object({ status: z.literal("AVAILABLE"), value, latencyMs: z.number().int().nonnegative() }),
    z.object({ status: z.literal("UNAVAILABLE"), reason: z.string(), source: z.string() }),
  ]);
}

export const adminOverviewSchema = z.object({
  users: z.object({ total: z.number().int(), active: z.number().int(), disabled: z.number().int() }),
  members: z.object({ active: z.number().int(), suspended: z.number().int() }),
  roles: z.array(z.object({ key: z.string(), activeMembers: z.number().int() })),
  activeSessions: z.number().int(),
  /** Events of the active organization plus platform-level events (no organization), last 24 hours. */
  audit24h: z.object({ success: z.number().int(), failure: z.number().int(), denied: z.number().int() }),
  readiness: readinessResponseSchema,
  cluster: networkIdentitySchema,
  providers: providerHealthListSchema,
  lastProviderSnapshotAt: isoTimestampSchema.nullable(),
});

export type AdminOverview = z.infer<typeof adminOverviewSchema>;

export const runtimeConfigurationSchema = z.object({
  appEnv: z.string(),
  cluster: clusterSchema,
  publicAppOrigin: z.string(),
  rpcProvider: z.string(),
  /** Redacted: no credentials, query strings, or key-like path segments (PRV-AC-05). */
  rpcEndpoint: z.string(),
  /** Redacted fallback endpoint, or null when no fallback is configured (SPEC-006 PH-AC-09). */
  rpcFallbackEndpoint: z.string().nullable(),
  sessionTtlSeconds: z.number().int(),
  sessionIdleTimeoutSeconds: z.number().int(),
  bootstrapOwnerConfigured: z.boolean(),
  defaultMemberRole: z.string().nullable(),
  openApiExposed: z.boolean(),
});

export const databaseFactsSchema = z.object({
  serverVersion: z.string(),
  databaseSizeBytes: z.number().nonnegative(),
  migrations: z.object({
    applied: z.number().int(),
    committed: z.number().int(),
    latestAppliedTag: z.string().nullable(),
    pending: z.array(z.string()),
  }),
  tables: z.array(
    z.object({
      name: z.string(),
      liveRows: z.number().int().nonnegative(),
      totalBytes: z.number().nonnegative(),
    }),
  ),
});

export type DatabaseFacts = z.infer<typeof databaseFactsSchema>;

export const redisFactsSchema = z.object({
  version: z.string(),
  mode: z.string(),
  uptimeSeconds: z.number().int().nonnegative(),
  usedMemoryBytes: z.number().nonnegative(),
  connectedClients: z.number().int().nonnegative(),
  keyCount: z.number().int().nonnegative(),
});

export type RedisFacts = z.infer<typeof redisFactsSchema>;

export const runtimeInspectionSchema = z.object({
  configuration: runtimeConfigurationSchema,
  process: z.object({
    nodeVersion: z.string(),
    platform: z.string(),
    arch: z.string(),
    pid: z.number().int(),
    startedAt: isoTimestampSchema,
    uptimeSeconds: z.number().int().nonnegative(),
    rssBytes: z.number().nonnegative(),
    heapUsedBytes: z.number().nonnegative(),
    heapTotalBytes: z.number().nonnegative(),
  }),
  database: inspectedSection(databaseFactsSchema),
  redis: inspectedSection(redisFactsSchema),
});

export type RuntimeInspection = z.infer<typeof runtimeInspectionSchema>;

export const providerHistoryQuerySchema = z
  .object({
    providerId: z.string().max(64).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(60),
  })
  .strict();

export const providerHealthSnapshotSchema = z.object({
  id: z.uuid(),
  providerId: z.string(),
  cluster: clusterSchema,
  status: z.enum(PROVIDER_STATUSES),
  latencyP50Ms: z.number().int().nullable(),
  latencyP95Ms: z.number().int().nullable(),
  errorRate: z.number().min(0).max(1).nullable(),
  requestCount: z.number().int().nonnegative(),
  lastSuccessAt: isoTimestampSchema.nullable(),
  lastFailureAt: isoTimestampSchema.nullable(),
  lastFailureReason: z.string().nullable(),
  checkedAt: isoTimestampSchema,
});

export type ProviderHealthSnapshot = z.infer<typeof providerHealthSnapshotSchema>;

export const JOB_STATE_COUNTERS = [
  "waiting",
  "prioritized",
  "active",
  "delayed",
  "completed",
  "failed",
] as const;

export const queueStateSchema = z.object({
  name: z.string(),
  workers: z.number().int().nonnegative(),
  counts: z.record(z.enum(JOB_STATE_COUNTERS), z.number().int().nonnegative()),
  schedulers: z.array(
    z.object({
      id: z.string(),
      jobName: z.string(),
      everyMs: z.number().int().nullable(),
      pattern: z.string().nullable(),
      nextRunAt: isoTimestampSchema.nullable(),
    }),
  ),
  recentCompleted: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      finishedAt: isoTimestampSchema.nullable(),
      durationMs: z.number().int().nullable(),
      result: z.string().nullable(),
    }),
  ),
  recentFailed: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      finishedAt: isoTimestampSchema.nullable(),
      failedReason: z.string().nullable(),
      attemptsMade: z.number().int(),
    }),
  ),
});

export type QueueState = z.infer<typeof queueStateSchema>;

export const jobsOverviewSchema = z.object({ queues: z.array(inspectedSection(queueStateSchema)) });

export const enqueuedJobSchema = z.object({ queue: z.string(), jobId: z.string() });

export const routeAccessSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("public") }),
  z.object({ kind: z.literal("session") }),
  z.object({ kind: z.literal("permission"), permission: z.enum(PERMISSIONS) }),
]);

export const routeCatalogSchema = z.array(
  z.object({ method: z.string(), url: z.string(), access: routeAccessSchema }),
);

export type RouteCatalogEntry = z.infer<typeof routeCatalogSchema>[number];

export const CACHE_TARGETS = ["wallet-overview", "permissions"] as const;

export const cachePurgeRequestSchema = z.object({ target: z.enum(CACHE_TARGETS) }).strict();

export const cachePurgeResponseSchema = z.object({
  target: z.enum(CACHE_TARGETS),
  keysDeleted: z.number().int().nonnegative(),
});
