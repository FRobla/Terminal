import { index, integer, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { primaryId } from "./columns";
import { clusterEnum, providerStatusEnum } from "./enums";

/** Once-per-minute provider health snapshots for history (SPEC-006 §3). */
export const providerHealthChecks = pgTable(
  "provider_health_checks",
  {
    id: primaryId(),
    providerId: text("provider_id").notNull(),
    cluster: clusterEnum("cluster").notNull(),
    status: providerStatusEnum("status").notNull(),
    latencyP50Ms: integer("latency_p50_ms"),
    latencyP95Ms: integer("latency_p95_ms"),
    errorRate: numeric("error_rate", { precision: 5, scale: 4 }),
    requestCount: integer("request_count").notNull(),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
    lastFailureReason: text("last_failure_reason"),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("provider_health_checks_provider_checked_idx").on(table.providerId, table.checkedAt.desc()),
  ],
);
