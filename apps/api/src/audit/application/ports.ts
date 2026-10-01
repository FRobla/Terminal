import type { Cluster } from "@sct/network";
import type { AuditEvent } from "@sct/validation";

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

export interface AuditEventQuery {
  organizationId: string;
  limit: number;
  cursor?: { occurredAt: Date; id: string } | undefined;
  action?: string | undefined;
  actorId?: string | undefined;
  resourceType?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}

export interface AuditEventReader {
  list(query: AuditEventQuery): Promise<AuditEvent[]>;
}
