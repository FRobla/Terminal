import { z } from "zod";
import { clusterSchema, isoTimestampSchema } from "../contract-primitives";

export const AUDIT_ACTOR_TYPES = ["user", "system", "worker", "anonymous"] as const;
export const AUDIT_RESULTS = ["success", "failure", "denied"] as const;

export const auditEventSchema = z.object({
  id: z.uuid(),
  occurredAt: isoTimestampSchema,
  organizationId: z.uuid().nullable(),
  actorType: z.enum(AUDIT_ACTOR_TYPES),
  actorId: z.uuid().nullable(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string().nullable(),
  result: z.enum(AUDIT_RESULTS),
  requestId: z.string(),
  cluster: clusterSchema.nullable(),
  metadata: z.record(z.string(), z.unknown()),
});

export type AuditEvent = z.infer<typeof auditEventSchema>;

export const auditEventListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().optional(),
    action: z.string().max(128).optional(),
    actorId: z.uuid().optional(),
    resourceType: z.string().max(64).optional(),
    from: isoTimestampSchema.optional(),
    to: isoTimestampSchema.optional(),
  })
  .strict();
