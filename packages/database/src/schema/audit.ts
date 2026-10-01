import { index, inet, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { primaryId } from "./columns";
import { auditActorTypeEnum, auditResultEnum, clusterEnum } from "./enums";
import { organizations } from "./organizations";
import { users } from "./users";

/** Append-only audit log (SPEC-008). The application role cannot UPDATE or DELETE rows. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: primaryId(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "restrict" }),
    actorType: auditActorTypeEnum("actor_type").notNull(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    result: auditResultEnum("result").notNull(),
    requestId: text("request_id").notNull(),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
    cluster: clusterEnum("cluster"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    index("audit_events_org_occurred_at_idx").on(table.organizationId, table.occurredAt.desc()),
    index("audit_events_action_idx").on(table.action),
    index("audit_events_actor_id_idx").on(table.actorId),
  ],
);
