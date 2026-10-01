import type { Cluster } from "@sct/network";

/** One row of the append-only audit log (SPEC-008 §2). */
export interface AuditEventRecord {
  occurredAt: Date;
  organizationId: string | null;
  actorType: "user" | "system" | "worker" | "anonymous";
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  result: "success" | "failure" | "denied";
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
  cluster: Cluster | null;
  metadata: Record<string, unknown>;
}

export interface AuditEventWriter {
  /** `transaction` is an opaque database transaction handle owned by the caller. */
  insert(record: AuditEventRecord, transaction?: unknown): Promise<void>;
}
