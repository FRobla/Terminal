import { CLUSTERS } from "@sct/network";
import { AUDIT_ACTOR_TYPES, AUDIT_RESULTS, PROVIDER_STATUSES } from "@sct/validation";
import { pgEnum } from "drizzle-orm/pg-core";

export const clusterEnum = pgEnum("cluster", CLUSTERS);
export const auditActorTypeEnum = pgEnum("audit_actor_type", AUDIT_ACTOR_TYPES);
export const auditResultEnum = pgEnum("audit_result", AUDIT_RESULTS);
export const providerStatusEnum = pgEnum("provider_status", PROVIDER_STATUSES);
